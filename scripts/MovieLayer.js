// Video-playback layer — mirrors original movieLayer.
// control(movieId) adds an HTML5 <video> element and returns a Promise.
class MovieLayer {
    constructor() {
        this._container = new PIXI.Container();
        this._video     = null;
        this._sprite    = null;
        this._movieAudio = null;
        this._movieSeStarted = false;
        this._chromaFilter = null;
        this._fadeMonitor = 0;
        this._fadeOutStarted = false;
    }

    get stageObj() { return this._container; }

    // Returns a Promise that resolves when the video ends.
    // movieUrl is a full URL after AdvResourceConverter (or any string id).
    control(movieUrl, opts = {}) {
        return new Promise(resolve => {
            this._cleanup();
            const seUrl = opts.seUrl;
            const fadeInSeconds = this._normalizeFadeSeconds(opts.fadeInSeconds, 0.35);
            const fadeOutSeconds = this._normalizeFadeSeconds(opts.fadeOutSeconds, 0.35);
            const cueTimeSeconds = Number(opts.cueTimeSeconds);
            const onCue = typeof opts.onCue === 'function' ? opts.onCue : null;
            let cueFired = false;
            const fireCue = () => {
                if (cueFired || !onCue) return;
                cueFired = true;
                try {
                    onCue({
                        currentTime: Number(video.currentTime),
                        duration: Number(video.duration),
                    });
                } catch (error) {
                    console.warn('[MovieLayer] playback cue failed', error);
                }
            };
            this._movieSeStarted = false;
            this._fadeOutStarted = false;
            this._movieAudio = seUrl ? this._createMovieAudio(seUrl) : null;

            const path = movieUrl.startsWith('http') || movieUrl.includes('/')
                ? movieUrl
                : `${ASSET_PATH}/movies/${movieUrl}.mp4`;
            const video = document.createElement('video');
            video.crossOrigin = 'anonymous';
            video.src   = path;
            video.autoplay = false;
            video.muted    = !!this._movieAudio;
            video.volume   = 1;
            video.preload  = 'auto';
            video.playsInline = true;
            video.setAttribute('playsinline', '');

            const playMovieSe = () => {
                if (!this._movieAudio || this._movieSeStarted || video.currentTime <= 0) return;
                this._movieSeStarted = true;
                this._syncMovieAudio(video);
                const p = this._movieAudio.play();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            };
            const resumeMovieSe = () => {
                if (!this._movieAudio || !this._movieSeStarted) return;
                this._syncMovieAudio(video);
                const p = this._movieAudio.play();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            };
            const pauseMovieSe = () => {
                if (this._movieAudio) this._movieAudio.pause();
            };

            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                this._stopFadeMonitor();
                this._stopMovieAudio();
                video.pause();
                if (!this._fadeOutStarted && this._sprite === sprite && sprite.alpha > 0.02) {
                    this._fadeOutStarted = true;
                    this._tweenAlpha(sprite, 0, Math.min(fadeOutSeconds, 0.2), resolve);
                } else {
                    resolve();
                }
            };
            video.addEventListener('ended', finish);
            video.addEventListener('error', () => {
                // Clearing src during normal cleanup may itself dispatch an
                // error event. Once playback has settled, it is not a load
                // failure and must not produce a false warning.
                if (settled) return;
                settled = true;
                console.warn(`[MovieLayer] failed to load: ${path}`);
                this._cleanup();
                resolve();
            });
            video.addEventListener('timeupdate', playMovieSe);
            video.addEventListener('playing', () => {
                resumeMovieSe();
                if (this._sprite === sprite && sprite.alpha === 0) {
                    this._tweenAlpha(sprite, 1, fadeInSeconds);
                }
                this._startFadeMonitor(
                    video,
                    sprite,
                    fadeOutSeconds,
                    cueTimeSeconds,
                    fireCue,
                );
            });
            video.addEventListener('waiting', pauseMovieSe);
            video.addEventListener('pause', pauseMovieSe);

            const texture  = PIXI.Texture.from(video);
            const sprite   = new PIXI.Sprite(texture);
            sprite.width   = 1136;
            sprite.height  = 640;
            sprite.alpha   = 0;
            this._chromaFilter = this._createChromaKeyFilter(opts.chromaKey);
            if (this._chromaFilter) sprite.filters = [this._chromaFilter];

            this._container.addChild(sprite);
            this._video  = video;
            this._sprite = sprite;

            if (globalThis.ScenarioVideoExport) {
                if (!video.muted) ScenarioVideoExport.attachMediaElement(video);
                if (this._movieAudio) ScenarioVideoExport.attachMediaElement(this._movieAudio);
            }
            if (globalThis.ScenarioObsExport) {
                if (!video.muted) ScenarioObsExport.attachMediaElement(video);
                if (this._movieAudio) ScenarioObsExport.attachMediaElement(this._movieAudio);
            }

            video.play().catch(() => {
                this._cleanup();
                resolve();
            });
        });
    }

    reset() { this._cleanup(); }

    _cleanup() {
        this._stopFadeMonitor();
        if (this._video) {
            this._video.pause();
            this._video.src = '';
            this._video = null;
        }
        this._stopMovieAudio();
        if (this._sprite) {
            if (typeof TweenMax !== 'undefined' && typeof TweenMax.killTweensOf === 'function') {
                TweenMax.killTweensOf(this._sprite);
            }
            if (this._sprite.texture) this._sprite.texture.destroy(true);
            this._sprite.filters = null;
            this._container.removeChild(this._sprite);
            this._sprite = null;
        }
        if (this._chromaFilter && typeof this._chromaFilter.destroy === 'function') {
            this._chromaFilter.destroy();
        }
        this._chromaFilter = null;
        this._fadeOutStarted = false;
    }

    _createChromaKeyFilter(options) {
        if (!options || !PIXI.Filter) return null;
        const threshold = Number.isFinite(Number(options.threshold)) ? Number(options.threshold) : 0.08;
        const softness = Number.isFinite(Number(options.softness)) ? Number(options.softness) : 0.18;
        const despill = Number.isFinite(Number(options.despill)) ? Number(options.despill) : 1;
        const fragment = `
            varying vec2 vTextureCoord;
            uniform sampler2D uSampler;
            uniform float threshold;
            uniform float softness;
            uniform float despill;

            void main(void) {
                vec4 pixel = texture2D(uSampler, vTextureCoord);
                float greenDominance = pixel.g - max(pixel.r, pixel.b);
                float keyed = smoothstep(threshold, threshold + max(softness, 0.001), greenDominance);
                float alpha = 1.0 - keyed;
                float neutralGreen = max(pixel.r, pixel.b);
                pixel.g = mix(pixel.g, neutralGreen, keyed * clamp(despill, 0.0, 1.0));
                pixel.a *= alpha;
                pixel.rgb *= alpha;
                gl_FragColor = pixel;
            }
        `;
        return new PIXI.Filter(undefined, fragment, { threshold, softness, despill });
    }

    _normalizeFadeSeconds(value, fallback) {
        const seconds = Number(value);
        return Number.isFinite(seconds) && seconds >= 0 ? seconds : fallback;
    }

    _tweenAlpha(sprite, alpha, seconds, onComplete) {
        if (!sprite) {
            if (onComplete) onComplete();
            return;
        }
        if (typeof TweenMax !== 'undefined' && typeof TweenMax.to === 'function' && seconds > 0) {
            if (typeof TweenMax.killTweensOf === 'function') TweenMax.killTweensOf(sprite);
            TweenMax.to(sprite, seconds, {
                alpha,
                ease: typeof Power1 !== 'undefined' ? Power1.easeInOut : undefined,
                onComplete,
            });
            return;
        }
        sprite.alpha = alpha;
        if (onComplete) onComplete();
    }

    _startFadeMonitor(video, sprite, fadeOutSeconds, cueTimeSeconds, fireCue) {
        if (!video || !sprite || this._fadeMonitor) return;
        const tick = () => {
            this._fadeMonitor = 0;
            if (this._video !== video || this._sprite !== sprite || video.ended) return;
            const duration = Number(video.duration);
            const currentTime = Number(video.currentTime);
            if (typeof fireCue === 'function'
                && Number.isFinite(cueTimeSeconds)
                && cueTimeSeconds >= 0
                && Number.isFinite(currentTime)
                && currentTime >= cueTimeSeconds) {
                fireCue();
            }
            if (!this._fadeOutStarted
                && Number.isFinite(duration)
                && duration > 0
                && Number.isFinite(currentTime)
                && duration - currentTime <= fadeOutSeconds) {
                this._fadeOutStarted = true;
                const remaining = Math.max(0.08, Math.min(fadeOutSeconds, duration - currentTime));
                this._tweenAlpha(sprite, 0, remaining);
            }
            this._fadeMonitor = requestAnimationFrame(tick);
        };
        this._fadeMonitor = requestAnimationFrame(tick);
    }

    _stopFadeMonitor() {
        if (!this._fadeMonitor) return;
        cancelAnimationFrame(this._fadeMonitor);
        this._fadeMonitor = 0;
    }

    _stopMovieAudio() {
        if (this._movieAudio) {
            this._movieAudio.pause();
            this._movieAudio.src = '';
            this._movieAudio = null;
        }
        this._movieSeStarted = false;
    }

    _createMovieAudio(seUrl) {
        const audio = document.createElement('audio');
        audio.crossOrigin = 'anonymous';
        audio.src = seUrl;
        audio.preload = 'auto';
        audio.volume = 1;
        return audio;
    }

    _syncMovieAudio(video) {
        if (!this._movieAudio) return;
        try {
            if (Math.abs(this._movieAudio.currentTime - video.currentTime) > 0.2) {
                this._movieAudio.currentTime = video.currentTime;
            }
        } catch (_) {}
    }
}
