'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

function harness({ timestampOffset = 0, throwOnEncode = false } = {}) {
    const frames = [];
    class VideoFrame {
        constructor(_, options) { Object.assign(this, options); frames.push(this); }
        close() { this.closed = true; }
    }
    class VideoEncoder {
        static async isConfigSupported(config) { return { supported: true, config }; }
        constructor(callbacks) { this.callbacks = callbacks; }
        configure(config) { this.config = config; }
        encode(frame) {
            if (throwOnEncode) throw new Error('test encoder failed');
            queueMicrotask(() => this.callbacks.output({
                timestamp: frame.timestamp + timestampOffset, byteLength: 3, type: 'key',
                copyTo(bytes) { bytes.set([1, 2, 3]); },
            }, {}));
        }
        async flush() {}
        close() { this.closed = true; }
    }
    const context = { window: {}, PIXI: { utils: { EventEmitter } }, VideoFrame, VideoEncoder,
        exportNative: { timeout: setTimeout, clearTimeout },
        btoa: binary => Buffer.from(binary, 'binary').toString('base64') };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../experiments/offline-export/page.js'), 'utf8'), context);
    const proof = context.window.proof;
    proof.app = { view: {} };
    return { proof, frames };
}

test('offline encoder uses exact 60 fps timestamps and releases each VideoFrame', async () => {
    const { proof, frames } = harness();
    await proof.prepareEncoder();
    const first = await proof.encodeFrame(0);
    const second = await proof.encodeFrame(1);
    assert.equal(first.timestamp, 0);
    assert.equal(second.timestamp, 16667);
    assert.equal(second.data, 'AQID');
    assert.ok(frames.every(frame => frame.closed));
    assert.equal(await proof.finishEncoder(), 2);
});

test('offline encoder refuses unacknowledged, reordered or dropped frame timestamps', async () => {
    const { proof } = harness({ timestampOffset: 1 });
    await proof.prepareEncoder();
    await assert.rejects(proof.encodeFrame(0), /Unexpected, dropped or reordered/);
});

test('offline encoder closes VideoFrame even when encoding throws', async () => {
    const { proof, frames } = harness({ throwOnEncode: true });
    await proof.prepareEncoder();
    await assert.rejects(proof.encodeFrame(0), /test encoder failed/);
    assert.equal(frames[0].closed, true);
});

test('production HTML does not load the experimental renderer or clock', () => {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'), /experiments\/offline-export/);
});
