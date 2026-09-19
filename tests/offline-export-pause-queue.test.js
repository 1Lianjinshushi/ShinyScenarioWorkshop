'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { ExportQueue } = require('../experiments/offline-export/queue.cjs');

function fixture(t, overrides = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ssv-pause-queue-'));
    const children = [];
    const options = {
        runtime: () => ({ available: true, missing: [], env: {} }),
        fork: () => {
            const child = new EventEmitter();
            child.stdout = new PassThrough(); child.stderr = new PassThrough();
            child.connected = true; child.sent = [];
            child.send = (message, callback) => { child.sent.push(message); callback?.(); };
            children.push(child); return child;
        },
        kill: () => {},
        ...overrides,
    };
    const queue = new ExportQueue(root, options);
    t.after(async () => {
        for (const child of children) { child.stdout.destroy(); child.stderr.destroy(); }
        await new Promise(resolve => setTimeout(resolve, 40));
        fs.rmSync(root, { recursive: true, force: true });
    });
    return { root, queue, children, options };
}
const item = eventId => ({ eventId, eventType: 'special_communications', language: 'zh-cn',
    content: JSON.stringify([{ id: '1', text: '测试' }]) });
function pause(child, phase = 'audio-decode') {
    child.emit('message', { type: 'memory-pause', phase, reason: 'reserve',
        requiredMiB: 64, message: '系统空闲内存不足，已暂停当前任务' });
}

test('memory pause preserves the same worker and blocks the next queued job', async t => {
    const { queue, children } = fixture(t);
    const { ids } = queue.submit([item('4902005026'), item('4902005027')]);
    queue.start(ids);
    const current = children[0]; pause(current);
    assert.equal(queue.get(ids[0]).state, 'paused');
    assert.equal(queue.get(ids[0]).stage, 'paused');
    assert.equal(queue.get(ids[0]).pause.code, 'MEMORY_BUDGET_PAUSE');
    assert.equal(queue.get(ids[0]).pause.details.requiredMiB, 64);
    assert.equal(queue.get(ids[1]).state, 'queued');
    assert.equal(children.length, 1);
    current.emit('message', { type: 'progress', stage: 'audio', encodedFrames: 42 });
    assert.equal(queue.get(ids[0]).stage, 'paused');
    assert.equal(queue.get(ids[0]).progress.encodedFrames, 42);
    assert.deepEqual(queue.list().jobs.find(j => j.id === ids[0]).pause.reason,
        '系统空闲内存不足，已暂停当前任务');

    const retry = queue.resume(ids[0]);
    const requestId = current.sent.at(-1).requestId;
    assert.equal(current.sent.at(-1).type, 'memory-resume');
    current.emit('message', { type: 'memory-resume-result', requestId, resumed: false,
        message: '内存仍不足' });
    const result = await retry;
    assert.equal(result.resumed, false);
    assert.equal(queue.get(ids[0]).state, 'paused');
    assert.equal(queue.get(ids[0]).pause.reason, '内存仍不足');
    assert.equal(children.length, 1);

    const nextRetry = queue.resume(ids[0]);
    current.emit('message', { type: 'memory-resume-result',
        requestId: current.sent.at(-1).requestId, resumed: true });
    assert.equal((await nextRetry).resumed, true);
    assert.equal(queue.get(ids[0]).state, 'running');
    assert.equal(queue.get(ids[0]).pause, undefined);
    assert.equal(children.length, 1);
    current.emit('close', 1);
    assert.equal(children.length, 2);
    children[1].emit('close', 1);
});

test('pause accepts confirmed settings before resume but not concurrent changes', async t => {
    const { queue, children } = fixture(t);
    const { ids } = queue.submit([item('4902005026')]); queue.start(ids);
    const child = children[0]; pause(child);
    const old = queue.get(ids[0]).settings;
    const settings = { memoryMiB: 4096, reserveMiB: 2048 };
    const update = queue.updateSettings(ids, settings);
    assert.equal(queue.get(ids[0]).settings, old);
    assert.equal(child.sent.at(-1).type, 'memory-settings');
    await assert.rejects(queue.resume(ids[0]), /内存设置尚未确认/);
    child.emit('message', { type: 'memory-settings-ack', token: child.sent.at(-1).token, settings });
    await update;
    assert.deepEqual(queue.get(ids[0]).settings, settings);
    assert.equal(queue.get(ids[0]).state, 'paused');
    const resume = queue.resume(ids[0]);
    await assert.rejects(queue.updateSettings(ids, old), /正在复检内存/);
    child.emit('message', { type: 'memory-resume-result', requestId: child.sent.at(-1).requestId,
        resumed: false, message: '仍不足' });
    assert.equal((await resume).resumed, false);
    child.emit('close', 1);
});

test('cancelling paused work wakes the worker and advances only after it exits', t => {
    const { queue, children } = fixture(t);
    const { ids } = queue.submit([item('4902005026'), item('4902005027')]); queue.start(ids);
    pause(children[0], 'ffmpeg');
    queue.cancel(ids[0]);
    assert.equal(queue.get(ids[0]).state, 'cancelling');
    assert.deepEqual(children[0].sent.at(-1), { type: 'cancel' });
    assert.equal(children.length, 1);
    children[0].emit('close', 1);
    assert.equal(queue.get(ids[0]).state, 'cancelled');
    assert.equal(children.length, 2);
    children[1].emit('close', 1);
});

test('service recovery marks paused work interrupted and never auto-resumes it', async t => {
    const { root, queue, children, options } = fixture(t);
    const { ids } = queue.submit([item('4902005026'), item('4902005027')]); queue.start(ids);
    pause(children[0]);
    const restored = new ExportQueue(root, options);
    assert.equal(restored.get(ids[0]).state, 'interrupted');
    assert.equal(restored.get(ids[0]).pause, undefined);
    assert.equal(restored.get(ids[1]).state, 'pending');
    assert.equal(children.length, 1);
    assert.equal(restored.active, null);
    await assert.rejects(restored.resume(ids[0]), /只有因内存安全预算暂停/);
    queue.cancel(ids[1]); children[0].emit('close', 1);
});

test('worker exit or cancellation rejects an outstanding resume instead of reporting success', async t => {
    const { queue, children } = fixture(t);
    const { ids } = queue.submit([item('4902005026')]); queue.start(ids);
    pause(children[0]);
    const waiting = queue.resume(ids[0]);
    children[0].emit('close', 1);
    await assert.rejects(waiting, /已结束/);
    assert.equal(queue.get(ids[0]).state, 'failed');
    assert.equal(queue.active, null);
});

test('late worker ACK reconciles state after request timeout without lying to caller', async t => {
    const { queue, children } = fixture(t, { resumeAckTimeoutMs: 5 });
    const { ids } = queue.submit([item('4902005026'), item('4902005027')]); queue.start(ids);
    const child = children[0]; pause(child);
    const waiting = queue.resume(ids[0]);
    const requestId = child.sent.at(-1).requestId;
    await assert.rejects(waiting, /复检仍在进行/);
    assert.equal(queue.get(ids[0]).state, 'paused');
    await assert.rejects(queue.resume(ids[0]), /上一次内存复检尚未完成/);
    assert.equal(child.sent.filter(message => message.type === 'memory-resume').length, 1);
    child.emit('message', { type: 'memory-resume-result', requestId, resumed: true });
    assert.equal(queue.get(ids[0]).state, 'running');
    assert.equal(queue.get(ids[0]).pause, undefined);
    assert.equal(children.length, 1);
    child.emit('close', 1); children[1].emit('close', 1);
});
