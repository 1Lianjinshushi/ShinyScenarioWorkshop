'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { AUDIO_PCM_FORMAT, validAudioCache, validateDecodedAudio } = require('../experiments/offline-export/profile.cjs');
const source = fs.readFileSync(path.join(__dirname, '../experiments/offline-export/page.js'), 'utf8');

function harness(deviceRate, { httpStatus = 200, decodeError = false, returnedRate = 48000, mono = false } = {}) {
    const contexts = [], decoded = [];
    const channels = mono ? [new Float32Array([.25, -.5, .75])] : [new Float32Array([.25, -.5, .75]), new Float32Array([-.25, .5, -.75])];
    const buffer = { sampleRate: returnedRate, length: 3, duration: 3 / returnedRate,
        numberOfChannels: channels.length, getChannelData: i => channels[i] };
    class OfflineAudioContext {
        constructor(channels, length, rate) { contexts.push({ channels, length, rate }); this.sampleRate = rate; }
        async decodeAudioData(bytes) { decoded.push(bytes); if (decodeError) throw new Error('corrupt input'); return buffer; }
    }
    const context = { window: {}, OfflineAudioContext, PIXI: { utils: { EventEmitter }, sound: { context: {
        audioContext: { sampleRate: deviceRate }, decode() { throw new Error('Device-dependent PIXI decoder must not be used'); },
    } } }, fetch: async () => ({ ok: httpStatus === 200, status: httpStatus, arrayBuffer: async () => new ArrayBuffer(12) }),
        btoa: s => Buffer.from(s, 'binary').toString('base64') };
    vm.runInNewContext(source, context);
    return { proof: context.window.proof, contexts, decoded };
}

for (const deviceRate of [32000, 44100, 48000, 96000, 192000]) {
    test(`export decoder stays 48 kHz with a ${deviceRate} Hz playback context`, async () => {
        const { proof, contexts } = harness(deviceRate);
        assert.deepEqual(JSON.parse(JSON.stringify(proof.audioFormat)), AUDIO_PCM_FORMAT);
        assert.equal(proof.initAudioDecoder().playbackSampleRate, deviceRate);
        const metadata = await proof.decodeAudio('/audio');
        validateDecodedAudio(metadata);
        assert.equal(metadata.sampleRate, 48000);
        assert.equal(metadata.duration, 3 / 48000);
        await proof.decodeAudio('/another');
        assert.deepEqual(contexts, [{ channels: 1, length: 2, rate: 48000 }]);
    });
}

test('stereo order, mono duplication and final short PCM chunk stay intact', async () => {
    for (const mono of [false, true]) {
        const { proof } = harness(44100, { mono });
        await proof.decodeAudio('/audio');
        const bytes = Buffer.from(proof.audioChunk(1), 'base64');
        assert.equal(bytes.length, 2 * 2 * 4);
        assert.deepEqual([0, 4, 8, 12].map(offset => bytes.readFloatLE(offset)), mono ? [-.5, -.5, .75, .75] : [-.5, .5, .75, -.75]);
        for (const offset of [-1, 3, .5]) assert.throws(() => proof.audioChunk(offset), /Invalid PCM offset/);
    }
});

test('HTTP, corrupt audio and unexpected decoded formats still fail without stale PCM', async () => {
    for (const [settings, pattern] of [[{ httpStatus: 404 }, /HTTP 404/], [{ decodeError: true }, /corrupt input/], [{ returnedRate: 44100 }, /44100/]]) {
        const { proof } = harness(44100, settings);
        proof.decodedAudio = { stale: true };
        await assert.rejects(proof.decodeAudio('/bad'), pattern);
        assert.equal(proof.decodedAudio, null);
    }
});

test('worker rejects mislabeled duration/rate instead of interpreting 44.1 kHz samples as 48 kHz', () => {
    const good = { sampleRate: 48000, samples: 48000, duration: 1, channels: 1 };
    assert.doesNotThrow(() => validateDecodedAudio(good));
    for (const bad of [{ sampleRate: 44100 }, { samples: 44100 }, { duration: 0 }, { samples: -1 }, { channels: 0 }])
        assert.throws(() => validateDecodedAudio({ ...good, ...bad }), /Invalid 48 kHz/);
});

test('PCM reuse requires source hash, explicit rate/format version and exact byte count', () => {
    const good = { ...AUDIO_PCM_FORMAT, sourceHash: 'hash', samples: 48000 };
    assert.equal(validAudioCache(good, 'hash', 384000), true);
    for (const bad of [null, { sourceHash: 'hash', samples: 48000 }, { ...good, sampleRate: 44100 },
        { ...good, channels: 1 }, { ...good, decoder: 'old' }, { ...good, samples: -1 }])
        assert.equal(validAudioCache(bad, 'hash', 384000), false);
    assert.equal(validAudioCache(good, 'changed', 384000), false);
    assert.equal(validAudioCache(good, 'hash', 383992), false);
});
