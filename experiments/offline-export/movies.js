'use strict';

// One decoded image and one canvas texture, not a real-time HTMLVideoElement.
// Original MovieLayer geometry, shader, fades and AdvPlayer control remain in use.
class OfflineMovieLayer extends MovieLayer {
    control(url, options = {}) {
        this.reset();
        const metadata = proof.movieMetadata[url];
        if (!metadata) throw new Error(`Unprepared movie: ${url}`);
        const canvas = document.createElement('canvas');
        canvas.width = metadata.width;
        canvas.height = metadata.height;
        const texture = PIXI.Texture.from(canvas);
        const sprite = this._sprite = new PIXI.Sprite(texture);
        sprite.width = 1136;
        sprite.height = 640;
        sprite.alpha = 0;
        this._chromaFilter = this._createChromaKeyFilter(options.chromaKey);
        if (this._chromaFilter) sprite.filters = [this._chromaFilter];
        this.stageObj.addChild(sprite);
        const audioUrl = options.seUrl || (metadata.hasAudio ? url : null);
        const sound = audioUrl ? new OfflineSound({ url: audioUrl, duration: proof.audioMetadata[audioUrl].duration }, {}) : null;
        if (sound) sound.record.bus = 'media'; // HTML media bypasses PIXI's master gain/compressor.
        const state = this.offline = { url, metadata, canvas, sound, start: time(), options, frame: -1,
            cue: false, fading: false, fadeOut: this._normalizeFadeSeconds(options.fadeOutSeconds, 0.35) };
        state.coverage = { url, start: time(), sourceFrames: metadata.timestamps.length, decodedFrames: 0,
            firstFrame: null, lastFrame: null, cueTime: null, end: null };
        (proof.movies ||= []).push(state.coverage);
        proof.events.push({ kind: 'movie-start', time: time(), url, chromaKey: !!options.chromaKey });
        this._tweenAlpha(sprite, 1, this._normalizeFadeSeconds(options.fadeInSeconds, 0.35));
        return new Promise(resolve => state.resolve = resolve);
    }
    async updateOffline() {
        const state = this.offline;
        if (!state) return;
        const elapsed = time() - state.start;
        if (!state.cue && typeof state.options.onCue === 'function'
            && elapsed + 1e-7 >= Number(state.options.cueTimeSeconds)) {
            state.cue = true;
            state.coverage.cueTime = time();
            state.options.onCue();
            proof.events.push({ kind: 'movie-cue', time: time(), url: state.url, elapsed });
        }
        if (elapsed + 1e-7 >= state.metadata.duration) {
            if (state.sound) state.sound.stop();
            this.offline = null;
            state.coverage.end = time();
            proof.events.push({ kind: 'movie-end', time: time(), url: state.url, elapsed, frames: state.metadata.timestamps.length });
            state.resolve();
            return;
        }
        if (!state.fading && state.metadata.duration - elapsed <= state.fadeOut) {
            state.fading = true;
            this._tweenAlpha(this._sprite, 0, Math.max(0.08, Math.min(state.fadeOut, state.metadata.duration - elapsed)));
        }
        const index = OfflineFlow.movieFrame(state.metadata.timestamps, elapsed);
        if (index === state.frame) return;
        const response = await fetch(`/proof-movie/${state.metadata.key}/${index}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Movie frame unavailable: ${state.url} / ${index}`);
        const bitmap = await createImageBitmap(await response.blob());
        try {
            const ctx = state.canvas.getContext('2d');
            ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
            ctx.drawImage(bitmap, 0, 0);
        } finally { bitmap.close(); }
        this._sprite.texture.update();
        state.frame = index;
        state.coverage.decodedFrames++;
        state.coverage.firstFrame ??= index;
        state.coverage.lastFrame = index;
    }
    reset() {
        if (this.offline?.sound) this.offline.sound.stop();
        this.offline = null;
        super.reset();
    }
}
