'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function acquireLock(file, metadata = {}) {
    const token = crypto.randomBytes(16).toString('hex');
    try { fs.writeFileSync(file, JSON.stringify({ ...metadata, pid: process.pid, token }), { flag: 'wx' }); }
    catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let old, original;
        try { original = fs.readFileSync(file, 'utf8'); old = JSON.parse(original); }
        catch (readError) { if (readError.code === 'ENOENT') return acquireLock(file, metadata); }
        if (!Number.isSafeInteger(old?.pid) || old.pid <= 0) throw new Error(`Invalid export lock: ${file}`);
        try { process.kill(old.pid, 0); }
        catch (probe) {
            if (probe.code === 'ESRCH') {
                // Serialize stale reclamation too. Without this second mutex,
                // two waiters can check the old token then unlink a new lease.
                const reclaim = file + '.reclaim';
                try { fs.writeFileSync(reclaim, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' }); }
                catch (claimError) {
                    if (claimError.code !== 'EEXIST') throw claimError;
                    const pending = JSON.parse(fs.readFileSync(reclaim, 'utf8'));
                    try { process.kill(pending.pid, 0); }
                    catch (_) { throw new Error(`Interrupted lock reclamation requires review: ${reclaim}`); }
                    const busy = new Error('正在回收已退出任务的锁'); busy.code = 'EXPORT_LOCK_BUSY'; throw busy;
                }
                try {
                    try { if (fs.readFileSync(file, 'utf8') === original) fs.unlinkSync(file); }
                    catch (readError) { if (readError.code !== 'ENOENT') throw readError; }
                } finally { fs.unlinkSync(reclaim); }
                return acquireLock(file, metadata);
            }
        }
        const busy = new Error('已有直出任务运行中，请等待完成或取消后再启动。');
        busy.code = 'EXPORT_LOCK_BUSY'; throw busy;
    }
    const release = () => {
        try { if (JSON.parse(fs.readFileSync(file, 'utf8')).token === token) fs.unlinkSync(file); } catch (_) {}
    };
    release.token = token;
    return release;
}

function acquireExportGroup(root, kind = 'queue') {
    const dir = path.join(root, 'exports');
    const release = acquireLock(path.join(dir, '.offline-export.lock'), { kind });
    try {
        // A previous service can die before its children finish shutting down.
        // Do not overlap a new batch with those orphaned workers.
        for (const slot of [1, 2]) acquireLock(path.join(dir, `.offline-worker-${slot}.lock`))();
        return release;
    } catch (error) { release(); throw error; }
}

function acquireWorker(root, env = process.env) {
    if (!env.SSV_PROOF_QUEUE_TOKEN) return acquireExportGroup(root, 'standalone');
    const slot = Number(env.SSV_PROOF_SLOT);
    const group = JSON.parse(fs.readFileSync(path.join(root, 'exports/.offline-export.lock'), 'utf8'));
    if (![1, 2].includes(slot) || !process.connected || group.kind !== 'queue'
        || group.pid !== process.ppid || group.token !== env.SSV_PROOF_QUEUE_TOKEN)
        throw new Error('Invalid managed export lease');
    return acquireLock(path.join(root, `exports/.offline-worker-${slot}.lock`));
}

async function withLease(file, checkpoint, work, { onWait = () => {}, onAcquired = () => {} } = {}) {
    let release;
    while (!release) {
        await checkpoint();
        try { release = acquireLock(file); }
        catch (error) {
            if (error.code !== 'EXPORT_LOCK_BUSY') throw error;
            onWait();
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    try { onAcquired(); return await work(); } finally { release(); }
}
module.exports = { acquireLock, acquireExportGroup, acquireWorker, withLease };
