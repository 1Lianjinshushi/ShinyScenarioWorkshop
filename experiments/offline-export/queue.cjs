'use strict';
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto'), os = require('node:os');
const terminal = new Set(['complete', 'failed', 'cancelled', 'interrupted']);
const { publishVideo, checkedDirectory, resolveNames } = require('./naming.cjs');
const { limits } = require('./governor.cjs');
const MiB = 1024 * 1024;
const MAX_SUBMIT_BATCH = 20, MAX_UNFINISHED_JOBS = 50;
function policyDefaults() {
    const { memoryMiB, reserveMiB } = limits();
    return { memoryMiB, reserveMiB };
}
function policyBounds() {
    return { memoryMiB: { min: 512, max: 8192 },
        reserveMiB: { min: 1024, max: Math.min(8192, Math.floor(os.totalmem() / MiB) - 512) } };
}
function validateSettings(raw) {
    const defaults = policyDefaults();
    if (raw == null) return defaults;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || Object.keys(raw).some(key => !['memoryMiB', 'reserveMiB'].includes(key)))
        throw new Error('直出内存设置无效');
    const bounds = policyBounds();
    for (const [key, label] of [['memoryMiB', '直出进程内存上限'], ['reserveMiB', '系统保留内存']]) {
        const value = raw[key], { min, max } = bounds[key];
        if (!Number.isSafeInteger(value) || value < min || value > max)
            throw new Error(`${label}须为 ${min}～${max} MiB 的整数`);
    }
    return { memoryMiB: raw.memoryMiB, reserveMiB: raw.reserveMiB };
}
function validateRequest(item) {
    if (!item || !/^\d{6,14}$/.test(item.eventId || '') || !/^[a-z_]{2,80}$/.test(item.eventType || '')) throw new Error('剧情编号或分类不正确');
    const mode = item.mode || 'offline';
    if (mode !== 'offline') throw new Error('工坊仅导出完整剧情');
    if (!['ja', 'zh-cn'].includes(item.language || 'ja')) throw new Error('不支持的语言');
    if (typeof item.content !== 'string' || Buffer.byteLength(item.content) > 12 * 1024 * 1024) throw new Error('剧情 JSON 过大或为空');
    const tracks = JSON.parse(item.content.replace(/^\uFEFF/, ''));
    if (!Array.isArray(tracks) || !tracks.length || tracks.length > 20000 || tracks.some(t => !t || typeof t !== 'object' || Array.isArray(t))) throw new Error('不是有效的剧情轨道数组');
    const choices = tracks.filter(t => t.select);
    if (choices.length !== 0 && choices.length !== 1 && choices.length !== 3) throw new Error('试验版目前仅支持单选项或一组三选项；两选项、嵌套或多组选项暂不支持');
    return { eventId: item.eventId, eventType: item.eventType, language: item.language || 'ja', mode,
        content: item.content, fingerprint: crypto.createHash('sha256').update(JSON.stringify([item.content, mode, item.language || 'ja', item.eventType])).digest('hex') };
}
function runtime(root) {
    const pick = candidates => candidates.filter(Boolean).find(f => fs.existsSync(f));
    const ffmpeg = pick([process.env.SSV_FFMPEG, path.join(root, 'tools/ffmpeg.exe'), 'D:/ffmpeg/bin/ffmpeg.exe']);
    const ffprobe = pick([process.env.SSV_FFPROBE, ffmpeg && path.join(path.dirname(ffmpeg), 'ffprobe.exe')]);
    const chromium = pick([process.env.SSV_CHROMIUM, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']);
    const playwright = pick([process.env.SSV_PLAYWRIGHT, path.join(root, 'tools/node_modules/playwright'),
        path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')]);
    const missing = Object.entries({ FFmpeg: ffmpeg, FFprobe: ffprobe, Chromium: chromium, Playwright: playwright }).filter(([, v]) => !v).map(([k]) => k);
    if (process.platform !== 'win32') missing.push('Windows 进程预算支持');
    return { available: !missing.length, missing, env: { SSV_FFMPEG: ffmpeg, SSV_FFPROBE: ffprobe, SSV_CHROMIUM: chromium, SSV_PLAYWRIGHT: playwright } };
}
class ExportQueue {
    constructor(root, options = {}) {
        this.root = path.resolve(root); this.dir = path.join(this.root, 'exports/offline-jobs');
        fs.mkdirSync(this.dir, { recursive: true }); this.jobs = []; this.active = null;
        this.runtime = options.runtime || (() => runtime(this.root));
        this.resumeAckTimeoutMs = options.resumeAckTimeoutMs ?? 30000;
        this.fork = options.fork || ((file, args, settings) => cp.fork(file, args, settings));
        this.kill = options.kill || (child => cp.execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {}));
        for (const name of fs.readdirSync(this.dir)) {
            if (!/^[a-f0-9]{32}$/.test(name)) continue;
            try {
                const j = JSON.parse(fs.readFileSync(path.join(this.dir, name, 'job.json'), 'utf8'));
                if (j.id !== name) continue;
                if (j.state === 'queued') { j.state = j.stage = 'pending'; }
                else if (j.state !== 'pending' && !terminal.has(j.state)) {
                    j.state = j.stage = 'interrupted';
                    j.error = '上次后台服务中断；请重新提交。不会自动恢复未确认的任务。';
                    delete j.pause;
                }
                this.jobs.push(j); this.persist(j);
            } catch (_) {}
        }
        this.jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    location(job) { return path.join(this.dir, job.id); }
    persist(job) {
        const file = path.join(this.location(job), 'job.json');
        fs.writeFileSync(file + '.tmp', JSON.stringify(job, null, 2)); fs.renameSync(file + '.tmp', file);
    }
    list() {
        const r = this.runtime();
        return { available: r.available, missing: r.missing, experimental: true, manualStart: true,
            policyDefaults: policyDefaults(), policyBounds: policyBounds(), queueLimit: MAX_UNFINISHED_JOBS,
            jobs: this.jobs.filter(j => !terminal.has(j.state) || this.jobs.slice(-100).includes(j)).map(({ fingerprint, ...j }) => j) };
    }
    submit(items) {
        if (!Array.isArray(items) || !items.length || items.length > MAX_SUBMIT_BATCH) throw new Error(`一次请提交 1～${MAX_SUBMIT_BATCH} 段剧情`);
        const r = this.runtime(); if (!r.available) throw new Error('缺少直出依赖：' + r.missing.join('、'));
        const parsed = items.map(validateRequest), ids = [];
        const active = this.jobs.filter(j => !terminal.has(j.state));
        const activeKeys = new Set(active.map(j => `${j.eventId}:${j.fingerprint}`));
        const newKeys = new Set(parsed.map(j => `${j.eventId}:${j.fingerprint}`).filter(key => !activeKeys.has(key)));
        if (active.length + newKeys.size > MAX_UNFINISHED_JOBS) throw new Error(`队列最多容纳 ${MAX_UNFINISHED_JOBS} 段未完成剧情`);
        for (const item of parsed) {
            const existing = this.jobs.find(j => !terminal.has(j.state) && j.eventId === item.eventId && j.fingerprint === item.fingerprint);
            if (existing) { ids.push(existing.id); continue; }
            const id = crypto.randomBytes(16).toString('hex');
            const job = { id, eventId: item.eventId, eventType: item.eventType, language: item.language,
                mode: item.mode, fingerprint: item.fingerprint, state: 'pending', stage: 'pending',
                createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            fs.mkdirSync(this.location(job));
            fs.writeFileSync(path.join(this.location(job), item.eventId + '.json'), item.content);
            try { const names = resolveNames(this.root, job); job.displayTitle = names.title; job.displayGroup = names.folder; } catch (_) {}
            this.jobs.push(job); this.persist(job); ids.push(id);
        }
        return { ids, ...this.list() };
    }
    start(ids, settings) {
        if (!Array.isArray(ids) || !ids.length || ids.length > MAX_UNFINISHED_JOBS || new Set(ids).size !== ids.length) throw new Error('请勾选要导出的剧情');
        const jobs = ids.map(id => this.get(id));
        if (jobs.some(j => j.state !== 'pending')) throw new Error('部分剧情已开始或已移除，请刷新列表后重新选择');
        const r = this.runtime(); if (!r.available) throw new Error('缺少直出依赖：' + r.missing.join('、'));
        const memorySettings = validateSettings(settings);
        let order = Math.max(0, ...this.jobs.map(j => j.startOrder || 0));
        for (const job of jobs) {
            job.state = job.stage = 'queued'; job.startOrder = ++order;
            job.settings = { ...memorySettings };
            job.updatedAt = new Date().toISOString(); this.persist(job);
        }
        this.pump(); return this.list();
    }
    async updateSettings(ids, settings) {
        if (!Array.isArray(ids) || !ids.length || ids.length > MAX_UNFINISHED_JOBS
            || new Set(ids).size !== ids.length) throw new Error('请选择要调整内存设置的任务');
        if (settings == null) throw new Error('请提供完整的直出内存设置');
        const jobs = ids.map(id => this.get(id));
        const memorySettings = validateSettings(settings);
        const running = jobs.find(job => job.state === 'running' || job.state === 'paused');
        if (running) {
            const active = this.active;
            if (!active || active.job !== running || !active.child.connected)
                throw new Error('运行任务的控制通道不可用，内存设置未确认生效');
            if (active.pendingSettings) throw new Error('运行任务的上一项内存调整尚未确认');
            if (active.pendingResume) throw new Error('运行任务正在复检内存，请稍后调整设置');
            const token = crypto.randomBytes(16).toString('hex');
            await new Promise((resolve, reject) => {
                const pending = { token, settings: memorySettings, resolve, reject, timer: null };
                active.pendingSettings = pending;
                const fail = error => {
                    if (active.pendingSettings !== pending) return;
                    clearTimeout(pending.timer); active.pendingSettings = null;
                    reject(error);
                };
                pending.timer = setTimeout(() => fail(new Error('运行进程未确认内存调整；请刷新任务状态后重试')), 2500);
                try {
                    active.child.send({ type: 'memory-settings', token, settings: memorySettings }, error => {
                        if (error) fail(new Error('运行进程未接收内存调整：' + error.message));
                    });
                } catch (error) { fail(new Error('无法调整运行任务内存：' + error.message)); }
            });
        }
        const updatedIds = [], ignoredIds = [];
        for (const job of jobs) {
            if (job.state !== 'queued' && job.state !== 'running' && job.state !== 'paused') { ignoredIds.push(job.id); continue; }
            job.settings = { ...memorySettings }; job.updatedAt = new Date().toISOString();
            this.persist(job); updatedIds.push(job.id);
        }
        return { updatedIds, ignoredIds, ...this.list() };
    }
    pump() {
        if (this.active) return;
        const job = this.jobs.filter(j => j.state === 'queued').sort((a, b) => (a.startOrder || 0) - (b.startOrder || 0))[0]; if (!job) return;
        job.state = 'running'; job.stage = 'preflight'; this.persist(job);
        const r = this.runtime(), dir = this.location(job);
        let child;
        try {
            child = this.fork(path.join(this.root, 'experiments/offline-export/run.cjs'), [path.join(dir, job.eventId + '.json'), job.mode], {
                cwd: this.root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
                env: { ...process.env, ...r.env, SSV_PROOF_JOB_ID: job.id, SSV_PROOF_LANGUAGE: job.language,
                    SSV_PROOF_CLEANUP: '1', SSV_PROOF_DIAGNOSTICS: '0', SSV_PROOF_FAST_PREROLL: '1',
                    SSV_PROOF_MEMORY_MIB: String(job.settings.memoryMiB),
                    SSV_PROOF_RESERVE_MIB: String(job.settings.reserveMiB) },
            });
        } catch (error) { job.state = 'failed'; job.error = error.message; this.persist(job); return this.pump(); }
        const active = { job, child, pendingSettings: null, pendingResume: null, resumeRequestIds: new Set() };
        this.active = active; let tail = '', timer;
        const log = fs.createWriteStream(path.join(dir, 'worker.log'));
        const append = data => { tail = (tail + data.toString()).slice(-4000); log.write(data); };
        child.stdout.on('data', append); child.stderr.on('data', append);
        child.on('message', m => {
            const pending = active.pendingSettings;
            if (pending && m?.token === pending.token
                && (m.type === 'memory-settings-ack' || m.type === 'memory-settings-rejected')) {
                clearTimeout(pending.timer); active.pendingSettings = null;
                if (m.type === 'memory-settings-ack' && m.settings?.memoryMiB === pending.settings.memoryMiB
                    && m.settings?.reserveMiB === pending.settings.reserveMiB) pending.resolve();
                else if (m.type === 'memory-settings-ack') pending.reject(new Error('运行进程返回的内存设置与请求不一致'));
                else pending.reject(new Error('运行进程拒绝内存调整：' + (m.error || '未知原因')));
                return;
            }
            if (m?.type === 'memory-pause') {
                if (job.state === 'cancelling') return;
                job.state = job.stage = 'paused';
                job.pause = {
                    code: 'MEMORY_BUDGET_PAUSE',
                    reason: String(m.message || m.reason || '系统可用内存不足，已暂停当前任务。'),
                    stage: String(m.phase || 'memory'),
                    details: { requiredMiB: Number.isFinite(m.requiredMiB) ? m.requiredMiB : null },
                    since: new Date().toISOString(),
                };
                job.updatedAt = new Date().toISOString(); this.persist(job);
                return;
            }
            const resume = active.pendingResume;
            if (m?.type === 'memory-resume-result' && active.resumeRequestIds.has(m.requestId)) {
                // A slow Windows memory sample can outlive the HTTP request.
                // A late, authenticated child ACK must still reconcile persisted
                // state, or the UI could show "paused" while frames are encoding.
                active.resumeRequestIds.delete(m.requestId);
                const resumed = m.resumed === true;
                const completeRequest = resume && resume.requestId === m.requestId;
                if (completeRequest) { clearTimeout(resume.timer); active.pendingResume = null; }
                if (job.state === 'cancelling') {
                    if (completeRequest && !resume.timedOut) resume.reject(new Error('任务已取消，无法继续'));
                    return;
                }
                if (resumed) {
                    job.state = 'running'; job.stage = job.pause?.stage || job.progress?.stage || 'preflight';
                    delete job.pause;
                } else if (job.state === 'paused') {
                    job.pause = { ...(job.pause || {}), code: 'MEMORY_BUDGET_PAUSE',
                        reason: String(m.message || m.reason || job.pause?.reason || '内存仍不足，任务保持暂停。') };
                }
                job.updatedAt = new Date().toISOString(); this.persist(job);
                if (completeRequest && !resume.timedOut) resume.resolve({ resumed,
                    reason: resumed ? undefined : job.pause?.reason });
                return;
            }
            if (m?.type !== 'progress') return;
            const { type, outputPath, ...progress } = m;
            job.progress = progress; if (job.state !== 'cancelling' && job.state !== 'paused') job.stage = progress.stage;
            job.updatedAt = new Date().toISOString(); this.persist(job);
        });
        child.on('error', error => { tail += '\n' + error.message; });
        child.once('close', code => {
            if (active.pendingSettings) {
                clearTimeout(active.pendingSettings.timer);
                active.pendingSettings.reject(new Error('运行进程已结束，内存调整未确认生效'));
                active.pendingSettings = null;
            }
            if (active.pendingResume) {
                clearTimeout(active.pendingResume.timer);
                if (!active.pendingResume.timedOut)
                    active.pendingResume.reject(new Error('运行进程已结束，内存复检未完成'));
                active.pendingResume = null;
            }
            clearTimeout(timer); log.end();
            const video = path.join(dir, `${job.eventId}.offline.mp4`);
            job.state = job.state === 'cancelling' ? 'cancelled' : code === 0 && fs.existsSync(video) ? 'complete' : 'failed';
            job.stage = job.state; job.updatedAt = new Date().toISOString();
            delete job.pause;
            if (job.state === 'complete') {
                job.outputUrl = `/exports/offline-jobs/${job.id}/${job.eventId}.offline.mp4`;
                job.outputPath = video;
                try { Object.assign(job, publishVideo(this.root, job, video)); }
                catch (error) { job.namingWarning = '按名称整理失败，成片仍保留在任务目录：' + error.message; }
                try { job.cleanupWarning = JSON.parse(fs.readFileSync(path.join(dir, 'cleanup-warning.json'), 'utf8')).message; } catch (_) {}
            } else if (job.state === 'failed') {
                try { job.error = JSON.parse(fs.readFileSync(path.join(dir, 'failure.json'), 'utf8')).message; }
                catch (_) { job.error = tail.trim().slice(-1500) || `导出进程退出（${code}）`; }
            }
            // Forced termination can leave only disposable partials. Never
            // remove source snapshots, final outputs or cached assets here.
            try { const { cleanup } = require('./cleanup.cjs');
                if (job.state !== 'complete' && !fs.existsSync(path.join(dir, 'cleanup-report.json'))) cleanup(dir, { success: false, managed: true }); }
            catch (e) { job.cleanupWarning = e.message; }
            this.persist(job);
            if (job.state === 'complete' && job.outputPath !== video) {
                // The named file exists and its location is persisted before
                // retiring this worker-owned intermediate name.
                try { fs.unlinkSync(video); }
                catch (error) { job.namingWarning = '成片已整理，任务目录中的重复文件未能清理：' + error.message; this.persist(job); }
            }
            this.active = null; this.pump();
        });
        this.active.cancel = () => {
            if (child.connected) child.send({ type: 'cancel' });
            timer = setTimeout(() => this.kill(child), 30000); timer.unref?.();
        };
    }
    get(id) {
        if (!/^[a-f0-9]{32}$/.test(id || '')) throw new Error('任务编号无效');
        const job = this.jobs.find(j => j.id === id); if (!job) throw new Error('找不到该任务'); return job;
    }
    async resume(id) {
        const job = this.get(id);
        if (job.state !== 'paused') throw new Error('只有因内存安全预算暂停的任务可以继续');
        const active = this.active;
        if (!active || active.job !== job || !active.child.connected)
            throw new Error('暂停任务的运行进程不可用，请刷新状态');
        if (active.pendingResume) throw new Error('上一次内存复检尚未完成');
        if (active.pendingSettings) throw new Error('内存设置尚未确认，请稍后再试');
        const requestId = crypto.randomBytes(16).toString('hex');
        const result = await new Promise((resolve, reject) => {
            const pending = { requestId, resolve, reject, timer: null, timedOut: false };
            active.pendingResume = pending;
            const fail = error => {
                if (active.pendingResume !== pending) return;
                clearTimeout(pending.timer); active.pendingResume = null; reject(error);
            };
            pending.timer = setTimeout(() => {
                // The HTTP caller must not wait forever, but the worker may
                // still be sampling memory. Keep this token in flight so a
                // second click cannot queue a duplicate wake-up.
                pending.timedOut = true;
                reject(new Error('内存复检仍在进行，请等待状态更新后重试'));
            }, this.resumeAckTimeoutMs);
            try {
                active.resumeRequestIds.add(requestId);
                active.child.send({ type: 'memory-resume', requestId }, error => {
                    if (error) {
                        active.resumeRequestIds.delete(requestId);
                        fail(new Error('无法向运行进程发送继续指令：' + error.message));
                    }
                });
            } catch (error) {
                active.resumeRequestIds.delete(requestId);
                fail(new Error('无法继续任务：' + error.message));
            }
        });
        return { ...result, ...this.list() };
    }
    cancel(id) {
        const job = this.get(id);
        if (terminal.has(job.state) || job.state === 'cancelling') return this.list();
        if (['pending', 'queued'].includes(job.state)) job.state = job.stage = 'cancelled';
        else {
            job.state = job.stage = 'cancelling';
            if (this.active?.pendingResume) {
                clearTimeout(this.active.pendingResume.timer);
                if (!this.active.pendingResume.timedOut)
                    this.active.pendingResume.reject(new Error('任务已取消，内存复检终止'));
                this.active.pendingResume = null;
            }
            this.active.cancel();
        }
        job.updatedAt = new Date().toISOString(); this.persist(job); return this.list();
    }
    open(id) {
        const job = this.get(id); if (job.state !== 'complete') throw new Error('视频尚未完成');
        const directory = job.outputPath ? path.dirname(job.outputPath) : this.location(job);
        checkedDirectory(path.join(this.root, 'exports'), directory);
        if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error('输出目录已不存在');
        // The interactive workshop host opens Explorer, not this detached worker.
        // Returning a target is not a claim that Windows opened it successfully.
        return { directory };
    }
    openRoot() {
        const directory = checkedDirectory(path.join(this.root, 'exports'), path.join(this.root, 'exports/offline-videos'));
        fs.mkdirSync(directory, { recursive: true });
        return { directory };
    }
}
module.exports = { ExportQueue, validateRequest, validateSettings, policyDefaults, policyBounds, runtime };
