'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { limits, decide, frameRest, acquireLock, Governor } = require('../experiments/offline-export/governor.cjs');
const policy = limits({}, 16 * 1024 ** 3);
test('conservative defaults and invalid settings', () => {
    assert.equal(policy.fps, 18); assert.equal(policy.memoryMiB, 3072);
    for (const env of [{ SSV_PROOF_WALL_FPS: 100 }, { SSV_PROOF_MEMORY_MIB: 'NaN' }, { SSV_PROOF_RESERVE_MIB: -1 }])
        assert.throws(() => limits(env));
});
test('system CPU changes generation speed, never output frame timing or quality', () => {
    const sample = { privateMiB: 1000, freeMiB: 9000, cpuPercent: 10 };
    assert.equal(decide(sample, policy).fps, 18);
    assert.equal(decide({ ...sample, cpuPercent: 70 }, policy).fps, 12);
    assert.equal(decide({ ...sample, cpuPercent: 90 }, policy).fps, 6);
    assert.equal(decide({ ...sample, privateMiB: 2800 }, policy).fps, 6);
    assert.equal(decide({ ...sample, freeMiB: policy.reserveMiB + 400 }, policy).fps, 15);
    assert.equal(decide({ ...sample, freeMiB: policy.reserveMiB + 100 }, policy).fps, 12);
    assert(frameRest(100, decide(sample, policy)) > 50);
    assert(frameRest(100, decide({ ...sample, cpuPercent: 90 }, policy)) >= 300);
});
test('external and own-process memory pressure pause; disk shortage still aborts', () => {
    assert.equal(decide({ privateMiB: 1000, freeMiB: 300, cpuPercent: 5 }, policy).action, 'pause');
    assert.equal(decide({ privateMiB: 3500, freeMiB: 9000, cpuPercent: 5 }, policy).action, 'pause');
    assert.equal(decide({ privateMiB: 3500, freeMiB: 300, cpuPercent: 5 }, policy).action, 'pause');
    assert.equal(decide({ privateMiB: 500, freeMiB: 9000, cpuPercent: 5, diskFreeMiB: 100 }, policy).reason, 'disk-space');
});
test('raising the job memory budget does not disable system-memory, CPU or disk safeguards', () => {
    const raised = { ...policy, memoryMiB: 8192 };
    const lowHeadroom = { privateMiB: 1000, freeMiB: policy.reserveMiB + 100, cpuPercent: 5 };
    assert.equal(decide(lowHeadroom, policy).fps, decide(lowHeadroom, raised).fps);
    assert.deepEqual(decide({ privateMiB: 3500, freeMiB: raised.reserveMiB - 1, cpuPercent: 5 }, raised),
        { action: 'pause', reason: 'system-memory-pressure' });
    assert.equal(decide({ privateMiB: 3500, freeMiB: 9000, cpuPercent: 90 }, raised).reason, 'busy');
    assert.equal(decide({ privateMiB: 3500, freeMiB: 9000, cpuPercent: 5, diskFreeMiB: 100 }, raised).reason, 'disk-space');
    assert.equal(decide({ privateMiB: 8192, freeMiB: 9000, cpuPercent: 5 }, raised).reason, 'export-memory-budget');
});
test('live memory changes force the next safety sample and preserve other guards', () => {
    const g = new Governor({ ...policy }); g.lastSample = Date.now();
    assert.deepEqual(g.updateMemoryPolicy({ memoryMiB: 4096, reserveMiB: 2048 }),
        { memoryMiB: 4096, reserveMiB: 2048 });
    assert.equal(g.lastSample, 0);
    assert.equal(g.policy.memoryMiB, 4096); assert.equal(g.policy.reserveMiB, 2048);
    assert.equal(g.policy.fps, policy.fps);
    assert.equal(g.events.at(-1).kind, 'policy-update');
    assert.throws(() => g.updateMemoryPolicy({ memoryMiB: '8192', reserveMiB: 2048 }));
    assert.equal(g.policy.memoryMiB, 4096);
});
test('exclusive job lock cannot overwrite another active job and is owner-released', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssv-lock-'));
    const file = path.join(dir, 'lock');
    try {
        const release = acquireLock(file), original = fs.readFileSync(file, 'utf8');
        assert.throws(() => acquireLock(file), /已有直出/);
        assert.equal(fs.readFileSync(file, 'utf8'), original);
        release(); assert.equal(fs.existsSync(file), false);
        fs.writeFileSync(file, '{}');
        assert.throws(() => acquireLock(file), /Invalid export lock/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('governor holds a memory pause until explicit resume and rechecks safety', async () => {
    const g = new Governor({ ...policy, sampleMs: 1, pauseTimeoutMs: 0 }); let reads = 0;
    g.sample = async () => {
        g.current = ++reads < 3 ? { action: 'pause' } : { action: 'run', fps: 18, duty: 0.65 };
        g.lastSample = Date.now();
    };
    const result = [];
    g.onMemoryResumeResult = r => result.push(r);
    const waiting = g.checkpoint('test', true);
    await new Promise(resolve => setImmediate(resolve));
    assert(g.memoryPause);
    assert.equal(reads, 1);
    assert(g.requestMemoryResume('first'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(result[0].resumed, false);
    assert(g.memoryPause);
    assert(g.requestMemoryResume('second'));
    await waiting;
    assert.equal(reads, 3);
    assert.deepEqual(g.events.map(e => e.kind), ['memory-pause', 'memory-resume-rejected', 'memory-resume']);
});
test('persistent pressure stays paused, cancellation wakes, and allocations wait for manual budget recheck', async () => {
    const g = new Governor({ ...policy, sampleMs: 1, pauseTimeoutMs: 0 });
    g.sample = async () => { g.current = { action: 'pause' }; };
    const waiting = g.checkpoint('test', true);
    await new Promise(resolve => setImmediate(resolve));
    assert(g.memoryPause);
    g.cancel();
    await assert.rejects(waiting, /cancelled/);
    assert.equal(g.memoryPause, null);

    const a = new Governor({ ...policy, sampleMs: 1 });
    let privateMiB = 2500;
    a.sample = async () => {
        a.current = { action: 'run' };
        const sample = { privateMiB, freeMiB: 9000 };
        a.samples.push(sample);
        return sample;
    };
    const allocation = a.allocation(1024 ** 3, 'mastering');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(a.memoryPause.requiredMiB, 1024);
    a.requestMemoryResume('too-soon');
    await new Promise(resolve => setImmediate(resolve));
    assert(a.memoryPause);
    privateMiB = 1000;
    a.requestMemoryResume('now-safe');
    await allocation;
    assert.equal(a.memoryPause, null);
});
