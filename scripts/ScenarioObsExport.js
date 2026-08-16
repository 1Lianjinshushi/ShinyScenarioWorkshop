'use strict';

(function installScenarioObsExport(global) {
    const mediaNodes = new WeakMap();
    const FRAME_RATE = 60;
    const FRAME_MS = 1000 / FRAME_RATE;
    let activeSession = null;

    const params = () => new URLSearchParams(global.location ? global.location.search : '');

    function requested() {
        return params().get('mode') === 'obs-export' && !!params().get('obsJob');
    }

    function jobId() {
        return String(params().get('obsJob') || '');
    }

    function chooseAudioMimeType(MediaRecorderClass = global.MediaRecorder) {
        if (!MediaRecorderClass) return '';
        const candidates = ['audio/webm;codecs=opus', 'audio/webm'];
        return candidates.find(mime => {
            try {
                return !MediaRecorderClass.isTypeSupported
                    || MediaRecorderClass.isTypeSupported(mime);
            } catch (_) {
                return false;
            }
        }) || '';
    }

    async function post(path, payload = {}) {
        const response = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ jobId: jobId() }, payload)),
            cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        return data;
    }

    function delay(ms) {
        return new Promise(resolve => global.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
    }

    class ObsAudioSession {
        constructor() {
            this.jobId = jobId();
            this.audioContext = null;
            this.compressor = null;
            this.audioDestination = null;
            this.monitorDestination = null;
            this.monitorDisconnected = false;
            this.recorder = null;
            this.mimeType = '';
            this.started = false;
            this.startedAt = 0;
            this.startedAtEpochMs = 0;
            this.chunkIndex = 0;
            this.uploadQueue = Promise.resolve();
            this.uploadError = null;
            this.finishing = null;
            this.aborted = false;
            this.frameClock = null;
            this.frameClockUrl = '';
            this.frameClockNode = null;
            this.frameClockGain = null;
            this.frameCallback = null;
            this.frameListeners = new Set();
            this.lastFrameClockMs = null;
        }

        async start() {
            if (this.started) return this.captureInfo();
            if (!this.jobId) throw new Error('OBS 直出任务编号缺失');
            if (!global.MediaRecorder) throw new Error('OBS 浏览器源不支持独立音轨录制');
            const soundContext = global.PIXI && PIXI.sound && PIXI.sound.context;
            this.audioContext = soundContext && soundContext.audioContext;
            this.compressor = soundContext && soundContext.compressor;
            if (!this.audioContext || !this.compressor || !this.audioContext.createMediaStreamDestination) {
                throw new Error('无法连接播放器的 BGM／语音／音效混音总线');
            }
            if (this.audioContext.state !== 'running') {
                try { await this.audioContext.resume(); } catch (_) {}
                await delay(80);
            }
            if (this.audioContext.state !== 'running') {
                throw new Error('OBS 浏览器源没有启动 WebAudio，无法生成可靠的独立音轨');
            }

            this.audioDestination = this.audioContext.createMediaStreamDestination();
            this.compressor.connect(this.audioDestination);
            this.monitorDestination = this.audioContext.destination;
            try {
                this.compressor.disconnect(this.monitorDestination);
                this.monitorDisconnected = true;
            } catch (_) {}

            const audioTrack = this.audioDestination.stream.getAudioTracks()[0];
            if (!audioTrack) throw new Error('没有取得播放器的独立音频轨道');
            this.mimeType = chooseAudioMimeType();
            const options = { audioBitsPerSecond: 320_000 };
            if (this.mimeType) options.mimeType = this.mimeType;
            try {
                this.recorder = new MediaRecorder(this.audioDestination.stream, options);
            } catch (_) {
                this.recorder = new MediaRecorder(
                    this.audioDestination.stream,
                    this.mimeType ? { mimeType: this.mimeType } : undefined,
                );
            }
            this.recorder.addEventListener('dataavailable', event => {
                if (this.aborted || !event.data || event.data.size <= 0) return;
                const index = this.chunkIndex++;
                this.uploadQueue = this.uploadQueue
                    .then(() => this.uploadChunk(index, event.data))
                    .catch(error => { this.uploadError = error; });
            });
            this.recorder.addEventListener('error', event => {
                this.uploadError = event.error || new Error('OBS 独立音轨录制器发生错误');
            });
            this.startedAtEpochMs = Date.now();
            this.startedAt = performance.now();
            this.recorder.start(5000);
            this.started = true;
            activeSession = this;
            return this.captureInfo();
        }

        captureInfo() {
            return {
                audioStartedAtEpochMs: this.startedAtEpochMs,
                audioMimeType: this.recorder && this.recorder.mimeType || this.mimeType || 'audio/webm',
            };
        }

        async uploadChunk(index, blob) {
            const query = new URLSearchParams({ job: this.jobId, index: String(index) });
            const response = await fetch(`./api/obs-export/audio-chunk?${query}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: blob,
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            return data;
        }

        async startFrameDriver(callback) {
            if (!this.started || !this.audioContext) throw new Error('OBS 独立音轨尚未开始');
            if (typeof callback !== 'function') throw new Error('OBS 后台帧时钟缺少画面更新回调');
            if (this.frameClock) return;
            this.frameCallback = callback;
            this.lastFrameClockMs = null;

            const onFrame = clockMs => {
                if (this.aborted || !this.started || !this.frameCallback) return;
                const nowMs = Number.isFinite(Number(clockMs)) ? Number(clockMs) : performance.now();
                const previous = this.lastFrameClockMs;
                this.lastFrameClockMs = nowMs;
                const deltaMs = previous == null
                    ? FRAME_MS
                    : Math.max(1, Math.min(1000, nowMs - previous));
                try {
                    this.frameCallback({ nowMs, deltaMs, deltaTicks: deltaMs / FRAME_MS });
                    for (const listener of Array.from(this.frameListeners)) listener({ nowMs, deltaMs });
                } catch (error) {
                    this.fail(error);
                }
            };

            if (this.audioContext.audioWorklet && global.AudioWorkletNode && global.Blob
                && global.URL && typeof global.URL.createObjectURL === 'function') {
                try {
                    const safeJobId = this.jobId.replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'job';
                    const processorName = `ssv-obs-clock-${safeJobId}`;
                    const source = `
                        class SsvObsClock extends AudioWorkletProcessor {
                            constructor() {
                                super();
                                this.accumulated = 0;
                                this.awaitingAck = false;
                                this.port.onmessage = () => { this.awaitingAck = false; };
                            }
                            process() {
                                this.accumulated += 128;
                                const interval = sampleRate / ${FRAME_RATE};
                                if (this.accumulated >= interval) {
                                    this.accumulated %= interval;
                                    if (!this.awaitingAck) {
                                        this.awaitingAck = true;
                                        this.port.postMessage(currentTime * 1000);
                                    }
                                }
                                return true;
                            }
                        }
                        registerProcessor(${JSON.stringify(processorName)}, SsvObsClock);
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
                    this.frameClockGain.connect(this.audioDestination);
                    this.frameClock = { kind: 'audio-worklet' };
                    onFrame(this.audioContext.currentTime * 1000);
                    return;
                } catch (error) {
                    console.warn('[ScenarioObsExport] AudioWorklet unavailable; using Worker', error);
                    this.stopFrameDriver();
                    this.frameCallback = callback;
                }
            }

            if (!global.Worker || !global.Blob || !global.URL) {
                throw new Error('OBS 浏览器源无法创建独立后台帧时钟');
            }
            const workerSource = `
                const interval = ${FRAME_MS};
                let awaitingAck = false;
                onmessage = () => { awaitingAck = false; };
                setInterval(() => {
                    if (awaitingAck) return;
                    awaitingAck = true;
                    postMessage(performance.now());
                }, interval);
            `;
            this.frameClockUrl = global.URL.createObjectURL(
                new global.Blob([workerSource], { type: 'text/javascript' }),
            );
            const worker = new global.Worker(this.frameClockUrl);
            worker.onmessage = event => {
                try { onFrame(event.data); }
                finally { try { worker.postMessage('ack'); } catch (_) {} }
            };
            worker.onerror = event => this.fail(new Error(event.message || 'OBS 后台帧时钟失败'));
            this.frameClock = { kind: 'worker', worker };
            onFrame(performance.now());
        }

        waitForPreroll(durationMs = 800) {
            const target = Math.max(0, Number(durationMs) || 0);
            if (!this.frameClock || target <= 0) return Promise.resolve(0);
            return new Promise((resolve, reject) => {
                let elapsed = 0;
                let remove = () => {};
                const timeout = global.setTimeout(() => {
                    remove();
                    reject(new Error('OBS 预录期间后台时钟没有继续运行'));
                }, Math.max(8000, target + 5000));
                const listener = ({ deltaMs }) => {
                    elapsed += Math.max(0, Number(deltaMs) || 0);
                    if (elapsed < target) return;
                    remove();
                    global.clearTimeout(timeout);
                    resolve(elapsed);
                };
                this.frameListeners.add(listener);
                remove = () => this.frameListeners.delete(listener);
            });
        }

        async finish(tailMs = 1300) {
            if (this.finishing) return this.finishing;
            this.finishing = (async () => {
                if (tailMs > 0) await delay(tailMs);
                const audioDurationMs = Math.max(1, performance.now() - this.startedAt);
                if (!this.recorder) throw new Error('OBS 独立音轨录制器没有启动');
                await new Promise(resolve => {
                    this.recorder.addEventListener('stop', resolve, { once: true });
                    if (this.recorder.state === 'inactive') resolve();
                    else this.recorder.stop();
                });
                await this.uploadQueue;
                if (this.uploadError) throw this.uploadError;
                const audioChunkCount = this.chunkIndex;
                this.cleanup();
                return post('./api/obs-export/player-finished', { audioDurationMs, audioChunkCount });
            })();
            return this.finishing;
        }

        async fail(error) {
            if (this.aborted) return null;
            this.aborted = true;
            const message = error && error.message ? error.message : String(error || 'OBS 浏览器源播放失败');
            try {
                if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
            } catch (_) {}
            this.cleanup();
            try { return await post('./api/obs-export/player-error', { error: message }); }
            catch (_) { return null; }
        }

        attachMediaElement(element) {
            if (!element || !this.audioContext || !this.compressor) return false;
            if (mediaNodes.has(element)) return true;
            try {
                const node = this.audioContext.createMediaElementSource(element);
                node.connect(this.compressor);
                mediaNodes.set(element, node);
                return true;
            } catch (error) {
                console.warn('[ScenarioObsExport] media audio could not be attached', error);
                return false;
            }
        }

        stopFrameDriver() {
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
            if (this.frameClockUrl && global.URL) {
                try { global.URL.revokeObjectURL(this.frameClockUrl); } catch (_) {}
            }
            this.frameClockUrl = '';
            this.frameClockNode = null;
            this.frameClockGain = null;
            this.frameCallback = null;
            this.lastFrameClockMs = null;
            this.frameListeners.clear();
        }

        cleanup() {
            this.stopFrameDriver();
            if (this.compressor && this.audioDestination) {
                try { this.compressor.disconnect(this.audioDestination); } catch (_) {}
            }
            if (this.monitorDisconnected && this.compressor && this.monitorDestination) {
                try { this.compressor.connect(this.monitorDestination); } catch (_) {}
            }
            this.monitorDisconnected = false;
            if (this.audioDestination && this.audioDestination.stream) {
                this.audioDestination.stream.getTracks().forEach(track => {
                    try { track.stop(); } catch (_) {}
                });
            }
            if (activeSession === this) activeSession = null;
        }
    }

    function session() {
        if (!activeSession) activeSession = new ObsAudioSession();
        return activeSession;
    }

    async function ready() {
        const capture = await session().start();
        return post('./api/obs-export/player-ready', capture);
    }

    async function finish(tailMs = 1300) {
        return session().finish(tailMs);
    }

    async function fail(error) {
        if (activeSession) return activeSession.fail(error);
        const message = error && error.message ? error.message : String(error || 'OBS 浏览器源播放失败');
        try { return await post('./api/obs-export/player-error', { error: message }); }
        catch (_) { return null; }
    }

    global.ScenarioObsExport = {
        requested,
        jobId,
        chooseAudioMimeType,
        ready,
        finish,
        fail,
        delay,
        startFrameDriver(callback) { return session().startFrameDriver(callback); },
        waitForPreroll(durationMs) { return session().waitForPreroll(durationMs); },
        attachMediaElement(element) { return activeSession ? activeSession.attachMediaElement(element) : false; },
        get activeSession() { return activeSession; },
    };
})(globalThis);
