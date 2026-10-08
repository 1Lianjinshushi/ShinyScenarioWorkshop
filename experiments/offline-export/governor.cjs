'use strict';
const fs = require('node:fs');
const os = require('node:os');
const { ProcessMemorySampler } = require('./memory-sampler.cjs');
const MiB = 1024 * 1024;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const SPEED_MODES = Object.freeze(['low-load', 'high-speed']);
function validateSpeedMode(value = 'low-load') {
    if (!SPEED_MODES.includes(value)) throw new Error('导出速度模式无效');
    return value;
}

function limits(env = process.env, total = os.totalmem()) {
    const speedMode = validateSpeedMode(env.SSV_PROOF_SPEED_MODE);
    const number = (key, fallback, min, max) => {
        const n = Number(env[key] ?? fallback);
        if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${key} must be ${min}..${max}`);
        return n;
    };
    return {
        speedMode,
        // null explicitly means no wall-clock FPS cap. Ignore legacy queue
        // WALL_FPS overrides in high-speed mode, including a still-running
        // service's previous value of 60. This never changes video timestamps.
        fps: speedMode === 'high-speed' ? null : number('SSV_PROOF_WALL_FPS', 18, 1, 30),
        memoryMiB: number('SSV_PROOF_MEMORY_MIB', Math.min(3072, Math.floor(total / MiB / 4)), 512, 8192),
        reserveMiB: number('SSV_PROOF_RESERVE_MIB', Math.max(1536, Math.floor(total / MiB * 0.1)), 512, total / MiB),
        sampleMs: 3000,
    };
}
function decide(sample, policy) {
    const cappedFps = maximum => Math.min(policy.fps ?? Infinity, maximum);
    if (sample.diskFreeMiB != null && sample.diskFreeMiB < 512) return { action: 'abort', reason: 'disk-space' };
    if (sample.privateMiB >= policy.memoryMiB) return { action: 'pause', reason: 'export-memory-budget' };
    if (sample.freeMiB < policy.reserveMiB) return { action: 'pause', reason: 'system-memory-pressure' };
    if (sample.cpuPercent >= 80 || sample.privateMiB >= policy.memoryMiB * 0.85)
        return { action: 'run', fps: cappedFps(6), duty: 0.25, reason: 'busy' };
    if (sample.cpuPercent >= 60 || sample.freeMiB < policy.reserveMiB + 256)
        return { action: 'run', fps: cappedFps(12), duty: 0.4, reason: 'moderate' };
    if (sample.freeMiB < policy.reserveMiB * 1.5)
        return { action: 'run', fps: cappedFps(15), duty: 0.5, reason: 'memory-caution' };
    // Only wall-clock pacing changes. Every story frame and encoder ACK still
    // runs in order at the existing fixed 60 Hz simulation timestamp.
    return { action: 'run', fps: policy.fps, duty: policy.speedMode === 'high-speed' ? 1 : 0.65, reason: 'normal' };
}
function frameRest(workMs, decision) {
    const intervalMs = decision.fps == null ? 0 : 1000 / decision.fps;
    return Math.max(0, intervalMs - workMs, workMs * (1 / decision.duty - 1));
}
function prerollRest(workMs, steps, decision) {
    // Keep every simulated frame and its Spine render update. Only remove the
    // encoding-speed cap from frames not included in the video; retain duty,
    // pressure checks and a separate bounded simulation throughput.
    const fps = decision.reason === 'busy' ? 12 : decision.reason === 'moderate' ? 60 : 120;
    const duty = Math.min(decision.duty, 0.4);
    return Math.max(0, 1000 * steps / fps - workMs, workMs * (1 / duty - 1));
}
const { acquireLock } = require('./lease.cjs');
function cpuTotals() {
    return os.cpus().reduce((s, c) => ({ idle: s.idle + c.times.idle,
        total: s.total + Object.values(c.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });
}
class Governor {
    constructor(policy, log = () => {}) {
        this.policy = policy; this.log = log; this.samples = []; this.events = [];
        this.children = new Set(); this.session = null; this.lastCpu = cpuTotals();
        this.lastSample = 0; this.current = { action: 'run', fps: policy.fps, duty: 0.65 };
        this.cancelled = false; this.started = Date.now(); this.memoryPause = null;
        this.memorySampler = null;
    }
    updateMemoryPolicy(settings) {
        const memoryMiB = settings?.memoryMiB, reserveMiB = settings?.reserveMiB;
        if (!Number.isSafeInteger(memoryMiB) || memoryMiB < 512 || memoryMiB > 8192
            || !Number.isSafeInteger(reserveMiB) || reserveMiB < 1024
            || reserveMiB > Math.min(8192, Math.floor(os.totalmem() / MiB) - 512))
            throw new Error('Invalid live export memory settings');
        this.policy.memoryMiB = memoryMiB; this.policy.reserveMiB = reserveMiB;
        // Every phase passes a checkpoint before doing more work. Force that
        // checkpoint to sample under the new budget, including on a decrease.
        this.lastSample = 0;
        this.events.push({ kind: 'policy-update', time: Date.now(), memoryMiB, reserveMiB });
        return { memoryMiB, reserveMiB };
    }
    cancel() {
        this.cancelled = true;
        this.memoryPause?.wake?.({ cancelled: true });
    }
    requestMemoryResume(requestId) {
        if (!this.memoryPause || typeof requestId !== 'string' || !requestId) return false;
        const wake = this.memoryPause.wake;
        if (!wake) return false;
        this.memoryPause.wake = null;
        wake({ requestId });
        return true;
    }
    async pauseForMemory(phase, reason, requiredMiB = 0, safe = () => true) {
        if (this.cancelled) throw new Error('Export cancelled');
        const started = Date.now();
        const state = { phase, reason, requiredMiB: Math.ceil(requiredMiB), wake: null };
        this.memoryPause = state;
        const message = reason === 'export-memory-budget'
            ? `直出进程已达到 ${this.policy.memoryMiB} MiB 内存上限，等待清理内存后手动继续。`
            : reason === 'allocation-budget'
                ? `${phase} 预计还需 ${state.requiredMiB} MiB，超过当前安全预算；等待手动继续。`
                : '系统可用内存低于安全预留，等待清理内存后手动继续。';
        this.log(message);
        this.events.push({ kind: 'memory-pause', phase, reason, requiredMiB: state.requiredMiB, time: started });
        const wait = () => new Promise(resolve => { state.wake = resolve; });
        let pending = wait();
        this.onMemoryPause?.({ phase, reason, requiredMiB: state.requiredMiB, message });
        try {
            while (true) {
                const signal = await pending;
                if (this.cancelled || signal?.cancelled) throw new Error('Export cancelled');
                // Establish the next wait before ACKing a rejected resume, so
                // an immediate second click cannot be lost.
                pending = wait();
                let allowed = false, rejection = '';
                try {
                    const sample = await this.sample();
                    if (this.cancelled) throw new Error('Export cancelled');
                    if (this.current.action === 'abort') {
                        if (this.current.reason === 'disk-space') throw new Error('导出磁盘剩余空间不足 512 MiB，已停止写入。');
                        throw new Error(`Export safety abort: ${this.current.reason}`);
                    }
                    allowed = this.current.action === 'run' && safe(sample);
                    if (!allowed) rejection = this.current.action === 'pause'
                        ? '内存仍低于安全预算，请清理内存或调整设置后再继续。'
                        : `${phase} 仍需 ${state.requiredMiB} MiB，超过当前安全预算。`;
                } catch (error) {
                    if (this.cancelled || this.current.action === 'abort') throw error;
                    rejection = `安全复检未完成：${error.message}`;
                }
                if (allowed) {
                    this.memoryPause = null;
                    this.events.push({ kind: 'memory-resume', phase, milliseconds: Date.now() - started });
                    this.onMemoryResumeResult?.({ requestId: signal.requestId, resumed: true, phase });
                    return this.current;
                }
                this.events.push({ kind: 'memory-resume-rejected', phase, time: Date.now(), reason: rejection });
                this.onMemoryResumeResult?.({ requestId: signal.requestId, resumed: false, phase,
                    reason: this.current.reason || reason, message: rejection });
            }
        } finally {
            if (this.memoryPause === state) this.memoryPause = null;
        }
    }
    async sample() {
        const ids = new Set([process.pid, ...this.children]);
        if (this.session) {
            const result = await this.session.send('SystemInfo.getProcessInfo');
            for (const p of result.processInfo) ids.add(p.id);
        }
        for (const pid of ids) { try { os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (_) {} }
        let privateMiB;
        if (process.platform === 'win32') {
            this.memorySampler ||= new ProcessMemorySampler();
            privateMiB = await this.memorySampler.sample([...ids].filter(n => Number.isSafeInteger(n) && n > 0)) / MiB;
            ids.add(this.memorySampler.pid);
            if (!Number.isFinite(privateMiB) || privateMiB <= 0) throw new Error('Cannot read export process memory');
        } else {
            // Fail closed: a Node-only RSS number must not masquerade as a browser-tree budget.
            throw new Error('The memory governor currently requires Windows process accounting');
        }
        const cpu = cpuTotals(), delta = cpu.total - this.lastCpu.total;
        const cpuPercent = delta > 0 ? 100 * (1 - (cpu.idle - this.lastCpu.idle) / delta) : 0;
        this.lastCpu = cpu;
        const disk = this.diskPath ? fs.statfsSync(this.diskPath) : null;
        const sample = { seconds: (Date.now() - this.started) / 1000, phase: this.phase,
            privateMiB, freeMiB: os.freemem() / MiB, cpuPercent, processes: ids.size,
            diskFreeMiB: disk ? disk.bavail * disk.bsize / MiB : null };
        this.current = decide(sample, this.policy);
        this.onDecision?.(this.current);
        this.samples.push({ ...sample, decision: this.current }); this.lastSample = Date.now();
        return sample;
    }
    async checkpoint(phase, force = false) {
        this.phase = phase;
        if (this.cancelled) throw new Error('Export cancelled');
        if (force || Date.now() - this.lastSample >= this.policy.sampleMs) await this.sample();
        if (this.current.action === 'pause') await this.pauseForMemory(phase, this.current.reason);
        if (this.current.action === 'abort') throw new Error(this.current.reason === 'disk-space'
            ? '导出磁盘剩余空间不足 512 MiB，已停止写入。'
            : `直出内存超过 ${this.policy.memoryMiB} MiB 预算，已中止以保护前台使用。`);
        return this.current;
    }
    async pace(started) {
        const rest = frameRest(Date.now() - started, this.current);
        // setTimeout(0) still schedules a timer. A normal high-speed frame has
        // already yielded through its encoder ACK and must not add a timer.
        if (rest > 0) await sleep(rest);
    }
    async pacePreroll(started, steps) { await sleep(prerollRest(Date.now() - started, steps, this.current)); }
    async allocation(bytes, label) {
        await this.checkpoint(label, true);
        const mib = bytes / MiB;
        const fits = sample => sample.privateMiB + mib <= this.policy.memoryMiB
            && sample.freeMiB - mib >= this.policy.reserveMiB;
        if (!fits(this.samples.at(-1))) await this.pauseForMemory(label, 'allocation-budget', mib, fits);
    }
    async close() { await this.memorySampler?.close(); }
    report() { return { policy: this.policy, scope: 'Node + owned Chromium processes + active FFmpeg + owned memory sampler; Windows private bytes; system CPU',
        note: 'Cooperative 3-second sampling and preallocation guards, not an OS hard cap or a GPU-memory measurement.',
        peakPrivateMiB: Math.max(0, ...this.samples.map(s => s.privateMiB)), samples: this.samples, events: this.events }; }
}
module.exports = { limits, decide, frameRest, prerollRest, acquireLock, Governor, SPEED_MODES, validateSpeedMode };
