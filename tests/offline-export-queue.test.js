'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream');
const { ExportQueue, validateRequest } = require('../experiments/offline-export/queue.cjs');
const { cleanup } = require('../experiments/offline-export/cleanup.cjs');
const { limits, prerollRest } = require('../experiments/offline-export/governor.cjs');
const item = (id = '4902005026') => ({ eventId: id, eventType: 'special_communications', language: 'ja', content: JSON.stringify([{ id: '1', text: 'テスト' }]) });
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ssv-job-test-')), children = [];
    const options = { runtime: () => ({ available: true, missing: [], env: {} }), fork: (file, args, settings) => {
        const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.connected = true; child.settings = settings; child.sent = []; child.send = m => child.sent.push(m); children.push(child); return child;
    } };
    const queue = new ExportQueue(root, options);
    t.after(async () => { for (const child of children) { child.stdout.destroy(); child.stderr.destroy(); }
        await new Promise(r => setTimeout(r, 30));
        const resolved = fs.realpathSync(root); assert(resolved.startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
        fs.rmSync(resolved, { recursive: true }); });
    return { root, queue, children, options };
}

test('verification choice is atomic, persisted per job and passed to each worker', t => {
    const { root, queue:q, children, options }=fixture(t);
    assert.deepEqual(q.list().verificationModes,['auto','quick','full']);assert.equal(q.list().defaultVerificationMode,'auto');
    const { ids }=q.submit([item(),item('4902005027'),item('4902005028')]);
    for(const mode of ['none','',null,{},1]) {
        assert.throws(()=>q.start(ids,undefined,'high-speed',2,mode),/检查模式/);
        assert(q.jobs.every(j=>j.state==='pending'));assert.equal(children.length,0);
    }
    q.start(ids.slice(0,2),undefined,'high-speed',2,'full');q.start(ids.slice(2));
    assert(children.every(c=>c.settings.env.SSV_PROOF_VERIFICATION==='full'));
    assert.equal(new ExportQueue(root,options).get(ids[0]).verificationMode,'full');
    children[0].emit('close',1);children[1].emit('close',1);
    assert.equal(children[2].settings.env.SSV_PROOF_VERIFICATION,'auto');children[2].emit('close',1);
});
test('speed choice is validated atomically, persisted and isolated per batch', async t => {
    const { root, queue: q, children, options } = fixture(t);
    assert.deepEqual(q.list().speedModes, ['low-load', 'high-speed']);
    assert.equal(q.list().defaultSpeedMode, 'low-load');
    const { ids } = q.submit([item(), item('4902005027'), item('4902005028')]);
    for (const bad of ['turbo', 60, null, {}, '']) {
        assert.throws(() => q.start(ids, undefined, bad), /速度模式/);
        assert(q.jobs.every(j => j.state === 'pending')); assert.equal(children.length, 0);
    }
    q.start(ids.slice(0, 2), undefined, 'high-speed');
    q.start(ids.slice(2));
    assert.equal(children.length, 1, 'high speed does not enable parallel jobs');
    assert.equal(children[0].settings.env.SSV_PROOF_SPEED_MODE, 'high-speed');
    assert.equal(children[0].settings.env.SSV_PROOF_WALL_FPS, '60');
    assert.equal(limits(children[0].settings.env).fps, null,
        'legacy queue cap must not throttle a new high-speed worker');
    await q.updateSettings([ids[1]], { memoryMiB: 4096, reserveMiB: 2048 });
    assert.equal(q.get(ids[1]).speedMode, 'high-speed', 'memory edit must not reset speed');
    const restored = new ExportQueue(root, options);
    assert.equal(restored.get(ids[1]).speedMode, 'high-speed');
    children[0].emit('close', 1);
    assert.equal(children[1].settings.env.SSV_PROOF_SPEED_MODE, 'high-speed');
    children[1].emit('close', 1);
    assert.equal(children[2].settings.env.SSV_PROOF_SPEED_MODE, 'low-load');
    assert.equal(children[2].settings.env.SSV_PROOF_WALL_FPS, '18');
    children[2].emit('close', 1);
});
test('dual queue caps at two, preserves FIFO and reserves distinct worker slots', t => {
    const { queue: q, children, root } = fixture(t);
    assert.deepEqual(q.list().concurrencyModes, [1, 2]);
    assert.equal(q.list().defaultConcurrency, 2);
    const { ids } = q.submit([item(), item('4902005027'), item('4902005028')]);
    for (const bad of [0, 3, '2', null, {}]) assert.throws(() => q.start(ids, undefined, 'high-speed', bad), /只能为/);
    assert(q.jobs.every(j => j.state === 'pending'));
    q.start(ids, undefined, 'high-speed', 2);
    assert.equal(children.length, 2); assert.equal(q.list().activeWorkers, 2);
    assert.equal(q.get(ids[2]).state, 'queued');
    assert.deepEqual(children.map(c => c.settings.env.SSV_PROOF_SLOT), ['1', '2']);
    assert.equal(children[0].settings.env.SSV_PROOF_QUEUE_TOKEN, children[1].settings.env.SSV_PROOF_QUEUE_TOKEN);
    children[1].emit('close', 1);
    assert.equal(children.length, 3); assert.equal(q.get(ids[2]).state, 'running');
    assert.equal(children[2].settings.env.SSV_PROOF_SLOT, '2');
    children[0].emit('close', 1); children[2].emit('close', 1);
    assert.equal(q.active, null); assert(!fs.existsSync(path.join(root, 'exports/.offline-export.lock')));
});

test('one selected story starts only one worker even in dual mode; serial batch is a FIFO barrier', t => {
    const { queue: q, children } = fixture(t);
    const { ids } = q.submit([item(), item('4902005027'), item('4902005028')]);
    q.start([ids[0]], undefined, 'high-speed', 2); assert.equal(children.length, 1);
    q.start([ids[1]]); q.start([ids[2]], undefined, 'high-speed', 2);
    assert.equal(children.length, 1);
    children[0].emit('close', 1); assert.equal(children.length, 2); assert.equal(q.active.job.id, ids[1]);
    children[1].emit('close', 1); assert.equal(children.length, 3);
    children[2].emit('close', 1);
});

test('dual pause keeps the slot and blocks new jobs, resume and cancellation target only the named worker', async t => {
    const { queue: q, children } = fixture(t);
    const { ids } = q.submit([item(), item('4902005027'), item('4902005028')]);
    q.start(ids, undefined, 'high-speed', 2);
    children[1].emit('message', { type: 'memory-pause', phase: 'render', message: 'test budget' });
    children[0].emit('close', 1);
    assert.equal(children.length, 2); assert.equal(q.get(ids[2]).state, 'queued');
    const resume = q.resume(ids[1]), request = children[1].sent.at(-1);
    assert.equal(request.type, 'memory-resume'); assert.equal(children[0].sent.length, 0);
    children[1].emit('message', { type: 'memory-resume-result', requestId: request.requestId, resumed: true });
    assert.equal((await resume).resumed, true); assert.equal(children.length, 3);
    q.cancel(ids[1]); assert.equal(children[1].sent.at(-1).type, 'cancel');
    assert.equal(children[2].sent.length, 0); assert.equal(q.get(ids[2]).state, 'running');
    children[1].emit('close', 1); children[2].emit('close', 1);
});

test('dual settings await both workers and retain only acknowledged changes on rejection', async t => {
    const { queue: q, children } = fixture(t);
    const { ids } = q.submit([item(), item('4902005027'), item('4902005028')]);
    q.start(ids, undefined, 'high-speed', 2);
    const updated = { memoryMiB: 4096, reserveMiB: 2048 };
    const request = q.updateSettings(ids, updated);
    const rejected = assert.rejects(request, /部分运行任务/);
    const [a, b] = children.map(c => c.sent.at(-1));
    children[0].emit('message', { type: 'memory-settings-ack', token: a.token, settings: a.settings });
    children[1].emit('message', { type: 'memory-settings-rejected', token: b.token, error: 'test' });
    await rejected;
    assert.deepEqual(q.get(ids[0]).settings, updated);
    assert.notDeepEqual(q.get(ids[1]).settings, updated); assert.notDeepEqual(q.get(ids[2]).settings, updated);
    const request2 = q.updateSettings(ids, updated);
    for (const child of children) { const m = child.sent.at(-1); child.emit('message', { type: 'memory-settings-ack', token: m.token, settings: m.settings }); }
    assert.equal((await request2).updatedIds.length, 3);
    children[0].emit('close', 1); children[1].emit('close', 1); children[2].emit('close', 1);
});

test('dual service restart marks both workers interrupted and restores queued jobs only as pending', t => {
    const { queue: q, children, root, options } = fixture(t);
    const { ids } = q.submit([item(), item('4902005027'), item('4902005028')]);
    q.start(ids, undefined, 'high-speed', 2);
    children[1].emit('message', { type: 'memory-pause', phase: 'ffmpeg' });
    const restored = new ExportQueue(root, options);
    assert.deepEqual(ids.map(id => restored.get(id).state), ['interrupted', 'interrupted', 'pending']);
    assert.equal(restored.workers.size, 0);
    q.cancel(ids[2]); children[0].emit('close', 1); children[1].emit('close', 1);
});

test('requests accept immutable JSON snapshots, reject malformed IDs/modes/branch counts', () => {
    assert.equal(validateRequest(item()).eventId, '4902005026');
    assert.equal(validateRequest({ ...item(), content: JSON.stringify([{ select: 'only', nextLabel: 'end' }]) }).eventId,
        '4902005026');
    for (const patch of [{ eventId: '../123456' }, { eventType: '../data' }, { mode: 'shell' }, { language: 'x' },
        { content: '{}' }, { content: '[null]' }, { content: '[]' }, { mode: 'branch-preview' },
        { content: JSON.stringify([{ select: 'a' }, { select: 'b' }]) }]) assert.throws(() => validateRequest({ ...item(), ...patch }));
    assert.notEqual(validateRequest(item()).fingerprint, validateRequest({ ...item(), language: 'zh-cn' }).fingerprint);
});
test('serial queue deduplicates active jobs and starts next only after child closes', t => {
    const { queue: q, children } = fixture(t), original = item();
    const result = q.submit([original, item('4902005027')]);
    assert.equal(children.length, 0); assert(q.jobs.every(j => j.state === 'pending'));
    q.start(result.ids);
    assert.equal(children.length, 1); assert.equal(q.jobs[1].state, 'queued');
    assert.equal(q.submit([original]).ids[0], result.ids[0]); assert.equal(q.jobs.length, 2);
    original.content = 'changed'; assert.match(fs.readFileSync(path.join(q.location(q.jobs[0]), '4902005026.json'), 'utf8'), /テスト/);
    children[0].emit('message', { type: 'progress', stage: 'render', encodedFrames: 300,
        storyCompleted: 4, storyTotal: 10 });
    assert.equal(q.jobs[0].progress.encodedFrames, 300);
    assert.equal(JSON.parse(fs.readFileSync(path.join(q.location(q.jobs[0]), 'job.json'))).progress.storyCompleted, 4);
    fs.writeFileSync(path.join(q.location(q.jobs[0]), '4902005026.offline.mp4'), 'fixture');
    children[0].emit('close', 0);
    assert.equal(q.jobs[0].state, 'complete'); assert.match(q.jobs[0].outputUrl, /offline-videos/); assert.equal(children.length, 2);
    assert.deepEqual(q.open(q.jobs[0].id), { directory: path.dirname(q.jobs[0].outputPath) });
    assert.equal(fs.readFileSync(q.jobs[0].outputPath, 'utf8'), 'fixture');
    assert(!fs.existsSync(path.join(q.location(q.jobs[0]), '4902005026.offline.mp4')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(q.location(q.jobs[0]), 'job.json'))).outputPath, q.jobs[0].outputPath);
    children[1].emit('close', 1); assert.equal(q.jobs[1].state, 'failed'); assert.equal(q.active, null);
});
test('queue passes language to the renderer without changing snapshot contents', t => {
    const { queue: q, children } = fixture(t); const input = { ...item(), language: 'zh-cn' };
    const added = q.submit([input]); q.start(added.ids); assert.equal(children[0].settings.env.SSV_PROOF_LANGUAGE, 'zh-cn');
    assert.equal(fs.readFileSync(path.join(q.location(q.jobs[0]), input.eventId + '.json'), 'utf8'), input.content);
    children[0].emit('close', 1);
});
test('export language selects shared production Chinese font; Japanese remains unchanged', () => {
    const { exportLanguage } = require('../experiments/offline-export/language.cjs');
    for (const lang of ['cn', 'zh', 'zh-cn', 'zh_cn']) assert.equal(exportLanguage(lang), 'cn');
    assert.equal(exportLanguage('', '123456.zh-cn.json'), 'cn');
    assert.equal(exportLanguage('ja', '123456.zh-cn.json'), 'ja');
    assert.equal(exportLanguage('', '123456.json'), 'ja'); assert.throws(() => exportLanguage('unknown'));
    const vm = require('node:vm'), fonts = { USED_FONT: [], USED_FONT_SPEAKER: [], SSV_CHINESE_FONT: '方正FW轻吟体 简 B', SSV_JAPANESE_FONT: 'FOT-Humming Pro B' };
    const text = fs.readFileSync(path.join(__dirname, '../scripts/ScenarioFetchFix.js'), 'utf8');
    const fn = text.slice(text.indexOf('applyScenarioLanguage ='), text.indexOf('loadScenarioFonts ='));
    vm.runInNewContext(fn, fonts); fonts.applyScenarioLanguage(exportLanguage('zh-cn'));
    assert.deepEqual(fonts.USED_FONT, [fonts.SSV_CHINESE_FONT]); assert.deepEqual(fonts.USED_FONT_SPEAKER, fonts.USED_FONT);
    fonts.applyScenarioLanguage(exportLanguage('ja')); assert.deepEqual(fonts.USED_FONT, [fonts.SSV_JAPANESE_FONT]);
    const page = fs.readFileSync(path.join(__dirname, '../experiments/offline-export/page.js'), 'utf8');
    assert.match(page, /applyScenarioLanguage\(proof.options.language \|\| 'ja'\)/);
    assert.doesNotMatch(page, /applyScenarioLanguage\('ja'\)/);
});
test('queued cancellation does not launch worker; active cancellation waits for close', t => {
    const { queue: q, children } = fixture(t); const added = q.submit([item(), item('4902005027')]); q.start(added.ids);
    q.cancel(q.jobs[1].id); assert.equal(q.jobs[1].state, 'cancelled'); assert.equal(children.length, 1);
    q.cancel(q.jobs[0].id); q.cancel(q.jobs[0].id);
    assert.equal(q.jobs[0].state, 'cancelling'); assert.deepEqual(children[0].sent, [{ type: 'cancel' }]);
    children[0].emit('message', { type: 'progress', stage: 'cleanup' }); assert.equal(q.jobs[0].stage, 'cancelling');
    children[0].emit('close', 1); assert.equal(q.jobs[0].state, 'cancelled'); assert.equal(q.active, null);
    assert.throws(() => q.open(q.jobs[0].id), /尚未完成/); assert.throws(() => q.get('../x'));
});
test('batch validation is atomic and stale jobs recover as interrupted, not auto-started', t => {
    const { root, queue: q, children, options } = fixture(t);
    assert.throws(() => q.submit([item(), { ...item(), content: '{' }])); assert.equal(q.jobs.length, 0);
    const added = q.submit([item()]); q.start(added.ids); const restored = new ExportQueue(root, options);
    assert.equal(restored.jobs[0].state, 'interrupted'); assert.equal(children.length, 1);
    children[0].emit('close', 1);
});

test('related-story batch fits alongside earlier pending work and the bounded queue counts only new snapshots', t => {
    const { queue: q, children } = fixture(t);
    const batch = (first, count) => Array.from({ length: count }, (_, n) => item(String(4902005000 + first + n)));
    const prior = q.submit(batch(1, 20));
    const related = q.submit(batch(21, 18));
    assert.equal(q.jobs.length, 38);
    assert.equal(q.list().queueLimit, 50);
    q.start([...prior.ids, ...related.ids]);
    assert.equal(children.length, 1);
    assert.equal(q.jobs.filter(j => j.state === 'queued').length, 37);

    q.submit(batch(39, 12));
    assert.equal(q.jobs.length, 50);
    assert.equal(q.submit([batch(21, 1)[0], batch(21, 1)[0]]).ids[0], related.ids[0]);
    assert.equal(q.jobs.length, 50);
    assert.throws(() => q.submit([batch(1, 1)[0], batch(51, 1)[0]]), /50/);
    assert.equal(q.jobs.length, 50);
    q.cancel(q.jobs[49].id);
    q.submit(batch(51, 1));
    assert.equal(q.jobs.length, 51);
    assert.equal(q.jobs.filter(j => !['complete', 'failed', 'cancelled', 'interrupted'].includes(j.state)).length, 50);
    for (let n = 0; n < 38; n++) children[n].emit('close', 1);
});

test('pending snapshots survive service restart and removal never starts a worker', t => {
    const { root, queue: q, options, children } = fixture(t);
    const added = q.submit([item(), item('4902005027')]);
    const restored = new ExportQueue(root, options);
    assert(restored.jobs.every(j => j.state === 'pending')); assert.equal(children.length, 0);
    restored.cancel(added.ids[0]); assert.equal(children.length, 0);
    assert.equal(restored.jobs[1].state, 'pending'); assert.equal(restored.list().manualStart, true);
});

test('start validates atomically and runs only chosen jobs in explicit order', t => {
    const { queue: q, children } = fixture(t);
    const { ids } = q.submit([item(), item('4902005027'), item('4902005028')]);
    for (const bad of [[], [ids[0], 'bad'], [ids[0], ids[0]]]) assert.throws(() => q.start(bad));
    assert.equal(children.length, 0); assert(q.jobs.every(j => j.state === 'pending'));
    q.start([ids[2], ids[0]]); assert.equal(q.active.job.id, ids[2]);
    assert.equal(q.get(ids[1]).state, 'pending'); assert.throws(() => q.start([ids[2]]));
    children[0].emit('close', 1); assert.equal(q.active.job.id, ids[0]);
    children[1].emit('close', 1); assert.equal(q.active, null); assert.equal(q.get(ids[1]).state, 'pending');
});

test('start snapshots chosen memory settings per job and passes each snapshot to its worker', t => {
    const { root, queue: q, children, options } = fixture(t);
    const { ids } = q.submit([item(), item('4902005027'), item('4902005028')]);
    const settings = { memoryMiB: 4096, reserveMiB: 2048 };
    q.start([ids[0], ids[1]], settings);
    settings.memoryMiB = 8192; settings.reserveMiB = 1024;
    assert.deepEqual(q.get(ids[0]).settings, { memoryMiB: 4096, reserveMiB: 2048 });
    assert.deepEqual(q.get(ids[1]).settings, { memoryMiB: 4096, reserveMiB: 2048 });
    assert.equal(q.get(ids[2]).settings, undefined);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(q.location(q.get(ids[1])), 'job.json'), 'utf8')).settings,
        { memoryMiB: 4096, reserveMiB: 2048 });
    assert.equal(children[0].settings.env.SSV_PROOF_MEMORY_MIB, '4096');
    assert.equal(children[0].settings.env.SSV_PROOF_RESERVE_MIB, '2048');
    const restored = new ExportQueue(root, options);
    assert.deepEqual(restored.get(ids[0]).settings, { memoryMiB: 4096, reserveMiB: 2048 });
    assert.deepEqual(restored.get(ids[1]).settings, { memoryMiB: 4096, reserveMiB: 2048 });
    children[0].emit('close', 1);
    assert.equal(children[1].settings.env.SSV_PROOF_MEMORY_MIB, '4096');
    assert.equal(children[1].settings.env.SSV_PROOF_RESERVE_MIB, '2048');
    children[1].emit('close', 1);
    q.start([ids[2]], { memoryMiB: 6144, reserveMiB: 3072 });
    assert.equal(children[2].settings.env.SSV_PROOF_MEMORY_MIB, '6144');
    assert.equal(children[2].settings.env.SSV_PROOF_RESERVE_MIB, '3072');
    children[2].emit('close', 1);
});

test('memory settings validation is integral and atomic for the entire selected batch', t => {
    const { queue: q, children } = fixture(t), { ids } = q.submit([item(), item('4902005027')]);
    const maxReserve = Math.min(8192, Math.floor(os.totalmem() / 1024 ** 2) - 512);
    const invalid = [
        { memoryMiB: 511, reserveMiB: 2048 }, { memoryMiB: 8193, reserveMiB: 2048 },
        { memoryMiB: 4096.5, reserveMiB: 2048 }, { memoryMiB: '4096', reserveMiB: 2048 },
        { memoryMiB: 4096, reserveMiB: 1023 }, { memoryMiB: 4096, reserveMiB: maxReserve + 1 },
        { memoryMiB: 4096, reserveMiB: 2048.5 }, { memoryMiB: 4096, reserveMiB: '2048' },
    ];
    for (const settings of invalid) {
        assert.throws(() => q.start(ids, settings));
        assert(q.jobs.every(j => j.state === 'pending' && j.settings === undefined));
        assert.equal(children.length, 0);
    }
    q.start(ids, { memoryMiB: 4096, reserveMiB: 2048 });
    children[0].emit('close', 1); children[1].emit('close', 1);
});

test('omitted memory settings use advertised defaults and are persisted on start', t => {
    const { queue: q, children } = fixture(t), { ids } = q.submit([item()]);
    const defaults = q.list().policyDefaults;
    assert.deepEqual(defaults, { memoryMiB: limits().memoryMiB, reserveMiB: limits().reserveMiB });
    q.start(ids);
    assert.deepEqual(q.get(ids[0]).settings, defaults);
    assert.equal(children[0].settings.env.SSV_PROOF_MEMORY_MIB, String(defaults.memoryMiB));
    assert.equal(children[0].settings.env.SSV_PROOF_RESERVE_MIB, String(defaults.reserveMiB));
    children[0].emit('close', 1);
});

test('live settings update only selected running and queued jobs after worker acknowledgement', async t => {
    const { root, queue: q, children, options } = fixture(t);
    const { ids } = q.submit([item(), item('4902005027'), item('4902005028')]);
    q.start(ids.slice(0, 2), { memoryMiB: 3072, reserveMiB: 1536 });
    const worker = children[0];
    worker.send = (message, callback) => {
        worker.sent.push(message); callback?.();
        if (message.type === 'memory-settings') process.nextTick(() => worker.emit('message', {
            type: 'memory-settings-ack', token: message.token, settings: message.settings }));
    };
    const result = await q.updateSettings(ids, { memoryMiB: 4096, reserveMiB: 2048 });
    assert.deepEqual(result.updatedIds, ids.slice(0, 2));
    assert.deepEqual(result.ignoredIds, [ids[2]]);
    assert.deepEqual(q.get(ids[0]).settings, { memoryMiB: 4096, reserveMiB: 2048 });
    assert.deepEqual(q.get(ids[1]).settings, { memoryMiB: 4096, reserveMiB: 2048 });
    assert.equal(q.get(ids[2]).settings, undefined);
    assert.equal(worker.sent.filter(message => message.type === 'memory-settings').length, 1);
    const restored = new ExportQueue(root, options);
    assert.deepEqual(restored.get(ids[1]).settings, { memoryMiB: 4096, reserveMiB: 2048 });
    worker.emit('close', 1);
    assert.equal(children[1].settings.env.SSV_PROOF_MEMORY_MIB, '4096');
    assert.equal(children[1].settings.env.SSV_PROOF_RESERVE_MIB, '2048');
    children[1].emit('close', 1);
    const terminal = await q.updateSettings([ids[0], ids[1], ids[2]], { memoryMiB: 5120, reserveMiB: 2560 });
    assert.deepEqual(terminal.updatedIds, []);
    assert.deepEqual(terminal.ignoredIds, ids);
    assert.equal(q.get(ids[2]).settings, undefined);
});

test('live settings reject invalid or unacknowledged changes without changing saved settings', async t => {
    const { queue: q, children } = fixture(t), { ids } = q.submit([item(), item('4902005027')]);
    q.start(ids, { memoryMiB: 3072, reserveMiB: 1536 });
    for (const bad of [null, { memoryMiB: '4096', reserveMiB: 2048 }, { memoryMiB: 4096, reserveMiB: 2048, extra: true }])
        await assert.rejects(q.updateSettings(ids, bad));
    await assert.rejects(q.updateSettings([ids[0], 'bad'], { memoryMiB: 4096, reserveMiB: 2048 }));
    assert.deepEqual(q.get(ids[1]).settings, { memoryMiB: 3072, reserveMiB: 1536 });
    children[0].connected = false;
    await assert.rejects(q.updateSettings(ids, { memoryMiB: 4096, reserveMiB: 2048 }), /控制通道不可用/);
    assert.deepEqual(q.get(ids[0]).settings, { memoryMiB: 3072, reserveMiB: 1536 });
    assert.deepEqual(q.get(ids[1]).settings, { memoryMiB: 3072, reserveMiB: 1536 });
    children[0].connected = true;
    const rejected = q.updateSettings(ids, { memoryMiB: 4096, reserveMiB: 2048 });
    const message = children[0].sent.at(-1);
    children[0].emit('message', { type: 'memory-settings-rejected', token: message.token, error: 'test rejection' });
    await assert.rejects(rejected, /test rejection/);
    assert.deepEqual(q.get(ids[0]).settings, { memoryMiB: 3072, reserveMiB: 1536 });
    assert.deepEqual(q.get(ids[1]).settings, { memoryMiB: 3072, reserveMiB: 1536 });
    children[0].emit('close', 1); children[1].emit('close', 1);
});
test('worker exit during live settings acknowledgement never reports queued settings as applied', async t => {
    const { queue: q, children } = fixture(t), { ids } = q.submit([item(), item('4902005027')]);
    q.start(ids, { memoryMiB: 3072, reserveMiB: 1536 });
    const updating = q.updateSettings(ids, { memoryMiB: 4096, reserveMiB: 2048 });
    children[0].emit('close', 1);
    await assert.rejects(updating, /已结束/);
    assert.deepEqual(q.get(ids[1]).settings, { memoryMiB: 3072, reserveMiB: 1536 });
    assert.equal(children.length, 2);
    children[1].emit('close', 1);
});

test('unstarted queued items return to pending after service recovery', t => {
    const { root, queue: q, options, children } = fixture(t);
    const { ids } = q.submit([item(), item('4902005027')]); q.start(ids);
    const restored = new ExportQueue(root, options);
    assert.equal(restored.get(ids[0]).state, 'interrupted'); assert.equal(restored.get(ids[1]).state, 'pending');
    q.cancel(ids[1]); children[0].emit('close', 1);
});

test('global folder target is the parent of all named video folders, even before first export', t => {
    const { root, queue: q, children } = fixture(t);
    assert.deepEqual(q.openRoot(), { directory: path.join(root, 'exports/offline-videos') });
    assert(fs.statSync(q.openRoot().directory).isDirectory()); assert.equal(children.length, 0);
});
test('cleanup removes only reproducible intermediates, preserving sources, assets, video and reports', t => {
    const { root } = fixture(t); const dir = path.join(root, 'cleanup'); fs.mkdirSync(dir);
    const keep = ['source.json', 'input.json', 'offline-report.json', '123456.offline.mp4'];
    for (const file of [...keep, 'picture.h264', 'picture.mp4', 'mix.f32', '123456.offline.partial.mp4']) fs.writeFileSync(path.join(dir, file), 'safe');
    fs.mkdirSync(path.join(dir, 'audio')); fs.writeFileSync(path.join(dir, 'audio/0123456789abcdef.browser.f32'), 'pcm');
    fs.mkdirSync(path.join(dir, 'cache')); fs.writeFileSync(path.join(dir, 'cache/asset'), 'resource');
    const r = cleanup(dir, { success: true, managed: true }); assert.equal(r.bytes, 19);
    for (const file of [...keep, 'cache/asset']) assert(fs.existsSync(path.join(dir, file)));
    assert(!fs.existsSync(path.join(dir, 'audio'))); assert(!fs.existsSync(path.join(dir, 'picture.mp4')));
});
test('unknown or linked intermediates reject the entire cleanup before deletion', t => {
    const { root } = fixture(t), dir = path.join(root, 'cleanup'); fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'picture.mp4'), 'keep'); fs.mkdirSync(path.join(dir, 'audio'));
    fs.writeFileSync(path.join(dir, 'audio/user-note.txt'), 'keep');
    assert.throws(() => cleanup(dir, { managed: true }), /Unknown/); assert(fs.existsSync(path.join(dir, 'picture.mp4')));
    const linked = path.join(root, 'linked-job'); fs.symlinkSync(dir, linked, 'junction');
    assert.throws(() => cleanup(linked), /linked/); fs.unlinkSync(linked);
});
test('preroll batches preserve sequential steps and hand off first capture frame exactly once', async () => {
    const vm = require('node:vm');
    const text = fs.readFileSync(path.join(__dirname, '../experiments/offline-export/page.js'), 'utf8');
    const fn = text.slice(text.indexOf('proof.advancePreroll ='), text.indexOf('proof.prepareEncoder ='));
    const frames = [], proof = { player: { _trackManager: { currentIndex: 9 } }, step: async frame => {
        frames.push(frame); return { done: false, captureStartFrame: frame >= 8 ? 8 : null };
    } };
    vm.runInNewContext(fn, { proof });
    const a = await proof.advancePreroll(0, 6), b = await proof.advancePreroll(a.frame + 1, 6);
    assert.deepEqual(frames, [0, 1, 2, 3, 4, 5, 6, 7, 8]); assert.equal(b.frame, 8); assert.equal(b.steps, 3);
    await assert.rejects(proof.advancePreroll(0, 7));
    const runner = fs.readFileSync(path.join(__dirname, '../experiments/offline-export/run.cjs'), 'utf8');
    assert.match(runner, /options.branchPreview && !runProfile.diagnostics/);
    assert.match(runner, /proof.renderBatch\(args\)/);
    const pipeline = fs.readFileSync(path.join(__dirname, '../experiments/offline-export/frame-pipeline.js'), 'utf8');
    assert.match(pipeline, /prepared \|\| await proof.step/);
});
test('preroll throughput remains bounded and yields more under foreground pressure', () => {
    const normal = prerollRest(10, 6, { reason: 'normal', duty: 0.65 });
    const busy = prerollRest(10, 6, { reason: 'busy', duty: 0.25 });
    assert.equal(normal, 40); assert.equal(busy, 490);
    assert.equal(prerollRest(100, 6, { reason: 'normal', duty: 0.65 }), 150);
});
