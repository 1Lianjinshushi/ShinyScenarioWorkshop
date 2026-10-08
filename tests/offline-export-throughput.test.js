'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { DecodedCache } = require('../experiments/offline-export/decoded-cache.cjs');
const runtime = path.resolve(__dirname, '../experiments/offline-export');
const key = 'a'.repeat(64), namespace = 'a'.repeat(16);
function cacheFixture(t, budget) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ssv-cache-'));
    t.after(() => { assert(path.dirname(root) === os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });
    const pcm = path.join(root, 'source.f32'), marker = path.join(root, 'source.json');
    fs.writeFileSync(pcm, Buffer.alloc(2048, 4)); fs.writeFileSync(marker, '{}');
    const sources = { 'audio.f32': pcm, 'audio.json': marker };
    const targets = { 'audio.f32': path.join(root, 'out.f32'), 'audio.json': path.join(root, 'out.json') };
    const cache = new DecodedCache(path.join(root, 'cache'), namespace, async () => {}, budget);
    return { root, sources, targets, cache };
}
test('two cache clients serialize publication and tolerate a peer evicting a verified entry', async t => {
    const { cache, sources, targets } = cacheFixture(t, 4500);
    const peer = new DecodedCache(cache.root, namespace, async () => {}, 4500);
    assert.deepEqual(await Promise.all([cache.publish('pcm', key, sources), peer.publish('pcm', key, sources)]), [true, true]);
    assert(await cache.restore('pcm', key, targets));
    assert(await peer.publish('pcm', 'b'.repeat(64), sources));
    assert(!fs.existsSync(cache.entry('pcm', key)));
    assert(await cache.publish('pcm', key, sources), 'stale verified set cannot hide peer eviction');
    assert(await peer.restore('pcm', key, targets));
    assert.deepEqual(fs.readFileSync(targets['audio.f32']), fs.readFileSync(sources['audio.f32']));
    assert(!fs.existsSync(path.join(cache.root, '.cache.lock')));
});

test('decoded cache verifies PCM, namespaces decoder changes, repairs corruption', async t => {
    const { cache, sources, targets } = cacheFixture(t);
    assert.equal(await cache.restore('pcm', key, targets), false);
    assert.equal(await cache.publish('pcm', key, sources), true);
    assert.equal(await cache.restore('pcm', key, targets), true);
    assert.deepEqual(fs.readFileSync(targets['audio.f32']), fs.readFileSync(sources['audio.f32']));
    const other = new DecodedCache(cache.root, 'b'.repeat(16));
    assert.equal(await other.restore('pcm', key, targets), false);
    fs.writeFileSync(path.join(cache.entry('pcm', key), 'audio.f32'), 'bad');
    fs.writeFileSync(targets['audio.f32'], 'keep');
    assert.equal(await cache.restore('pcm', key, targets), false);
    assert.equal(fs.readFileSync(targets['audio.f32'], 'utf8'), 'keep');
    assert.equal(await cache.publish('pcm', key, sources), true);
    assert.equal(await cache.restore('pcm', key, targets), true);
});
test('cache disk budget evicts only known complete derivatives, never source/job files', async t => {
    const { cache, sources, targets } = cacheFixture(t, 4500);
    await cache.publish('pcm', key, sources);
    await cache.restore('pcm', key, targets);
    await cache.publish('pcm', 'b'.repeat(64), sources);
    assert.equal(cache.stats.evicted, 1);
    assert(!fs.existsSync(cache.entry('pcm', key)));
    assert(fs.existsSync(sources['audio.f32'])); assert(fs.existsSync(targets['audio.f32']));
    assert(await cache.publish('pcm', key, sources));
    assert(fs.existsSync(cache.entry('pcm', key)));
});
test('cache rejects unknown files, traversal, symlinks and incomplete movies', async t => {
    const { cache, sources, targets, root } = cacheFixture(t);
    assert.throws(() => cache.entry('pcm', '../escape'));
    assert.equal(await cache.publish('movie', key, { '000001.png': sources['audio.f32'], 'complete.json': sources['audio.json'] }), false);
    await cache.publish('pcm', key, sources);
    fs.writeFileSync(path.join(cache.entry('pcm', key), 'do-not-touch'), 'keep');
    assert.equal(await cache.restore('pcm', key, targets), false);
    assert.equal(await cache.publish('pcm', key, sources), false);
    assert(fs.existsSync(path.join(cache.entry('pcm', key), 'do-not-touch')));
    const link = path.join(root, 'link'); fs.symlinkSync(cache.root, link, 'junction');
    const linked = new DecodedCache(link, namespace);
    assert.equal(await linked.restore('pcm', key, targets), false);
});
test('cache cancel never becomes a decode fallback; publication partial is cleaned', async t => {
    const { cache, sources, targets } = cacheFixture(t);
    await cache.publish('pcm', key, sources);
    cache.checkpoint = async () => { throw new Error('cancelled'); };
    await assert.rejects(cache.restore('pcm', key, targets), /cancelled/);
    let checks = 0; cache.checkpoint = async () => { if (++checks === 3) throw new Error('cancelled'); };
    await assert.rejects(cache.publish('pcm', 'b'.repeat(64), sources), /cancelled/);
    assert(!fs.readdirSync(cache.root).some(f => f.includes('.partial')));
});
test('cache checks lstat for dangling target links even when existsSync is false', async t => {
    const { cache, sources, targets } = cacheFixture(t);
    await cache.publish('pcm', key, sources);
    // Windows file symlinks need an optional privilege. Model the dangling
    // lstat result here; real junction rejection is covered separately above.
    const lstat = fs.lstatSync;
    t.mock.method(fs, 'lstatSync', (file, ...args) => path.resolve(file) === targets['audio.f32']
        ? { isSymbolicLink: () => true } : lstat(file, ...args));
    assert.equal(await cache.restore('pcm', key, targets), false);
    assert(!fs.existsSync(targets['audio.f32']));
    t.mock.restoreAll();
});
test('movie cache restores every frame and completion marker', async t => {
    const { cache, root, sources } = cacheFixture(t);
    const files = { '000000.png': sources['audio.f32'], '000001.png': sources['audio.f32'], 'complete.json': sources['audio.json'] };
    await cache.publish('movie', key, files);
    const target = path.join(root, 'movie');
    assert(await cache.restore('movie', key, target));
    assert.deepEqual(fs.readdirSync(target).sort(), Object.keys(files).sort());
});
function browserFixture({ pipeline = true, throwing = false } = {}) {
    let callbacks, elapsed = 0, closed = 0;
    class Encoder {
        constructor(c) { callbacks = c; this.state = 'configured'; }
        configure() {} encode() { if (throwing) throw new Error('sync encode failure'); }
        async flush() {} close() { this.state = 'closed'; }
    }
    class Frame { close() { closed++; } }
    const proof = { options: { framePipeline: pipeline }, app: { view: {} }, checkEncoder: async () => ({}),
        prepareEncoder: async () => 'legacy', encodeFrame: async frame => ({ timestamp: frame }), finishEncoder: async () => 7,
        step: async frame => { elapsed += 30; return { captureStartFrame: 0, done: frame === 99 }; } };
    const context = vm.createContext({ proof, VideoEncoder: Encoder, VideoFrame: Frame,
        exportNative: { now: () => elapsed, timeout: fn => setTimeout(fn, 40), clearTimeout }, btoa: x => Buffer.from(x).toString('base64') });
    vm.runInContext(fs.readFileSync(path.join(runtime, 'frame-pipeline.js'), 'utf8'), context);
    return { proof, getClosed: () => closed, emit: timestamp => callbacks.output({ timestamp, type: 'key', byteLength: 1, copyTo: a => a.fill(7) }, {}) };
}
test('pipeline bounds to two, validates ordered ACKs, closes frames and flushes', async () => {
    const f = browserFixture(); await f.proof.prepareEncoder();
    const a = f.proof.encodeFrame(0), b = f.proof.encodeFrame(1);
    assert.throws(() => f.proof.encodeFrame(2), /bounded queue/);
    f.emit(0); f.emit(16667);
    assert.equal((await a).timestamp, 0); assert.equal((await b).timestamp, 16667);
    assert.equal(f.getClosed(), 2); assert.equal(await f.proof.finishEncoder(), 2);
});
test('pipeline rejects dropped/reordered frames and all timed-out pending frames', async () => {
    for (const reorder of [true, false]) {
        const f = browserFixture(); await f.proof.prepareEncoder();
        const result = Promise.allSettled([f.proof.encodeFrame(0), f.proof.encodeFrame(1)]);
        if (reorder) f.emit(16667);
        assert((await result).every(r => r.status === 'rejected'));
        assert.equal(f.proof.pipelinePending.size, 0);
        await assert.rejects(f.proof.finishEncoder());
    }
});
test('pipeline synchronous encode failure rejects cleanly without leaving pending promises', async () => {
    const f = browserFixture({ throwing: true }); await f.proof.prepareEncoder();
    await assert.rejects(f.proof.encodeFrame(0), /sync encode/);
    assert.equal(f.proof.pipelinePending.size, 0); assert.equal(f.getClosed(), 1);
});
test('bounded batch visits every frame, yields by wall budget, drains and stops at End', async () => {
    const f = browserFixture(); let pending = 0, peak = 0;
    f.proof.encodeFrame = frame => { pending++; peak = Math.max(peak, pending); return new Promise(resolve => setImmediate(() => { pending--; resolve({ timestamp: frame }); })); };
    const results = await f.proof.renderBatch({ frame: 0, count: 0, end: 8, captures: [] });
    assert.deepEqual(Array.from(results, r => r.frame), [0, 1, 2, 3]); assert.equal(peak, 2); assert.equal(pending, 0);
    const end = await f.proof.renderBatch({ frame: 98, count: 0, end: 104, captures: [] });
    assert.equal(end.length, 2); assert(!end[1].packet);
    await assert.rejects(f.proof.renderBatch({ frame: 0, end: 9 }), /Invalid/);
});
test('low-load retains the original one-frame encoder implementation', async () => {
    const f = browserFixture({ pipeline: false });
    assert.equal(await f.proof.prepareEncoder(), 'legacy');
    assert.deepEqual(await f.proof.encodeFrame(4), { timestamp: 4 });
    assert.equal(await f.proof.finishEncoder(), 7);
});
