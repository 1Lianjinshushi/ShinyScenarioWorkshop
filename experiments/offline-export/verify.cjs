'use strict';
const fs = require('node:fs'), cp = require('node:child_process');
const VERIFICATION_MODES = Object.freeze(['auto', 'quick', 'full']);
function validateVerificationMode(mode) {
    if (!VERIFICATION_MODES.includes(mode)) throw new Error('成片检查模式只能为 auto、quick 或 full');
    return mode;
}
// Consume existing pause callbacks only: no timers, probes, per-frame work or
// new system sampling. Normal CPU load/lease waits are not corruption evidence.
class VerificationPolicy {
    constructor(mode = 'auto') { this.requestedMode = validateVerificationMode(mode); this.reasons = new Map(); }
    memoryPause(stage, detail) {
        const labels = { render: '画面生成', audio: '音频合成', mux: '视频封装' };
        const reasons = { 'allocation-budget': '分配预算不足', 'export-memory-budget': '进程内存达到预算', 'system-memory-pressure': '系统内存余量不足' };
        if (!labels[stage] || !reasons[detail?.reason]) return false;
        const key = stage + ':' + detail.reason;
        if (this.reasons.has(key)) return false;
        this.reasons.set(key, { stage, reason: detail.reason, message: labels[stage] + '期间因' + reasons[detail.reason] + '触发过暂停' });
        return true;
    }
    report() {
        const upgraded = this.requestedMode === 'auto' && this.reasons.size > 0;
        return { requestedMode: this.requestedMode, effectiveMode: this.requestedMode === 'full' || upgraded ? 'full' : 'quick',
            upgraded, reasons: [...this.reasons.values()].map(reason => ({ ...reason })) };
    }
}
function validateMetadata(data, expectedFrames) {
    if (!Number.isSafeInteger(expectedFrames) || expectedFrames <= 0) throw new Error('Invalid expected frame count');
    const video = data.streams?.filter(s => s.codec_type === 'video') || [];
    const audio = data.streams?.filter(s => s.codec_type === 'audio') || [];
    const fail = message => { throw new Error('成片快速检查未通过：' + message); };
    if (video.length !== 1 || audio.length !== 1) fail('必须包含一条视频轨和一条音频轨');
    const v = video[0], a = audio[0], duration = expectedFrames / 60;
    const close = (value, target, tolerance) => Number.isFinite(Number(value)) && Math.abs(Number(value) - target) <= tolerance;
    if (v.codec_name !== 'h264' || v.width !== 1920 || v.height !== 1080 || v.r_frame_rate !== '60/1') fail('视频规格不是 H.264 1080p60');
    if (Number(v.nb_frames) !== expectedFrames) fail('封装后的帧数与编码确认数不一致');
    if (!close(v.start_time, 0, 0.001) || !close(v.duration, duration, 1 / 60 + 0.0001)) fail('视频起点或时长不一致');
    if (a.codec_name !== 'aac' || Number(a.sample_rate) !== 48000 || a.channels !== 2) fail('音频规格不是 AAC 48 kHz 双声道');
    if (!close(a.start_time, 0, 0.05) || !close(a.duration, duration, 0.05)) fail('音频起点或时长与画面不一致');
    if (!close(data.format?.duration, duration, 0.05)) fail('MP4 总时长不一致');
    return { frames: expectedFrames, duration, width: v.width, height: v.height, fps: 60, sampleRate: 48000, channels: 2 };
}
function validatePackets(text, expectedFrames, fileBytes) {
    let count = 0, lastDts = -Infinity;
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const p = Object.fromEntries(line.split('|').map(field => field.split('=')));
        const pts = Number(p.pts_time), dts = Number(p.dts_time), duration = Number(p.duration_time);
        const pos = Number(p.pos), size = Number(p.size);
        if (![pts, dts, duration].every(Number.isFinite) || Math.abs(pts - count / 60) > 0.00002
            || Math.abs(duration - 1 / 60) > 0.00002 || dts <= lastDts
            || !Number.isSafeInteger(pos) || !Number.isSafeInteger(size) || pos < 0 || size <= 0 || pos + size > fileBytes)
            throw new Error(`成片快速检查未通过：第 ${count + 1} 帧的时间戳或文件范围无效`);
        lastDts = dts; count++;
    }
    if (count !== expectedFrames) throw new Error(`成片快速检查未通过：实际视频包 ${count} 个，期望 ${expectedFrames} 个`);
    return count;
}

// Bounded header/packet inspection, not decoded frame extraction. It remains
// cancellable and participates in the worker's memory accounting. Memory
// pressure stops this read-only probe and repeats it after explicit resume.
async function probe(binary, args, governor) {
    for (;;) {
        await governor.checkpoint('verify-quick', true);
        const child = cp.spawn(binary, ['-v', 'error', ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        governor.children.add(child.pid);
        let chunks = [], bytes = 0, stderr = '', failure, pause, checking = Promise.resolve(), busy = false;
        child.stdout.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > 32 * 1024 ** 2) { failure = new Error('成片快速检查输出超过安全上限'); child.kill(); }
            else chunks.push(chunk);
        });
        child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
        const timeout = setTimeout(() => { failure = new Error('成片快速检查超时'); child.kill(); }, 120000);
        const timer = setInterval(() => {
            if (governor.cancelled) { failure = new Error('Export cancelled'); child.kill(); return; }
            if (busy || Date.now() - governor.lastSample < governor.policy.sampleMs) return;
            busy = true;
            checking = (async () => {
                try {
                    await governor.sample();
                    if (governor.current.action === 'pause') { pause = governor.current.reason; child.kill(); }
                    if (governor.current.action === 'abort') { failure = new Error('成片检查被安全预算中止'); child.kill(); }
                } catch (error) { failure = error; child.kill(); }
                finally { busy = false; }
            })();
        }, 100);
        let code;
        try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); }
        finally { clearTimeout(timeout); clearInterval(timer); await checking; governor.children.delete(child.pid); }
        if (governor.cancelled) throw new Error('Export cancelled');
        if (failure) throw failure;
        if (pause) { await governor.pauseForMemory('verify-quick', pause); continue; }
        if (code !== 0) throw new Error('成片快速检查读取失败：' + (stderr || `FFprobe exit ${code}`));
        return Buffer.concat(chunks).toString('utf8');
    }
}
async function quickVerify(file, expectedFrames, { ffprobe, governor, onProgress = () => {} }) {
    const started = Date.now(), before = fs.statSync(file);
    onProgress('核对音视频轨道与时长');
    const metadata = JSON.parse(await probe(ffprobe, ['-show_entries',
        'stream=codec_type,codec_name,width,height,r_frame_rate,start_time,duration,nb_frames,sample_rate,channels:format=duration,size', '-of', 'json', file], governor));
    const result = validateMetadata(metadata, expectedFrames);
    if (Number(metadata.format.size) !== before.size) throw new Error('成片快速检查未通过：文件大小不一致');
    onProgress('扫描视频包与逐帧时间戳（不解码画面）');
    const packets = await probe(ffprobe, ['-select_streams', 'v:0', '-show_packets', '-show_entries',
        'packet=pts_time,dts_time,duration_time,pos,size', '-of', 'compact=p=0:nk=0', file], governor);
    const count = validatePackets(packets, expectedFrames, before.size), after = fs.statSync(file);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('成片快速检查期间文件发生变化');
    return { ...result, packetCount: count, bytes: before.size, quickSeconds: (Date.now() - started) / 1000,
        passed: true, scope: 'Container, track specifications/durations, every video packet count/timestamp/file range; no full decode or semantic A/V review.' };
}
module.exports = { VERIFICATION_MODES, VerificationPolicy, validateVerificationMode, validateMetadata, validatePackets, quickVerify };
