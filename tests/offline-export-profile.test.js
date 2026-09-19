'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { profile, audioMemoryBytes } = require('../experiments/offline-export/profile.cjs');
const { addMedia } = require('../experiments/offline-export/audio-merge.cjs');
test('ordinary export and branch preview skip PNG/hash/stall diagnostics', () => {
    for (const mode of ['offline', 'branch-preview']) {
        const p = profile(mode, {});
        assert.equal(p.diagnostics, false); assert.equal(p.stallFrame, -1);
        for (let f = 0; f < 600; f++) assert.equal(p.sampleFrame(f), false);
    }
});
test('verification retains sample evidence and cannot disable it accidentally', () => {
    const p = profile('all', { SSV_PROOF_DIAGNOSTICS: '0' });
    assert.equal(p.sampleFrame(540), true); assert.equal(p.sampleFrame(541), false); assert.equal(p.stallFrame, 120);
    assert(profile('offline', { SSV_PROOF_DIAGNOSTICS: '1' }).diagnostics);
    assert.throws(() => profile('offline', { SSV_PROOF_DIAGNOSTICS: 'yes' }));
});
test('audio budget holds two continuous buffers, not full visual state or media buffer', () => {
    assert.equal(audioMemoryBytes(48000), 48000 * 8 * 2 + 128 * 1024 * 1024);
    for (const value of [0, -1, Infinity, 4.5]) assert.throws(() => audioMemoryBytes(value));
});
test('media is added outside compressor at Float32 precision without clipping', () => {
    const a = Buffer.alloc(16), b = Buffer.alloc(16);
    [.75, -.75, .123, -.4].forEach((v, i) => a.writeFloatLE(v, i * 4));
    [.75, -.75, -.05, .02].forEach((v, i) => b.writeFloatLE(v, i * 4));
    const expected = Array.from({ length: 4 }, (_, i) => Math.fround(a.readFloatLE(i * 4) + b.readFloatLE(i * 4)));
    addMedia(a, b);
    expected.forEach((v, i) => assert.equal(a.readFloatLE(i * 4), v));
    assert.equal(a.readFloatLE(0), 1.5);
    assert.throws(() => addMedia(a, Buffer.alloc(8)), /Invalid/);
});
test('gain plateau compression preserves all interpolated sample gains', () => {
    const context = { window: {}, PIXI: { utils: { EventEmitter } } };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../experiments/offline-export/page.js'), 'utf8'), context);
    const original = [], compact = [];
    for (let f = 0; f < 600; f++) {
        const t = f / 60, value = f < 180 ? .5 : f < 240 ? .5 + (f - 180) / 120 : 1;
        original.push([t, value]); context.window.proof.recordGain(compact, t, value);
        // Setter and update can both write the same time/value.
        original.push([t, value]); context.window.proof.recordGain(compact, t, value);
    }
    const sample = (g, t) => {
        let i = 0; while (i + 1 < g.length && g[i + 1][0] <= t) i++;
        const a = g[i], b = g[i + 1];
        return !b || b[0] === a[0] ? a[1] : a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]);
    };
    for (let s = 0; s < 480000; s += 7) assert.equal(sample(compact, s / 48000), sample(original, s / 48000));
    assert(compact.length < original.length / 5);
});
