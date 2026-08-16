'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

function loadApi(search, supported) {
    class RecorderStub {}
    RecorderStub.isTypeSupported = mime => supported.includes(mime);
    const context = {
        URLSearchParams,
        location: { search, origin: 'http://127.0.0.1:8000' },
        MediaRecorder: RecorderStub,
        console,
        setTimeout: (callback) => { callback(); return 0; },
        globalThis: null,
    };
    context.globalThis = context;
    vm.createContext(context);
    const source = fs.readFileSync(
        path.resolve(__dirname, '../scripts/ScenarioVideoExport.js'),
        'utf8',
    );
    vm.runInContext(source, context);
    return context.ScenarioVideoExport;
}

test('video export mode requires both mode and a server job', () => {
    const api = loadApi('?mode=export&exportJob=abc123', ['video/webm']);
    assert.equal(api.requested(), true);
    assert.equal(api.jobIdFromLocation(), 'abc123');

    const missingJob = loadApi('?mode=export', ['video/webm']);
    assert.equal(missingJob.requested(), false);
});

test('video export selects the best supported WebM recorder format', () => {
    const vp8 = loadApi('', ['video/webm;codecs=vp8,opus', 'video/webm']);
    assert.equal(vp8.chooseMimeType(), 'video/webm;codecs=vp8,opus');

    const generic = loadApi('', ['video/webm']);
    assert.equal(generic.chooseMimeType(), 'video/webm');
});

test('video export builds and warms the real player before recording or advancing tracks', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../remote-main.js'), 'utf8');
    const buildIndex = source.indexOf('advPlayer = new AdvPlayer(app, volumeConfig);');
    const warmupIndex = source.indexOf('ScenarioVideoExport.warmupRenderer(app, loader)');
    const recordIndex = source.indexOf('videoExporter.start()');
    const frameClockIndex = source.indexOf('videoExporter.startFrameDriver');
    const prerollIndex = source.indexOf('videoExporter.waitForPreroll(1000)');
    const markStartIndex = source.indexOf('videoExporter.markScenarioStart()');
    const scenarioIndex = source.indexOf('advPlayer.start(tracks)');

    assert.ok(buildIndex >= 0 && buildIndex < warmupIndex,
        'the actual player scene graph should exist before GPU/font warm-up');
    assert.ok(warmupIndex < recordIndex,
        'MediaRecorder must not include the warm-up frames');
    assert.ok(recordIndex < scenarioIndex,
        'scenario tracks and audio must begin only after recording starts');
    assert.ok(recordIndex < frameClockIndex && frameClockIndex < prerollIndex,
        'the independent capture clock should run throughout encoder pre-roll');
    assert.ok(prerollIndex < markStartIndex && markStartIndex < scenarioIndex,
        'the measured pre-roll must end immediately before scenario tracks and audio begin');
});

test('renderer warm-up uploads only textures mounted in the player scene', async () => {
    const api = loadApi('', ['video/webm']);
    const stageTexture = { width: 1024, height: 1024 };
    const unrelatedLoaderTexture = { width: 4096, height: 4096 };
    const bound = [];
    let renders = 0;
    const app = {
        stage: {
            children: [{ texture: { baseTexture: stageTexture }, children: [] }],
        },
        renderer: {
            texture: {
                bind(texture) { bound.push(texture); },
                reset() {},
            },
            render() { renders++; },
        },
    };
    const loader = {
        resources: {
            unrelated: { texture: { baseTexture: unrelatedLoaderTexture } },
        },
    };

    const result = await api.warmupRenderer(app, loader);
    assert.deepStrictEqual(bound, [stageTexture]);
    assert.equal(bound.includes(unrelatedLoaderTexture), false,
        'resources not mounted in the current scene must stay CPU-decoded instead of being forced into GPU memory');
    assert.equal(result.textures, 1);
    assert.equal(result.estimatedBytes, 1024 * 1024 * 4);
    assert.equal(renders, 4);
});

test('video export manually submits frames from an independent worker clock', async () => {
    let workerInstance = null;
    let workerSourceText = '';
    let workerAcks = 0;
    let requestedFrames = 0;
    const captureRates = [];
    const videoTrack = {
        requestFrame() { requestedFrames++; },
        stop() {},
    };
    const audioTrack = { stop() {} };
    const canvasStream = {
        getVideoTracks: () => [videoTrack],
        getTracks: () => [videoTrack],
    };
    const audioStream = {
        getAudioTracks: () => [audioTrack],
        getTracks: () => [audioTrack],
    };
    class MediaStreamStub {
        constructor(tracks) { this.tracks = tracks; }
        getTracks() { return this.tracks; }
    }
    class RecorderStub {
        static isTypeSupported() { return true; }
        constructor() {
            this.state = 'inactive';
            this.mimeType = 'video/webm';
            this.listeners = new Map();
        }
        addEventListener(name, listener) { this.listeners.set(name, listener); }
        start() { this.state = 'recording'; }
        stop() { this.state = 'inactive'; }
    }
    class WorkerStub {
        constructor() { workerInstance = this; }
        emit(time) { this.onmessage({ data: time }); }
        postMessage(value) { if (value === 'ack') workerAcks++; }
        terminate() { this.terminated = true; }
    }
    class BlobStub {
        constructor(parts) { this.parts = parts; }
    }
    const monitorDestination = { kind: 'speakers' };
    const compressorConnections = [];
    const compressorDisconnections = [];
    const audioContext = {
        state: 'running',
        destination: monitorDestination,
        createMediaStreamDestination: () => ({ stream: audioStream }),
    };
    const compressor = {
        connect(destination) { compressorConnections.push(destination); },
        disconnect(destination) { compressorDisconnections.push(destination); },
    };
    const context = {
        URLSearchParams,
        URL: {
            createObjectURL: (blob) => {
                workerSourceText = (blob.parts || []).join('');
                return 'blob:clock';
            },
            revokeObjectURL() {},
        },
        Blob: BlobStub,
        Worker: WorkerStub,
        MediaRecorder: RecorderStub,
        MediaStream: MediaStreamStub,
        performance,
        location: { search: '?mode=export&exportJob=test', origin: 'http://127.0.0.1:8000' },
        PIXI: { sound: { context: { audioContext, compressor } } },
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        globalThis: null,
    };
    context.globalThis = context;
    vm.createContext(context);
    const source = fs.readFileSync(path.resolve(__dirname, '../scripts/ScenarioVideoExport.js'), 'utf8');
    vm.runInContext(source, context);
    const canvas = {
        captureStream(rate) {
            captureRates.push(rate);
            return canvasStream;
        },
    };
    const session = context.ScenarioVideoExport.create({
        jobId: 'test', eventType: 'produce_events', eventId: '1', canvas,
    });
    await session.start();
    let ticks = 0;
    await session.startFrameDriver(() => { ticks++; });
    const preroll = session.waitForPreroll(20);
    workerInstance.emit(performance.now() + 17);
    workerInstance.emit(performance.now() + 34);
    await preroll;
    const prerollMs = session.markScenarioStart();

    assert.deepStrictEqual(captureRates, [0], 'manual CanvasCaptureMediaStream mode should be requested');
    assert.ok(ticks >= 2, 'frame callback should run for the initial and worker-driven frames');
    assert.ok(requestedFrames >= 2, 'each independent tick should explicitly submit a canvas frame');
    assert.match(workerSourceText, /awaitingAck/,
        'the background clock must not queue frames faster than the renderer can consume them');
    assert.ok(workerAcks >= 2, 'the renderer should acknowledge every consumed worker frame');
    assert.ok(prerollMs >= 0, 'the server trim point should be measured when scenario playback begins');
    assert.equal(compressorDisconnections.includes(monitorDestination), true,
        'speaker monitoring should be muted without muting the capture mix');
    session._cleanupCapture();
    assert.equal(workerInstance.terminated, true, 'background clock should terminate with the capture session');
    assert.equal(compressorConnections.includes(monitorDestination), true,
        'speaker monitoring should be restored when capture cleanup finishes');
});
