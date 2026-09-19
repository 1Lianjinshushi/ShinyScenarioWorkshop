'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Governor, limits } = require('../experiments/offline-export/governor.cjs');
const { Preflight } = require('../experiments/offline-export/preflight.cjs');
const policy = limits({}, 16 * 1024 ** 3);
const tick = () => new Promise(resolve => setImmediate(resolve));

test('pause protocol emits one pause and explicit failed/successful resume ACKs', async () => {
    const governor = new Governor({ ...policy, sampleMs: 1, pauseTimeoutMs: 0 });
    let freeMiB = 100;
    const notices = [], replies = [];
    governor.onMemoryPause = message => notices.push(message);
    governor.onMemoryResumeResult = message => replies.push(message);
    governor.sample = async () => {
        const sample = { privateMiB: 1000, freeMiB };
        governor.current = { action: freeMiB < governor.policy.reserveMiB ? 'pause' : 'run', reason: 'system-memory-pressure' };
        governor.lastSample = Date.now();
        return sample;
    };
    const pending = governor.checkpoint('render', true);
    await tick();
    assert.deepEqual(notices.map(m => m.phase), ['render']);
    assert.equal(governor.requestMemoryResume('a'), true);
    await tick();
    assert.equal(replies[0].requestId, 'a');
    assert.equal(replies[0].resumed, false);
    assert.equal(notices.length, 1);
    freeMiB = 9000;
    assert.equal(governor.requestMemoryResume('b'), true);
    await pending;
    assert.equal(replies[1].resumed, true);
    assert.equal(governor.requestMemoryResume('late'), false);
});

test('disk shortage detected at resume remains a non-memory failure', async () => {
    const governor = new Governor({ ...policy, sampleMs: 1 });
    let diskShort = false;
    governor.sample = async () => {
        governor.current = diskShort ? { action: 'abort', reason: 'disk-space' }
            : { action: 'pause', reason: 'system-memory-pressure' };
        governor.lastSample = Date.now();
        return { privateMiB: 1000, freeMiB: 100 };
    };
    const pending = governor.checkpoint('preflight', true);
    await tick();
    diskShort = true;
    governor.requestMemoryResume('disk');
    await assert.rejects(pending, /磁盘剩余空间不足/);
    assert.equal(governor.memoryPause, null);
});

test('cancellation interrupts a manual allocation pause without a renderer step', async () => {
    const governor = new Governor({ ...policy, sampleMs: 1 });
    governor.sample = async () => {
        governor.current = { action: 'run' };
        const sample = { privateMiB: 3000, freeMiB: 9000 };
        governor.samples.push(sample);
        return sample;
    };
    const pending = governor.allocation(256 * 1024 * 1024, 'renderer-preparation');
    await tick();
    assert.equal(governor.memoryPause.requiredMiB, 256);
    governor.cancel();
    await assert.rejects(pending, /cancelled/);
});

test('preflight checkpoint keeps memory pressure out of resource failure aggregation', async () => {
    const governor = new Governor({ ...policy, sampleMs: 1 });
    let safe = false;
    governor.sample = async () => {
        governor.current = safe ? { action: 'run' } : { action: 'pause', reason: 'system-memory-pressure' };
        governor.lastSample = Date.now();
        return { privateMiB: 1000, freeMiB: safe ? 9000 : 100 };
    };
    const preflight = new Preflight({ resolve: () => '', acquire: async () => {},
        checkpoint: () => governor.checkpoint('preflight', true) });
    let actionCalled = false;
    const pending = preflight.stage('test-fixture', 'fixture', () => { actionCalled = true; });
    await tick();
    assert.equal(actionCalled, false);
    assert.deepEqual(preflight.failures, []);
    safe = true;
    governor.requestMemoryResume('after-cleanup');
    await pending;
    assert.equal(actionCalled, true);
    assert.deepEqual(preflight.failures, []);
});
