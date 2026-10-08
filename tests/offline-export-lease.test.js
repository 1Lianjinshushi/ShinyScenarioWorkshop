'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { acquireLock, acquireExportGroup, acquireWorker, withLease } = require('../experiments/offline-export/lease.cjs');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ssv-lease-'));
    fs.mkdirSync(path.join(root, 'exports'));
    t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, {recursive:true}); });
    return root;
}
test('group excludes standalone runs and refuses orphan worker slots after service exits', t => {
    const root=fixture(t), group=acquireExportGroup(root);
    assert.throws(()=>acquireWorker(root,{}), /已有直出/);
    group();
    const orphan=acquireLock(path.join(root,'exports/.offline-worker-2.lock'));
    assert.throws(()=>acquireExportGroup(root), /已有直出/);
    assert(!fs.existsSync(path.join(root,'exports/.offline-export.lock')));
    orphan();acquireExportGroup(root)();
});
test('managed worker rejects an untrusted queue lease instead of bypassing global exclusivity', t => {
    const root=fixture(t), group=acquireExportGroup(root);
    assert.throws(()=>acquireWorker(root,{SSV_PROOF_QUEUE_TOKEN:group.token,SSV_PROOF_SLOT:'1'}), /Invalid managed/);
    group();
});
test('lease waits without entering a busy operation, honours cancellation and releases on errors', async t => {
    const root=fixture(t), file=path.join(root,'exports/allocation.lock');
    let unblock; const hold=new Promise(r=>unblock=r), trace=[];
    const first=withLease(file,async()=>{},async()=>{trace.push('a');await hold;throw new Error('failed operation');});
    const failed=assert.rejects(first,/failed operation/);
    await new Promise(r=>setImmediate(r));
    let cancel=false;
    const second=withLease(file,async()=>{if(cancel)throw new Error('cancelled');},async()=>trace.push('b'));
    const cancelled=assert.rejects(second,/cancelled/);cancel=true;
    await cancelled; assert.deepEqual(trace,['a']);unblock();await failed;
    await withLease(file,async()=>{},async()=>trace.push('c'));
    assert.deepEqual(trace,['a','c']); assert(!fs.existsSync(file));
});
test('lease emits a waiting reason until acquisition and releases after work failure',async t=>{
    const root=fixture(t),file=path.join(root,'exports/wait.lock'),release=acquireLock(file),trace=[];
    const waiting=withLease(file,async()=>{},async()=>{trace.push('work');throw new Error('test failure');},
        {onWait(){trace.push('wait');release();},onAcquired(){trace.push('acquired');}});
    await assert.rejects(waiting,/test failure/);
    assert.deepEqual(trace,['wait','acquired','work']);assert(!fs.existsSync(file));
});
