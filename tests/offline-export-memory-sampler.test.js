'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { ProcessMemorySampler } = require('../experiments/offline-export/memory-sampler.cjs');

function fixture(t, timeoutMs = 100) {
    const requests = []; let launches = 0;
    const child = new EventEmitter(); child.pid = 2147483647;
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { child.killed = true; if (child.exitCode == null) { child.exitCode = 1; child.emit('exit', 1); } };
    child.stdin = new Writable({ write(bytes, encoding, done) { requests.push(JSON.parse(bytes)); done(); },
        final(done) { child.exitCode = 0; child.emit('exit', 0); done(); } });
    const sampler = new ProcessMemorySampler({ timeoutMs, spawn(exe, args, options) {
        launches++; assert.equal(exe, 'powershell.exe'); assert.equal(options.windowsHide, true);
        assert(args.includes('-NoProfile')); return child;
    } });
    t.after(async () => { await sampler.close(); child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy(); });
    const reply = patch => child.stdout.write(JSON.stringify({ id: requests.at(-1).id, bytes: 104857600, count: 2, ...patch }) + '\n');
    return { sampler, child, requests, reply, launches: () => launches };
}
test('one helper is reused and its own memory is included; per-query bytes are fresh', async t => {
    const f = fixture(t);
    for (const bytes of [104857600, 120000000, 110000000]) {
        const result = f.sampler.sample([process.pid, process.pid]);
        f.reply({ bytes }); assert.equal(await result, bytes);
    }
    assert.equal(f.launches(), 1);
    assert.deepEqual(f.requests[0].pids, [process.pid, f.child.pid]);
    assert.equal(f.requests[0].rootPid, process.pid);
    await f.sampler.close(); assert.equal(f.child.exitCode, 0);
    await assert.rejects(f.sampler.sample([process.pid]), /closed/);
});
test('malformed and missing-root PID requests never spawn a helper', async t => {
    const f = fixture(t);
    for (const pids of [[], ['1'], [0], [process.pid, -1], [process.pid, 'powershell'], Array(1025).fill(process.pid)])
        await assert.rejects(f.sampler.sample(pids), /PIDs/);
    assert.equal(f.launches(), 0);
});
test('overlapping requests are rejected rather than returning a stale sample', async t => {
    const f = fixture(t), first = f.sampler.sample([process.pid]);
    await assert.rejects(f.sampler.sample([process.pid]), /already/);
    f.reply(); assert.equal(await first, 104857600);
});
test('corrupt, mismatched, missing-process and invalid accounting replies fail closed', async t => {
    for (const patch of [{ bytes: 0 }, { bytes: -1 }, { bytes: 1.5 }, { id: 999 }, { count: 0 }, { count: 500 }, { error: 'root unavailable' }]) {
        const f = fixture(t), result = f.sampler.sample([process.pid]);
        f.reply(patch); await assert.rejects(result); assert.equal(f.child.killed, true);
        await assert.rejects(f.sampler.sample([process.pid])); assert.equal(f.launches(), 1);
    }
    const f = fixture(t), result = f.sampler.sample([process.pid]);
    f.child.stdout.write('not json\n'); await assert.rejects(result, /Invalid/);
});
test('helper timeout or exit cannot silently disable the safety check', async t => {
    const f = fixture(t, 10);
    await assert.rejects(f.sampler.sample([process.pid]), /timed out/); assert(f.child.killed);
    const g = fixture(t), result = g.sampler.sample([process.pid]);
    g.child.kill(); await assert.rejects(result, /exited/);
});
test('closing a pending sampler rejects the wait and shuts down only its owned helper', async t => {
    const f = fixture(t), result = f.sampler.sample([process.pid]);
    const rejected = assert.rejects(result, /closed/);
    await f.sampler.close(); await rejected;
    assert.equal(f.child.exitCode, 0); assert.equal(f.child.killed, undefined);
});
