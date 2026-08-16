'use strict';

(function installScenarioVideoExport(global) {
    const mediaNodes = new WeakMap();
    let activeSession = null;
    const EXPORT_FRAME_RATE = 60;
    const EXPORT_FRAME_MS = 1000 / EXPORT_FRAME_RATE;
    const WARMUP_TEXTURE_BUDGET_BYTES = 96 * 1024 * 1024;
    const WARMUP_TEXTURE_LIMIT = 24;
    const DEFAULT_PREROLL_MS = 1000;

    function query() {
        return new URLSearchParams(global.location ? global.location.search : '');
    }

    function requested() {
        return query().get('mode') === 'export' && !!query().get('exportJob');
    }

    function jobIdFromLocation() {
        return String(query().get('exportJob') || '');
    }

    function chooseMimeType(MediaRecorderClass = global.MediaRecorder) {
        if (!MediaRecorderClass) return '';
        const candidates = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm',
        ];
        return candidates.find((mime) => {
            try {
                return !MediaRecorderClass.isTypeSupported
                    || MediaRecorderClass.isTypeSupported(mime);
            } catch (_) {
                return false;
            }
        }) || '';
    }

    function notify(stage, details = {}) {
        const payload = Object.assign({
            type: 'ssv-video-export',
            stage,
            jobId: jobIdFromLocation(),
        }, details);
        try {
            if (global.parent && global.parent !== global) global.parent.postMessage(payload, global.location.origin);
        } catch (_) {}
        try {
            if (global.opener && !global.opener.closed) global.opener.postMessage(payload, global.location.origin);
        } catch (_) {}
    }

    async function apiJson(path, payload) {
        const response = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        return data;
    }

    function delay(ms) {
        return new Promise(resolve => global.setTimeout(resolve, ms));
    }

    function collectStageBaseTextures(root) {
        const found = new Set();
        const addTexture = texture => {
            const baseTexture = texture && (texture.baseTexture || texture);
            if (baseTexture && typeof baseTexture === 'object') found.add(baseTexture);
        };
        const visit = displayObject => {
            if (!displayObject || typeof displayObject !== 'object') return;
            addTexture(displayObject.texture || displayObject._texture);
            const frameTextures = displayObject.textures || displayObject._textures;
            if (Array.isArray(frameTextures)) frameTextures.forEach(addTexture);
            if (Array.isArray(displayObject.children)) displayObject.children.forEach(visit);
        };
        visit(root);
        return Array.from(found);
    }

    function estimateTextureBytes(baseTexture) {
        const resource = baseTexture && baseTexture.resource;
        const width = Number(baseTexture && (baseTexture.realWidth || baseTexture.width)
            || resource && (resource.width || resource.naturalWidth) || 0);
        const height = Number(baseTexture && (baseTexture.realHeight || baseTexture.height)
            || resource && (resource.height || resource.naturalHeight) || 0);
        if (!(width > 0 && height > 0)) return 0;
        return width * height * 4;
    }

    async function warmupRenderer(app, _loader) {
        if (!app || !app.renderer) return { textures: 0 };
        // PIXI.Loader has already downloaded and decoded every scenario asset.
        // Only upload textures referenced by the currently constructed scene
        // graph here. Uploading the entire shared loader at once can consume
        // several GB for large Spine atlases even in a short scenario.
        const stageTextures = collectStageBaseTextures(app.stage);
        const textures = [];
        let estimatedBytes = 0;
        for (const baseTexture of stageTextures) {
            if (textures.length >= WARMUP_TEXTURE_LIMIT) break;
            const bytes = estimateTextureBytes(baseTexture);
            if (textures.length > 0 && estimatedBytes + bytes > WARMUP_TEXTURE_BUDGET_BYTES) continue;
            textures.push(baseTexture);
            estimatedBytes += bytes;
        }
        const textureSystem = app.renderer.texture;
        if (textureSystem && typeof textureSystem.bind === 'function') {
            textures.forEach(baseTexture => {
                try { textureSystem.bind(baseTexture, 0); } catch (_) {}
            });
            try {
                if (typeof textureSystem.reset === 'function') textureSystem.reset();
            } catch (_) {}
        }
        // Let uploads, font atlases and the first renderer/encoder allocations
        // settle before MediaRecorder and the scenario clock start.
        for (let index = 0; index < 4; index++) {
            try { app.renderer.render(app.stage); } catch (_) {}
            await delay(50);
        }
        await delay(350);
        return {
            textures: textures.length,
            estimatedBytes,
            discoveredTextures: stageTextures.length,
        };
    }

    class VideoExportSession {
        constructor(options) {
            this.jobId = String(options.jobId || '');
            this.canvas = options.canvas;
            this.eventType = String(options.eventType || '');
            this.eventId = String(options.eventId || '');
            this.recorder = null;
            this.canvasStream = null;
            this.mediaStream = null;
            this.audioContext = null;
            this.compressor = null;
            this.audioDestination = null;
            this.mimeType = '';
            this.started = false;
            this.starting = null;
            this.finishing = null;
            this.aborted = false;
            this.chunkIndex = 0;
            this.uploadQueue = Promise.resolve();
            this.uploadError = null;
            this.startedAt = 0;
            this.elapsedTimer = 0;
            this.videoTrack = null;
            this.manualVideoFrames = false;
            this.frameClock = null;
            this.frameClockUrl = '';
            this.frameClockNode = null;
            this.frameClockGain = null;
            this.frameCallback = null;
            this.frameListeners = new Set();
            this.lastFrameClockMs = null;
            this.prerollMs = 0;
            this.monitorDestination = null;
            this.monitorDisconnected = false;
        }

        async start() {
            if (this.started) return true;
            if (this.starting) return this.starting;
            this.starting = this._startInternal().finally(() => {
                this.starting = null;
            });
            return this.starting;
        }

        async _startInternal() {
            if (!this.jobId || !this.canvas) throw new Error('视频导出任务或画布尚未准备好');
            if (!this.canvas.captureStream) throw new Error('当前浏览器不支持画布视频录制');
            if (!global.MediaRecorder) throw new Error('当前浏览器不支持 MediaRecorder');

            const pixiSoundContext = global.PIXI && PIXI.sound && PIXI.sound.context;
            this.audioContext = pixiSoundContext && pixiSoundContext.audioContext;
            this.compressor = pixiSoundContext && pixiSoundContext.compressor;
            if (!this.audioContext || !this.compressor || !this.audioContext.createMediaStreamDestination) {
                throw new Error('无法连接播放器的 BGM／语音／音效混音总线');
            }

            if (this.audioContext.state !== 'running') {
                try { await this.audioContext.resume(); } catch (_) {}
                await delay(80);
            }
            if (this.audioContext.state !== 'running') {
                notify('needs-gesture', { message: '浏览器要求再次点击，才能在后台录制声音。' });
                return false;
            }

            this.audioDestination = this.audioContext.createMediaStreamDestination();
            this.compressor.connect(this.audioDestination);
            // Keep the export mix connected to MediaRecorder while silencing
            // only the page's speaker output. This lets the user work or listen
            // to something else without changing the audio written to the file.
            this.monitorDestination = this.audioContext.destination;
            try {
                this.compressor.disconnect(this.monitorDestination);
                this.monitorDisconnected = true;
            } catch (error) {
                console.warn('[ScenarioVideoExport] speaker monitor could not be muted', error);
            }
            // Chromium suspends the normal canvas repaint/capture cycle when an
            // export tab is hidden. Manual-frame mode lets the independent
            // export clock submit each off-screen render explicitly.
            this.canvasStream = this.canvas.captureStream(0);
            let videoTrack = this.canvasStream.getVideoTracks()[0];
            this.manualVideoFrames = Boolean(videoTrack && typeof videoTrack.requestFrame === 'function');
            if (!this.manualVideoFrames) {
                this.canvasStream.getTracks().forEach(track => {
                    try { track.stop(); } catch (_) {}
                });
                this.canvasStream = this.canvas.captureStream(EXPORT_FRAME_RATE);
                videoTrack = this.canvasStream.getVideoTracks()[0];
            }
            const audioTrack = this.audioDestination.stream.getAudioTracks()[0];
            if (!videoTrack || !audioTrack) throw new Error('没有取得完整的视频或音频轨道');
            this.videoTrack = videoTrack;
            this.mediaStream = new MediaStream([videoTrack, audioTrack]);

            this.mimeType = chooseMimeType();
            const options = {
                videoBitsPerSecond: 15_000_000,
                audioBitsPerSecond: 320_000,
            };
            if (this.mimeType) options.mimeType = this.mimeType;
            try {
                this.recorder = new MediaRecorder(this.mediaStream, options);
            } catch (_) {
                this.recorder = new MediaRecorder(this.mediaStream, this.mimeType ? { mimeType: this.mimeType } : undefined);
            }

            this.recorder.addEventListener('dataavailable', (event) => {
                if (this.aborted || !event.data || event.data.size <= 0) return;
                const index = this.chunkIndex++;
                this.uploadQueue = this.uploadQueue
                    .then(() => this._uploadChunk(index, event.data))
                    .catch((error) => {
                        this.uploadError = error;
                        notify('error', { message: `上传录制分片失败：${error.message}` });
                    });
            });
            this.recorder.addEventListener('error', (event) => {
                const error = event.error || new Error('浏览器录制器发生错误');
                this.uploadError = error;
                notify('error', { message: error.message });
            });

            this.recorder.start(5000);
            this.started = true;
            this.startedAt = performance.now();
            activeSession = this;
            this.elapsedTimer = global.setInterval(() => {
                notify('capturing', { elapsedMs: Math.max(0, performance.now() - this.startedAt) });
            }, 1000);
            notify('capturing', { elapsedMs: 0, mimeType: this.recorder.mimeType || this.mimeType });
            return true;
        }

        async waitForPreroll(durationMs = DEFAULT_PREROLL_MS) {
            if (!this.started || !this.frameClock) {
                throw new Error('视频预卷需要在独立帧时钟启动后运行');
            }
            const targetMs = Math.max(0, Number(durationMs) || 0);
            if (targetMs <= 0) return 0;
            notify('preroll', {
                durationMs: targetMs,
                message: '正在预录并稳定编码器；这段画面会在成片中自动裁掉。',
            });
            return new Promise((resolve, reject) => {
                let elapsedMs = 0;
                let settled = false;
                let remove = () => {};
                const finish = (error) => {
                    if (settled) return;
                    settled = true;
                    remove();
                    if (timeoutId) global.clearTimeout(timeoutId);
                    if (error) reject(error);
                    else resolve(elapsedMs);
                };
                remove = this.addFrameListener(({ deltaMs }) => {
                    elapsedMs += Math.max(0, Number(deltaMs) || 0);
                    if (elapsedMs >= targetMs) finish();
                });
                const timeoutId = global.setTimeout(() => {
                    finish(new Error('视频预卷期间帧时钟没有继续运行'));
                }, Math.max(8000, targetMs + 5000));
            });
        }

        markScenarioStart() {
            if (!this.started) return 0;
            this.prerollMs = Math.max(0, performance.now() - this.startedAt);
            notify('scenario-start', { prerollMs: this.prerollMs });
            return this.prerollMs;
        }

        async startFrameDriver(callback) {
            if (!this.started || !this.audioContext) {
                throw new Error('视频录制尚未准备好独立帧时钟');
            }
            if (typeof callback !== 'function') throw new Error('视频导出缺少画面更新回调');
            if (this.frameClock) return;
            this.frameCallback = callback;
            this.lastFrameClockMs = null;

            const onFrame = (clockMs) => {
                if (this.aborted || !this.started || !this.frameCallback) return;
                const nowMs = Number.isFinite(Number(clockMs)) ? Number(clockMs) : performance.now();
                const previous = this.lastFrameClockMs;
                this.lastFrameClockMs = nowMs;
                const deltaMs = previous == null
                    ? EXPORT_FRAME_MS
                    : Math.max(1, Math.min(1000, nowMs - previous));
                try {
                    this.frameCallback({ nowMs, deltaMs, deltaTicks: deltaMs / EXPORT_FRAME_MS });
                    for (const listener of Array.from(this.frameListeners)) listener({ nowMs, deltaMs });
                    this.requestVideoFrame();
                } catch (error) {
                    this.abort(error);
                }
            };

            // AudioWorklet runs on the audio rendering thread and therefore
            // keeps ticking while the tab is hidden. This keeps canvas frames
            // aligned with BGM, voices and sound effects. A Worker below is the
            // compatibility fallback for browsers without AudioWorklet.
            if (this.audioContext.audioWorklet && global.AudioWorkletNode && global.Blob
                && global.URL && typeof global.URL.createObjectURL === 'function') {
                try {
                    const safeJobId = this.jobId.replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'job';
                    const processorName = `ssv-export-clock-${safeJobId}`;
                    const source = `
                        class SsvExportClock extends AudioWorkletProcessor {
                            constructor() {
                                super();
                                this.accumulated = 0;
                                this.awaitingAck = false;
                                this.port.onmessage = () => { this.awaitingAck = false; };
                            }
                            process() {
                                this.accumulated += 128;
                                const interval = sampleRate / ${EXPORT_FRAME_RATE};
                                if (this.accumulated >= interval) {
                                    this.accumulated %= interval;
                                    // Never queue another full render while the
                                    // main thread/encoder is still processing the
                                    // previous one. Dropping an intermediate tick
                                    // is far safer than accumulating video frames.
                                    if (!this.awaitingAck) {
                                        this.awaitingAck = true;
                                        this.port.postMessage(currentTime * 1000);
                                    }
                                }
                                return true;
                            }
                        }
                        registerProcessor(${JSON.stringify(processorName)}, SsvExportClock);
                    `;
                    this.frameClockUrl = global.URL.createObjectURL(
                        new global.Blob([source], { type: 'text/javascript' }),
                    );
                    await this.audioContext.audioWorklet.addModule(this.frameClockUrl);
                    this.frameClockNode = new global.AudioWorkletNode(this.audioContext, processorName);
                    this.frameClockGain = this.audioContext.createGain();
                    this.frameClockGain.gain.value = 0;
                    this.frameClockNode.port.onmessage = event => {
                        try { onFrame(event.data); }
                        finally {
                            try { this.frameClockNode.port.postMessage('ack'); } catch (_) {}
                        }
                    };
                    this.frameClockNode.connect(this.frameClockGain);
                    this.frameClockGain.connect(this.audioContext.destination);
                    this.frameClock = { kind: 'audio-worklet' };
                    onFrame(this.audioContext.currentTime * 1000);
                    return;
                } catch (error) {
                    console.warn('[ScenarioVideoExport] AudioWorklet frame clock unavailable; using Worker', error);
                    this._stopFrameDriver();
                    this.frameCallback = callback;
                }
            }

            if (!global.Worker || !global.Blob || !global.URL
                || typeof global.URL.createObjectURL !== 'function') {
                throw new Error('当前浏览器无法创建后台视频帧时钟');
            }
            const workerSource = `
                const interval = ${EXPORT_FRAME_MS};
                let expected = performance.now();
                let awaitingAck = false;
                onmessage = () => { awaitingAck = false; };
                setInterval(() => {
                    const now = performance.now();
                    if (now + 1 < expected || awaitingAck) return;
                    expected = now + interval;
                    awaitingAck = true;
                    postMessage(now);
                }, interval);
            `;
            this.frameClockUrl = global.URL.createObjectURL(
                new global.Blob([workerSource], { type: 'text/javascript' }),
            );
            const worker = new global.Worker(this.frameClockUrl);
            worker.onmessage = event => {
                try { onFrame(event.data); }
                finally {
                    try { worker.postMessage('ack'); } catch (_) {}
                }
            };
            worker.onerror = event => this.abort(new Error(event.message || '视频导出后台帧时钟失败'));
            this.frameClock = { kind: 'worker', worker };
            onFrame(performance.now());
        }

        requestVideoFrame() {
            if (!this.manualVideoFrames || !this.videoTrack) return false;
            try {
                this.videoTrack.requestFrame();
                return true;
            } catch (_) {
                return false;
            }
        }

        addFrameListener(listener) {
            if (typeof listener !== 'function') return () => {};
            this.frameListeners.add(listener);
            return () => this.frameListeners.delete(listener);
        }

        async _uploadChunk(index, blob) {
            const params = new URLSearchParams({ job: this.jobId, index: String(index) });
            const response = await fetch(`./api/video-export/chunk?${params}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: blob,
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            notify('upload', { uploadedBytes: data.uploadedBytes || 0, elapsedMs: performance.now() - this.startedAt });
        }

        finish(tailMs = 1200) {
            if (this.finishing) return this.finishing;
            this.finishing = this._finishInternal(tailMs);
            return this.finishing;
        }

        async _finishInternal(tailMs) {
            if (!this.started || !this.recorder) throw new Error('视频录制尚未开始');
            notify('tail', { message: '剧情结束，正在保留收尾并淡出声音。' });
            if (tailMs > 0) await delay(tailMs);
            const durationMs = Math.max(1, performance.now() - this.startedAt);
            await new Promise((resolve) => {
                this.recorder.addEventListener('stop', resolve, { once: true });
                if (this.recorder.state === 'inactive') resolve();
                else this.recorder.stop();
            });
            await this.uploadQueue;
            if (this.uploadError) throw this.uploadError;
            this._cleanupCapture();
            const result = await apiJson('./api/video-export/finish', {
                jobId: this.jobId,
                durationMs,
                prerollMs: this.prerollMs,
                mimeType: this.recorder.mimeType || this.mimeType,
            });
            notify('transcoding', { durationMs, message: result.stage || '正在封装 MP4' });
            return result;
        }

        async abort(error) {
            if (this.aborted) return;
            this.aborted = true;
            const message = error && error.message ? error.message : String(error || '视频导出已停止');
            try {
                if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
            } catch (_) {}
            this._cleanupCapture();
            try {
                await apiJson('./api/video-export/cancel', { jobId: this.jobId, error: message });
            } catch (_) {}
            notify('error', { message });
        }

        _cleanupCapture() {
            if (this.elapsedTimer) global.clearInterval(this.elapsedTimer);
            this.elapsedTimer = 0;
            this._stopFrameDriver();
            if (this.compressor && this.audioDestination) {
                try { this.compressor.disconnect(this.audioDestination); } catch (_) {}
            }
            if (this.monitorDisconnected && this.compressor && this.monitorDestination) {
                try { this.compressor.connect(this.monitorDestination); } catch (_) {}
            }
            this.monitorDisconnected = false;
            this.monitorDestination = null;
            [this.canvasStream, this.mediaStream, this.audioDestination && this.audioDestination.stream]
                .filter(Boolean)
                .forEach(stream => stream.getTracks().forEach(track => {
                    try { track.stop(); } catch (_) {}
                }));
            if (activeSession === this) activeSession = null;
        }

        _stopFrameDriver() {
            const clock = this.frameClock;
            this.frameClock = null;
            if (clock && clock.kind === 'worker' && clock.worker) {
                try { clock.worker.terminate(); } catch (_) {}
            }
            if (this.frameClockNode) {
                try { this.frameClockNode.port.onmessage = null; } catch (_) {}
                try { this.frameClockNode.disconnect(); } catch (_) {}
            }
            if (this.frameClockGain) {
                try { this.frameClockGain.disconnect(); } catch (_) {}
            }
            if (this.frameClockUrl && global.URL && typeof global.URL.revokeObjectURL === 'function') {
                try { global.URL.revokeObjectURL(this.frameClockUrl); } catch (_) {}
            }
            this.frameClockUrl = '';
            this.frameClockNode = null;
            this.frameClockGain = null;
            this.frameCallback = null;
            this.lastFrameClockMs = null;
            this.frameListeners.clear();
        }
    }

    function attachMediaElement(element) {
        const session = activeSession;
        if (!session || !element || !session.audioContext || !session.compressor) return false;
        if (mediaNodes.has(element)) return true;
        try {
            const node = session.audioContext.createMediaElementSource(element);
            node.connect(session.compressor);
            mediaNodes.set(element, node);
            return true;
        } catch (error) {
            console.warn('[ScenarioVideoExport] media element audio could not be attached', error);
            return false;
        }
    }

    global.ScenarioVideoExport = {
        requested,
        jobIdFromLocation,
        chooseMimeType,
        notify,
        warmupRenderer,
        create(options) { return new VideoExportSession(options); },
        attachMediaElement,
        addFrameListener(listener) {
            return activeSession ? activeSession.addFrameListener(listener) : null;
        },
        get activeSession() { return activeSession; },
    };
})(globalThis);
