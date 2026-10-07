'use strict';

// Isolated proof: production classes, assets, fonts and control presets are reused.
// Missing assets fail; movies advance only on the export clock.
const proof = window.proof = { events: [], sounds: [], snapshots: [], endedAt: null, frame: 0 };
proof.soundInstances = [];
const time = () => exportOffline ? exportClock.ms / 1000 : (exportNative.now() - proof.startedAt) / 1000;
const manifest = () => {
    const converter = new AdvResourceConverter();
    const tracks = converter.convertResourcePaths(proof.raw);
    return [
        ['uiParts', UI_PARTS_URL], ['uiCommonParts', UI_COMMON_PARTS_URL],
        ['uiCommonAtlas', UI_COMMON_ATLAS_URL], ['uiInitPop', './assets/images/ui/init/parts_pop.json'],
        [UI_TAP_SE_KEY, UI_TAP_SE_URL], [UI_CANCEL_SE_KEY, UI_CANCEL_SE_URL],
        [SELECT_ANSWER_SE_KEY, SELECT_ANSWER_SE_URL], [PRODUCER_BUBBLE_KEY, PRODUCER_BUBBLE_URL],
        [TAP_EFFECT_PARTICLES_KEY, TAP_EFFECT_PARTICLES_URL],
        [TAP_EFFECT_PARTICLE_CONFIG_KEY, TAP_EFFECT_PARTICLE_CONFIG_URL],
        [TAP_EFFECT_FEATHER_CONFIG_KEY, TAP_EFFECT_FEATHER_CONFIG_URL],
        ...(proof.raw.some(t => t.select) ? [1, 2, 3].map(n =>
            [`selectFrame${n}`, `./assets/images/event/select_frame/00${n}.png`]) : []),
        ...(proof.choiceCount > 1 ? [['choiceTransition', './assets/movies/choice_branch_return.mp4']] : []),
        // Direct export never opens ScenarioLogLayer.  Requiring its optional
        // decorative frame can reject an otherwise complete story (some frame
        // IDs have no valid log variant and the log layer already has a
        // Graphics fallback).  Keep every actual playback asset mandatory.
        ...converter.extractResourceList(tracks, { includeLogTextFrames: false }).map(url => [url, url]),
    ];
};
proof.describe = (raw, options = {}) => {
    proof.raw = raw;
    proof.choiceCount = raw.filter(t => t.select).length;
    proof.options = { trimEnd: true, branchPreview: false, endHoldSeconds: 2, diagnostics: false, ...options };
    if (!Number.isFinite(proof.options.endHoldSeconds) || proof.options.endHoldSeconds < 0)
        throw new Error('Invalid ending hold duration');
    proof.previewStart = proof.options.branchPreview ? OfflineFlow.previewStart(raw) : 0;
    proof.outroIndex = proof.options.trimEnd ? OfflineFlow.terminalOutro(raw) : -1;
    proof.progressNodes = new Set(OfflineFlow.storyNodeIndices(raw));
    proof.progressSeen = new Set();
    proof.choiceNumber = 0;
    proof.branchTextCount = 0;
    proof.ending = null;
    return manifest();
};
// Use exactly PIXI's decoder (AAC priming/padding differs from FFmpeg's decoder).
// One source buffer at a time; transfer one second of PCM per request.
proof.decodeAudio = async url => {
    const bytes = await (await fetch(url)).arrayBuffer();
    proof.decodedAudio = await new Promise((resolve, reject) =>
        PIXI.sound.context.decode(bytes, (error, buffer) => error ? reject(error) : resolve(buffer)));
    const b = proof.decodedAudio;
    if (b.sampleRate !== 48000) throw new Error('This proof expects a 48 kHz decoder');
    return { samples: b.length, duration: b.duration, channels: b.numberOfChannels };
};
proof.audioChunk = start => {
    const b = proof.decodedAudio;
    const frames = Math.min(48000, b.length - start);
    const interleaved = new Float32Array(frames * 2);
    const left = b.getChannelData(0), right = b.getChannelData(Math.min(1, b.numberOfChannels - 1));
    for (let i = 0; i < frames; i++) { interleaved[i * 2] = left[start + i]; interleaved[i * 2 + 1] = right[start + i]; }
    const bytes = new Uint8Array(interleaved.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
};
proof.audioMasterParameters = () => {
    const parameters = {};
    for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release'])
        parameters[key] = PIXI.sound.context.compressor[key].value;
    return parameters;
};
proof.recordGain = (gains, at, value) => {
    const last = gains.at(-1), previous = gains.at(-2);
    // Keep both ends of a plateau so interpolation before a later ramp is
    // identical; don't accumulate thousands of identical per-frame points.
    if (last && previous && last[1] === value && previous[1] === value) last[0] = at;
    else gains.push([at, value]);
};

class OfflineSound extends PIXI.utils.EventEmitter {
    constructor(resource, options) {
        super();
        this.resource = resource;
        this.duration = resource.duration;
        this.loop = !!options.loop;
        this.stopped = false;
        this._volume = 1;
        this.record = { url: resource.url, start: time(), duration: this.duration,
            loop: this.loop, gains: [[time(), 1]], stop: null };
        proof.sounds.push(this.record);
        proof.soundInstances.push(this);
        if (!this.loop) this.timer = exportClock.setTimeout(() => {
            this.stopped = true;
            this.record.stop = time();
            proof.events.push({ kind: 'audio-end', url: resource.url, time: time() });
            this.emit('end');
        }, this.duration * 1000);
    }
    get volume() { return this._volume; }
    set volume(value) {
        this._volume = value;
        proof.recordGain(this.record.gains, time(), value);
    }
    stop() {
        if (this.stopped) return;
        this.stopped = true;
        this.record.stop = time();
        exportClock.clearTimeout(this.timer);
    }
    get paused() { return false; }
    set paused(value) { if (value) throw new Error('Offline pause command is not supported by this proof'); }
}

proof.prepare = async (audioMetadata, movieMetadata = {}) => {
    console.log('[proof] Loading fonts');
    applyScenarioLanguage(proof.options.language || 'ja');
    await ssvLegacyFontPromise;
    await document.fonts.ready;
    console.log('[proof] Creating renderer');
    PIXI.utils.skipHello();
    gsap.registerPlugin(PixiPlugin);
    PixiPlugin.registerPIXI(PIXI);
    const settings = { ...ScenarioRenderQuality.applicationOptions(window), autoStart: false,
        preserveDrawingBuffer: true, sharedTicker: false };
    ScenarioRenderQuality.configurePixi(PIXI, settings.resolution, settings.textResolution);
    proof.app = new PIXI.Application(settings);
    proof.app.view.id = 'ShinyColors';
    document.body.appendChild(proof.app.view);
    resizeCanvas(proof.app);
    const loader = PIXI.Loader.shared;
    const errors = [];
    loader.onError.add((e, _, r) => errors.push(`${r.url}: ${e.message}`));
    for (const [key, url] of manifest()) {
        if (loader.resources[key]) continue;
        if (exportOffline && movieMetadata[url]) continue;
        if (exportOffline && audioMetadata[url]) {
            const meta = { url, duration: audioMetadata[url].duration, volume: 1 };
            meta.play = options => new OfflineSound(meta, options);
            loader.resources[key] = { url, sound: meta };
        } else loader.add(key, url);
    }
    console.log('[proof] Loading assets');
    await ssvLoadPixiResources(loader, l => console.log('[proof] Assets', Math.round(l.progress)));
    console.log('[proof] Creating player');
    if (errors.length) throw new Error(errors.join('\n'));
    proof.audioMetadata = audioMetadata;
    proof.movieMetadata = movieMetadata;
    proof.player = new AdvPlayer(proof.app, {});
    if (exportOffline) {
        const old = proof.player._movieLayer;
        const parent = old.stageObj.parent;
        const index = parent.getChildIndex(old.stageObj);
        parent.removeChild(old.stageObj);
        old.reset();
        proof.player._movieLayer = new OfflineMovieLayer();
        parent.addChildAt(proof.player._movieLayer.stageObj, index);
    }
    console.log('[proof] Player constructed');
    proof.app.stage.addChild(proof.player.stageObj);
    proof.tracks = new AdvResourceConverter().convertResourcePaths(proof.raw);
    proof.installFlow();
    if (!exportOffline) {
        // Observe real PIXI/WebAudio end events without recording the desktop output.
        for (const resource of Object.values(loader.resources)) {
            if (!resource.sound || !resource.sound.play) continue;
            const originalPlay = resource.sound.play.bind(resource.sound);
            resource.sound.play = options => {
                const instance = originalPlay(options);
                proof.events.push({ kind: 'audio-start', url: resource.url, time: time(),
                    duration: resource.sound.duration, loop: !!options.loop });
                if (instance && instance.once) instance.once('end', () => {
                    proof.events.push({ kind: 'audio-end', url: resource.url, time: time() });
                });
                return instance;
            };
        }
        const context = PIXI.sound.context;
        proof.silentSink = context.audioContext.createMediaStreamDestination();
        context.compressor.disconnect();
        context.compressor.connect(proof.silentSink);
        await context.audioContext.resume();
    }
    // Render UI/font textures once before any scenario clock begins.
    proof.app.renderer.render(proof.app.stage);
    console.log('[proof] First render complete');
    return { width: proof.app.view.width, height: proof.app.view.height,
        renderer: proof.app.renderer.type, resources: Object.keys(loader.resources).length,
        language: proof.options.language || 'ja', fonts: { dialogue: [...USED_FONT], speaker: [...USED_FONT_SPEAKER], ui: [...USED_FONT_UI] } };
};
proof.installFlow = () => {
    const forward = proof.player._forward;
    proof.player._forward = function () {
        if (proof.ending || proof.endedAt != null) return;
        const manager = this._trackManager;
        if (manager?.currentTrack?.text && !this._selectList.active) {
            const previewEnd = proof.options.branchPreview && proof.choiceNumber === 2
                && proof.branchTextCount === 2;
            const finalBranch = proof.choiceNumber >= proof.choiceCount;
            const dialogueEnd = proof.options.trimEnd && finalBranch
                && OfflineFlow.terminalDialogue(proof.raw, manager.currentIndex, manager._nextLabel);
            if (previewEnd || dialogueEnd) {
                proof.beginEnding(previewEnd ? 'two-lines-after-second-choice' : 'final-dialogue-complete');
                return;
            }
        }
        return forward.apply(this, arguments);
    };
    const original = proof.player._playTrack;
    proof.player._playTrack = function (track) {
        if (proof.ending || proof.endedAt != null) return;
        const index = this._trackManager.currentIndex;
        if (index === proof.outroIndex && proof.choiceNumber >= proof.choiceCount) {
            proof.complete('terminal-black-outro-omitted');
            return;
        }
        if (proof.options.branchPreview && proof.choiceNumber === 2 && track.text) {
            if (proof.branchTextCount === 2) { proof.complete('two-lines-after-second-choice'); return; }
            proof.branchTextCount++;
        }
        if (proof.captureStartFrame == null && index === proof.previewStart) {
            proof.captureStartFrame = proof.frame;
            proof.events.push({ kind: 'capture-start', time: time(), index });
        }
        if (proof.progressNodes.has(index)) proof.progressSeen.add(index);
        proof.events.push({ kind: 'track', time: time(), index: this._trackManager.currentIndex,
            id: track.id || null, text: track.text || '' });
        return original.call(this, track);
    };
    proof.player.on('end', () => {
        if (proof.choiceNumber < proof.choiceCount) proof.returnChoice();
        else proof.complete('scenario-end');
    });
    proof.player.on('choiceReturnLeadIn', () => {
        if (proof.choiceNumber < proof.choiceCount) proof.returnChoice();
    });
    proof.player._selectList.on('appear', () => {
        proof.choiceReadyAt = null;
        proof.events.push({ kind: 'choice-appear', time: time(), cycle: proof.choiceNumber });
    });
};
proof.beginEnding = reason => {
    if (proof.ending || proof.endedAt != null) return;
    proof.ending = { reason, requestedAt: time(), startedAt: null, deadline: null,
        index: proof.player._trackManager.currentIndex };
    proof.advanceEnding();
};
proof.advanceEnding = () => {
    const ending = proof.ending;
    if (!ending || proof.endedAt != null) return;
    if (ending.startedAt == null) {
        // autoWait can expire before a long voice/typewriter. Let both finish
        // naturally; never endText(), pause(), removeSe() or freeze the renderer.
        const p = proof.player;
        if (p._scenarioPlayer.playing || (p._currentVoiceEndHandler && !p._currentVoiceIsLooping)) return;
        ending.startedAt = time();
        ending.deadline = time() + proof.options.endHoldSeconds;
        proof.events.push({ kind: 'ending-hold-start', time: time(), index: ending.index,
            seconds: proof.options.endHoldSeconds, reason: ending.reason });
    }
    if (time() >= ending.deadline - 1e-7) proof.complete(ending.reason);
};
proof.complete = reason => {
    if (proof.endedAt != null) return;
    proof.endedAt = time();
    proof.completeReason = reason;
    proof.player.pause();
    proof.events.push({ kind: 'export-complete', reason, time: time() });
};
proof.returnChoice = () => {
    if (proof.choiceCount <= 1 || proof.returning || proof.player._choiceReturnTransitionPromise) return;
    proof.returning = true;
    proof.choiceReadyAt = null;
    proof.events.push({ kind: 'transition-start', time: time() });
    proof.player.playChoiceReturnTransition('./assets/movies/choice_branch_return.mp4').then(ok => {
        if (!ok) throw new Error('Choice return failed');
        proof.returning = false;
        proof.choiceReadyAt = null;
        proof.events.push({ kind: 'transition-end', time: time(), auto: proof.player._mode === SpeedMode.AUTO });
    }).catch(error => { proof.asyncError = error.message; });
};
proof.advanceChoices = () => {
    if (proof.ending || proof.endedAt != null) return;
    const list = proof.player._selectList;
    if (!list.active || list._selecting || proof.returning || proof.player._isMoviePlaying) return;
    if (proof.choiceReadyAt == null) {
        proof.choiceReadyAt = time();
        proof.events.push({ kind: 'choice-ready', time: time(), cycle: proof.choiceNumber });
    }
    if (time() - proof.choiceReadyAt < 3 - 1e-7) return;
    const order = OfflineFlow.choiceOrder(list._items);
    const item = order[proof.choiceNumber];
    if (!item) throw new Error('No next choice in middle-left-right sequence');
    const position = order.length === 1 ? 'only' : ['middle', 'left', 'right'][proof.choiceNumber];
    proof.events.push({ kind: 'choice-click', time: time(), wait: time() - proof.choiceReadyAt,
        position, text: item._textValue, label: item._ssvNextLabel });
    proof.choiceNumber++;
    proof.branchTextCount = 0;
    list._onSelectItem(item, item._textValue, item._ssvNextLabel, item._metadata);
};
proof.start = () => {
    proof.startedAt = exportNative.now();
    if (exportOffline) {
        proof.app.ticker.stop();
        PIXI.Ticker.shared.stop();
        PIXI.Ticker.system.stop();
        gsap.ticker.sleep();
        gsap.ticker.lagSmoothing(0);
        window.requestAnimationFrame = () => 0;
        window.cancelAnimationFrame = () => {};
        window.setTimeout = exportClock.setTimeout.bind(exportClock);
        window.clearTimeout = exportClock.clearTimeout.bind(exportClock);
        window.setInterval = () => { throw new Error('Unadapted interval in offline runtime'); };
    }
    proof.player.start(proof.tracks);
    proof.player.setAutoEnabled(true);
    if (!exportOffline) {
        proof.app.ticker.add(delta => {
            proof.player.update(delta);
            proof.advanceChoices();
            proof.advanceEnding();
            proof.frame++;
            proof.captureSnapshot();
        });
        proof.app.start();
    }
};
proof.state = () => ({ time: time(), frame: proof.frame, endedAt: proof.endedAt,
    text: proof.player._scenarioPlayer._textObj.text,
    index: proof.player._trackManager.currentIndex,
    characters: [...proof.player._characterStage._spineMap.values()].map(s => ({
        animations: s.state.tracks.map(t => t && ({ name: t.animation.name, trackTime: t.trackTime })),
        alpha: s.parent.alpha, visible: s.visible,
        bones: s.skeleton.bones.map(b => [b.worldX, b.worldY, b.a, b.b, b.c, b.d]),
    })), fatal: proof.player._fatalError });
proof.captureSnapshot = () => {
    if (!proof.options.diagnostics) return;
    const first = [0.55, 0.65, 1.5, 3, 5, 7, 9, 11, 13];
    const target = proof.snapshots.length < first.length ? first[proof.snapshots.length]
        : 15 + (proof.snapshots.length - first.length) * 5;
    if (time() >= target) proof.snapshots.push(proof.state());
};
proof.step = async (frame, capture = true) => {
    if (!exportOffline) throw new Error('Cannot manually advance the real-time reference');
    proof.frame = frame;
    exportClock.advanceTo(frame * 1000 / 60);
    proof.player.update(frame ? 1 : 0);
    await Promise.resolve();
    if (proof.player._movieLayer.updateOffline) await proof.player._movieLayer.updateOffline();
    await Promise.resolve();
    gsap.ticker.tick();
    gsap.ticker.sleep();
    await Promise.resolve();
    proof.advanceChoices();
    proof.advanceEnding();
    proof.app.renderer.render(proof.app.stage);
    proof.soundInstances.forEach(s => {
        if (!s.stopped) proof.recordGain(s.record.gains, time(), s.volume);
    });
    proof.captureSnapshot();
    if (proof.player._fatalError) throw new Error(JSON.stringify(proof.player._fatalError));
    if (proof.asyncError) throw new Error(proof.asyncError);
    return { done: proof.endedAt != null, captureStartFrame: proof.captureStartFrame,
        storyCompleted: proof.progressSeen?.size || 0, storyTotal: proof.progressNodes?.size || 0,
        png: capture ? proof.app.view.toDataURL('image/png').split(',')[1] : null };
};
proof.checkEncoder = async () => {
    // Low-latency here only avoids the codec buffering future frames. It does NOT
    // drive the scenario clock. Every submitted frame must produce an exact ACK.
    const config = { codec: 'avc1.64002a', width: 1920, height: 1080, bitrate: 30000000,
        framerate: 60, hardwareAcceleration: 'prefer-hardware', latencyMode: 'realtime',
        bitrateMode: 'variable', avc: { format: 'annexb' } };
    const supported = await VideoEncoder.isConfigSupported(config);
    if (!supported.supported) throw new Error('H.264 hardware-preferred encoder configuration unavailable');
    return supported.config;
};
proof.advancePreroll = async (start, count = 6) => {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || count < 1 || count > 6)
        throw new Error('Invalid preroll batch');
    let result, frame = start, steps = 0;
    for (; steps < count; steps++, frame++) {
        result = await proof.step(frame, false);
        if (result.done || result.captureStartFrame != null) {
            return { ...result, frame, steps: steps + 1, index: proof.player._trackManager.currentIndex };
        }
    }
    return { ...result, frame: frame - 1, steps, index: proof.player._trackManager.currentIndex };
};
proof.prepareEncoder = async () => {
    const config = await proof.checkEncoder();
    proof.encodedCount = 0;
    proof.encoder = new VideoEncoder({
        output(chunk, metadata) {
            const pending = proof.pendingFrame;
            if (!pending || pending.timestamp !== chunk.timestamp) {
                proof.encoderError = new Error('Unexpected, dropped or reordered video frame');
                if (pending) pending.reject(proof.encoderError);
                return;
            }
            proof.pendingFrame = null;
            proof.encodedCount++;
            const bytes = new Uint8Array(chunk.byteLength);
            chunk.copyTo(bytes);
            let binary = '';
            for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            proof.decoderConfig = metadata?.decoderConfig || proof.decoderConfig;
            pending.resolve({ timestamp: chunk.timestamp, type: chunk.type, data: btoa(binary) });
        },
        error(error) {
            proof.encoderError = error;
            if (proof.pendingFrame) proof.pendingFrame.reject(error);
        },
    });
    proof.encoder.configure(config);
    return config;
};
proof.encodeFrame = async frame => {
    if (proof.encoderError) throw proof.encoderError;
    if (proof.pendingFrame) throw new Error('More than one frame in flight');
    const timestamp = Math.round(frame * 1000000 / 60);
    let timer;
    const complete = new Promise((resolve, reject) => {
        proof.pendingFrame = { timestamp, resolve, reject };
        timer = exportNative.timeout(() => reject(new Error('Encoder did not acknowledge the frame')), 15000);
    });
    const videoFrame = new VideoFrame(proof.app.view, { timestamp, duration: Math.round(1000000 / 60), alpha: 'discard' });
    try {
        try { proof.encoder.encode(videoFrame, { keyFrame: frame % 120 === 0 }); }
        finally { videoFrame.close(); }
        return await complete;
    }
    finally { exportNative.clearTimeout(timer); }
};
proof.finishEncoder = async () => {
    await proof.encoder.flush();
    if (proof.encoderError) throw proof.encoderError;
    proof.encoder.close();
    return proof.encodedCount;
};
proof.releaseVisuals = () => {
    // Audio mastering does not need the GPU scene, decoded movie surface or
    // Spine textures. Release them before allocating the full output buffer.
    proof.player?._movieLayer.reset();
    proof.app?.destroy(true, { children: true, texture: true, baseTexture: true });
    proof.app = null;
    proof.player = null;
    proof.soundInstances = [];
};
proof.report = () => ({ events: proof.events, sounds: proof.sounds, snapshots: proof.snapshots,
    movies: proof.movies || [],
    frame: proof.frame, endedAt: proof.endedAt, completeReason: proof.completeReason, ending: proof.ending,
    captureStartFrame: proof.captureStartFrame, options: proof.options,
    time: time(), masterVolume: PIXI.sound.volumeAll });
