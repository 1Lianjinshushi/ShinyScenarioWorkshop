'use strict';

// Deliberately separate from production and from the disabled real-time exporters.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const os = require('node:os');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const { limits, acquireLock, Governor } = require('./governor.cjs');
const { Preflight, hashFile } = require('./preflight.cjs');
const { profile, audioMemoryBytes } = require('./profile.cjs');
const { addMedia } = require('./audio-merge.cjs');
const { cleanup } = require('./cleanup.cjs');
const { exportLanguage } = require('./language.cjs');
const root = path.resolve(__dirname, '../..');
const input = process.argv[2] || '4902005026';
const inputFile = /^\d+$/.test(input) ? null : path.resolve(input);
const eventId = inputFile ? path.basename(inputFile).replace(/(?:\.zh-cn)?\.json$/i, '') : input;
if (!/^\d+$/.test(eventId)) throw new Error('Expected a numeric scenario ID or a local <ID>.json file');
const mode = process.argv[3] || 'offline';
if (!['all', 'offline', 'branch-preview', 'verify-branches', 'reference', 'determinism', 'prepare', 'preflight', 'mix'].includes(mode))
    throw new Error(`Unsupported proof mode: ${mode}`);
const runProfile = profile(mode);
const options = { trimEnd: true, branchPreview: mode === 'branch-preview' || process.env.SSV_BRANCH_PREVIEW === '1',
    diagnostics: runProfile.diagnostics, language: exportLanguage(process.env.SSV_PROOF_LANGUAGE, inputFile) };
const maxSeconds = 20 * 60;
const policy = limits();
const wallFps = policy.fps;
const baseOutput = path.join(root, 'exports', 'offline-proof', eventId);
const runTag = process.env.SSV_PROOF_RUN_TAG || '';
if (runTag && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(runTag)) throw new Error('Invalid proof run tag');
const jobId = process.env.SSV_PROOF_JOB_ID || '';
if (jobId && !/^[a-f0-9]{32}$/.test(jobId)) throw new Error('Invalid managed job ID');
const output = jobId ? path.join(root, 'exports/offline-jobs', jobId) : runTag ? path.join(baseOutput, runTag) : baseOutput;
fs.mkdirSync(output, { recursive: true });
const log = (...values) => console.log(new Date().toISOString(), ...values);
const governor = new Governor(policy, log);
governor.diskPath = output;
const ffmpeg = process.env.SSV_FFMPEG || 'D:/ffmpeg/bin/ffmpeg.exe';
const ffprobe = process.env.SSV_FFPROBE || 'D:/ffmpeg/bin/ffprobe.exe';
const chromium = process.env.SSV_CHROMIUM || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(binary => fs.existsSync(binary)) || '';
const playwright = require(process.env.SSV_PLAYWRIGHT || path.join(os.homedir(),
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2));
let lastProgress = 0, lastPhase = '', lastDetail = {};
const progress = (stage, detail = {}, force = false) => {
    lastDetail = stage === lastPhase ? { ...lastDetail, ...detail } : detail;
    lastPhase = stage;
    if (!force && Date.now() - lastProgress < 500) return;
    lastProgress = Date.now();
    if (process.send && process.connected) process.send({ type: 'progress', stage, ...lastDetail });
};
governor.onDecision = decision => {
    if (lastPhase) progress(lastPhase, { pressure: decision.reason }, decision.action === 'pause');
};
governor.onMemoryPause = detail => {
    if (process.send && process.connected) process.send({ type: 'memory-pause', ...detail });
};
governor.onMemoryResumeResult = detail => {
    if (process.send && process.connected) process.send({ type: 'memory-resume-result', ...detail });
};
function checked(base, relative) {
    const resolved = path.resolve(base, relative);
    if (!resolved.startsWith(path.resolve(base) + path.sep)) throw new Error('Path outside test directory');
    return resolved;
}
function resourcePath(url) {
    if (!url.startsWith('./assets/')) throw new Error(`Unapproved resource: ${url}`);
    return url.slice(2);
}
function localAsset(relative) {
    const cached = checked(path.join(output, 'cache'), relative);
    if (fs.existsSync(cached)) return cached;
    const previous = checked(path.join(baseOutput, 'cache'), relative);
    return fs.existsSync(previous) ? previous : checked(root, relative);
}
async function download(url) {
    if (process.env.SSV_PROOF_OFFLINE === '1') throw new Error(`Offline preflight: not cached (${url})`);
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
            if (!r.ok) {
                const error = new Error(`HTTP ${r.status}: ${url}`);
                error.permanent = r.status >= 400 && r.status < 500 && r.status !== 429;
                await r.body?.cancel(); throw error;
            }
            const cap = 128 * 1024 * 1024;
            if (Number(r.headers.get('content-length')) > cap) { await r.body.cancel(); throw new Error('Download exceeds 128 MiB budget'); }
            const chunks = []; let bytes = 0;
            for await (const chunk of r.body) {
                bytes += chunk.length;
                if (bytes > cap) throw new Error('Download exceeds 128 MiB budget');
                chunks.push(chunk);
            }
            return Buffer.concat(chunks);
        } catch (e) { last = e; if (e.permanent) break; }
    }
    throw last;
}
async function acquireAsset(relative) {
    let file, source;
    const asset = relative.replace(/^assets\//, '');
    const candidates = ['https://service.sc-viewer.top/custom/' + asset];
    // Same verified community fallback used by serve-viewer.py. Never infer
    // a card identity from its ordinal: request exactly the JSON's media ID.
    if (/^(?:movies\/idols\/card\/|images\/content\/(?:idols|support_idols)\/card\/)/.test(asset)) {
        candidates.push('https://cf-static.shinycolors.moe/' + asset);
    }
    let bytes, failure;
    for (const candidate of candidates) {
        try {
            bytes = await download(candidate);
            if (bytes.subarray(0, 40).toString().match(/<!doctype|<html/i)) throw new Error(`Not an asset: ${candidate}`);
            if (asset.endsWith('.mp4') && bytes.subarray(4, 8).toString() !== 'ftyp') throw new Error(`Invalid MP4: ${candidate}`);
            source = candidate;
            break;
        } catch (error) { failure = error; bytes = null; }
    }
    if (!bytes) throw new Error(`Required asset missing (${relative}): ${failure?.message}`);
    file = checked(path.join(output, 'cache'), relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    log('Acquired', relative, bytes.length);
    return { file, source };
}
const preflight = new Preflight({ resolve: localAsset, acquire: acquireAsset,
    checkpoint: () => { progress('preflight', { resources: inventory.size }); return governor.checkpoint('preflight'); } });
const inventory = preflight.inventory;
function lowPriority(process) {
    try { os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (_) {}
    return process;
}
async function ff(args) {
    for (;;) {
        await governor.checkpoint('ffmpeg', true);
        const process = lowPriority(cp.spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1', '-filter_threads', '1', ...args],
            { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }));
        governor.children.add(process.pid);
        let error = '';
        process.stderr.on('data', d => error = (error + d).slice(-16384));
        let monitorFailure, checking = false, checkPromise;
        const monitor = setInterval(() => {
            if (checking) return;
            checking = true;
            checkPromise = (async () => {
                try {
                    // FFmpeg has no virtual clock. Stop the current command at
                    // this restartable boundary, wait for manual safety review,
                    // then run it again from its inputs (all outputs use -y).
                    await governor.sample();
                    if (governor.cancelled) throw new Error('Export cancelled');
                    if (governor.current.action !== 'run') {
                        monitorFailure = { action: governor.current.action, reason: governor.current.reason };
                        process.kill();
                    }
                } catch (e) { monitorFailure = { action: 'abort', error: e }; process.kill(); }
                finally { checking = false; }
            })();
        }, policy.sampleMs);
        let code;
        try { [code] = await once(process, 'close'); }
        finally { clearInterval(monitor); await checkPromise; governor.children.delete(process.pid); }
        if (monitorFailure?.action === 'pause') {
            await governor.pauseForMemory('ffmpeg', monitorFailure.reason);
            continue;
        }
        if (monitorFailure?.action === 'abort') throw monitorFailure.error || new Error(
            monitorFailure.reason === 'disk-space' ? '导出磁盘剩余空间不足 512 MiB，已停止写入。'
                : `FFmpeg stopped by safety governor: ${monitorFailure.reason}`);
        if (code) throw new Error(`FFmpeg exited ${code}: ${error}`);
        return;
    }
}
async function writeStream(stream, bytes) {
    if (!stream.write(bytes)) await once(stream, 'drain');
}
async function prepareMovies(resources) {
    const movies = {};
    for (const url of [...new Set(resources.map(r => r[1]).filter(url => url.endsWith('.mp4')))]) {
        const file = localAsset(resourcePath(url));
        const probe = JSON.parse(cp.execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8', windowsHide: true, timeout: 15000 }));
        const video = probe.streams.find(s => s.codec_type === 'video');
        if (!video || !video.width || !video.height || video.width * video.height > 1920 * 1080
            || !Number.isFinite(Number(probe.format.duration)) || Number(probe.format.duration) <= 0) throw new Error('Unsupported movie dimensions/duration');
        const frameInfo = JSON.parse(cp.execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_frames',
            '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', file], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 }));
        const timestamps = frameInfo.frames.map(f => Number(f.best_effort_timestamp_time));
        if (!timestamps.length || timestamps.some((t, i) => !Number.isFinite(t) || t < 0 || (i && t < timestamps[i - 1]))) throw new Error('Invalid movie timestamps');
        const key = (await hashFile(file)).slice(0, 16);
        const dir = path.join(output, 'movie-frames', key);
        fs.mkdirSync(dir, { recursive: true });
        const marker = path.join(dir, 'complete.json');
        let completed;
        try { completed = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch (_) {}
        if (completed?.frames !== timestamps.length || completed?.sourceSha256 !== key) {
            const required = BigInt(Math.ceil(video.width * video.height * 4 * timestamps.length + 512 * 1024 * 1024));
            const disk = fs.statfsSync(output, { bigint: true });
            if (disk.bavail * disk.bsize < required) throw new Error(`动态卡图解码磁盘空间不足：${url}`);
            log('Preparing bounded-memory movie frames', url, timestamps.length);
            await ff(['-xerror', '-threads', '1', '-i', file, '-map', '0:v:0', '-an', '-fps_mode', 'passthrough',
                '-c:v', 'png', '-threads', '1', '-compression_level', '2', '-start_number', '0', '-y', path.join(dir, '%06d.png')]);
            fs.writeFileSync(marker, JSON.stringify({ frames: timestamps.length, sourceSha256: key }));
        }
        for (let i = 0; i < timestamps.length; i++) {
            if (!fs.existsSync(path.join(dir, `${String(i).padStart(6, '0')}.png`))) throw new Error(`Missing decoded movie frame ${i}`);
        }
        // Check cached frame integrity too, before any output frame is encoded.
        await ff(['-xerror', '-threads', '1', '-framerate', '30', '-start_number', '0', '-i', path.join(dir, '%06d.png'),
            '-frames:v', String(timestamps.length), '-f', 'null', '-']);
        movies[url] = { key, timestamps, duration: Number(probe.format.duration), width: video.width, height: video.height,
            hasAudio: probe.streams.some(s => s.codec_type === 'audio'), source: file };
    }
    json('movie-metadata.json', movies);
    return movies;
}
async function mixAudio(report, metadata, totalFrames, bus = 'pixi') {
    const frames = Math.round(totalFrames / 60 * 48000);
    const startFrame = report.captureStartFrame || 0;
    const destination = fs.createWriteStream(path.join(output, bus === 'media' ? 'media-mix.f32' : 'mix.f32'));
    const sounds = report.sounds.filter(s => (s.bus || 'pixi') === bus).map(s => ({ ...s, fd: fs.openSync(metadata[s.url].pcm, 'r'),
        samples: metadata[s.url].samples, gains: s.gains, cursor: 0 }));
    try {
        for (let base = 0; base < frames; base += 48000) {
            await governor.checkpoint('audio-mixing');
            const count = Math.min(48000, frames - base);
            progress('audio', { audioPart: '混合剧情声音', completed: (bus === 'media' ? frames : 0) + base,
                total: frames * 2 });
            const sum = new Float32Array(count * 2);
            for (const sound of sounds) {
                const soundStart = Math.round(sound.start * 48000) - startFrame * 800;
                const from = Math.max(base, soundStart);
                const stop = sound.stop == null ? frames : Math.round(sound.stop * 48000) - startFrame * 800;
                const until = Math.min(base + count, stop);
                if (from >= until) continue;
                let position = from;
                while (position < until) {
                    const offset = position - soundStart;
                    if (!sound.loop && offset >= sound.samples) break;
                    const sourceOffset = offset % sound.samples;
                    const take = Math.min(until - position, sound.samples - sourceOffset);
                    const bytes = Buffer.alloc(take * 8);
                    const read = fs.readSync(sound.fd, bytes, 0, bytes.length, sourceOffset * 8);
                    if (read !== bytes.length) throw new Error('Truncated PCM asset');
                    for (let i = 0; i < take; i++) {
                        const t = (position + i + startFrame * 800) / 48000;
                        while (sound.cursor + 1 < sound.gains.length && sound.gains[sound.cursor + 1][0] <= t) sound.cursor++;
                        const a = sound.gains[sound.cursor];
                        const b = sound.gains[sound.cursor + 1];
                        const gain = (!b || b[0] === a[0] ? a[1] : a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]))
                            * (bus === 'media' ? 1 : report.masterVolume);
                        const out = (position + i - base) * 2;
                        sum[out] += bytes.readFloatLE(i * 8) * gain;
                        sum[out + 1] += bytes.readFloatLE(i * 8 + 4) * gain;
                    }
                    position += take;
                }
            }
            await writeStream(destination, Buffer.from(sum.buffer));
        }
        destination.end();
        await once(destination, 'finish');
        progress('audio', { audioPart: '混合剧情声音', completed: (bus === 'media' ? 2 : 1) * frames,
            total: frames * 2 }, true);
    } finally { sounds.forEach(s => fs.closeSync(s.fd)); }
}
async function masterAudio(page, frames, parameters) {
    progress('audio', { audioPart: '连续压缩器处理', completed: null, total: null }, true);
    await governor.allocation(audioMemoryBytes(frames), 'audio-mastering');
    const result = await page.evaluate(({ frames, parameters }) => audioMaster.render(frames, parameters), { frames, parameters });
    const destination = path.join(output, 'mastered.f32');
    const fd = fs.openSync(destination, 'w');
    let media;
    try {
        media = fs.openSync(path.join(output, 'media-mix.f32'), 'r');
        for (let start = 0; start < frames; start += 48000) {
            await governor.checkpoint('audio-transfer');
            progress('audio', { audioPart: '输出混音', completed: start, total: frames });
            const chunk = Buffer.from(await page.evaluate(start => audioMaster.chunk(start), start), 'base64');
            const mediaChunk = Buffer.alloc(chunk.length);
            if (fs.readSync(media, mediaChunk, 0, mediaChunk.length, start * 8) !== mediaChunk.length) throw new Error('Truncated media mix');
            fs.writeSync(fd, addMedia(chunk, mediaChunk));
        }
        progress('audio', { audioPart: '输出混音', completed: frames, total: frames }, true);
    } finally { fs.closeSync(fd); if (media != null) fs.closeSync(media); }
    await page.evaluate(() => audioMaster.buffer = null);
    json('audio-mastering.json', { ...result, source: 'Captured PIXI compressor parameters -> continuous audio-only OfflineAudioContext; media Float32 sum outside compressor',
        estimatedAllocationBytes: audioMemoryBytes(frames), visualBrowserClosed: true,
        output: destination, bytes: fs.statSync(destination).size });
    return destination;
}

(async () => {
    let browser, page, session, server, encoder, elementary, unlock, succeeded = false;
    const cancel = () => { governor.cancel(); };
    const control = message => {
        if (message?.type === 'cancel') cancel();
        if (message?.type === 'memory-resume') governor.requestMemoryResume(message.requestId);
        if (message?.type === 'memory-settings' && /^[a-f0-9]{32}$/.test(message.token || '')) {
            try {
                const settings = governor.updateMemoryPolicy(message.settings);
                if (process.connected) process.send({ type: 'memory-settings-ack', token: message.token, settings });
            } catch (error) {
                if (process.connected) process.send({ type: 'memory-settings-rejected', token: message.token, error: error.message });
            }
        }
    };
    try {
        unlock = acquireLock(path.join(root, 'exports', '.offline-export.lock'));
        process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
        process.on('message', control); process.on('disconnect', cancel);
        progress('preflight', {}, true);
        await governor.checkpoint('startup', true);
        const sourceUrl = inputFile ? null : `https://service.sc-viewer.top/custom/json/special_communications/${eventId}.json`;
        const sourceFile = path.join(output, 'source.json');
        const localSource = inputFile || [sourceFile, path.join(baseOutput, 'source.json')].find(f => fs.existsSync(f));
        const sourceBytes = localSource ? fs.readFileSync(localSource) : await download(sourceUrl);
        const raw = JSON.parse(sourceBytes.toString('utf8').replace(/^\uFEFF/, ''));
        if (!Array.isArray(raw) || !raw.length) throw new Error('Invalid scenario response');
        fs.writeFileSync(sourceFile, sourceBytes);
        json('source-manifest.json', { eventId, sourceUrl, sourcePath: localSource || null, sha256: sha(sourceBytes), nodes: raw.length });
        const scripts = [...fs.readFileSync(path.join(root, 'index.html'), 'utf8')
            .matchAll(/<script src="([^\"]+)"/g)].map(m => m[1]).filter(src => !src.endsWith('/RuntimeDiagnostics.js'));
        for (const src of [...scripts, './fonts/FOT-HummingPro-B.OTF', './fonts/FZFWQINGYINTIJWB.TTF',
            './experiments/offline-export/clock.js', './experiments/offline-export/flow.js',
            './experiments/offline-export/movies.js', './experiments/offline-export/page.js', './experiments/offline-export/audio-master.js']) {
            await preflight.stage(src, 'runtime-file', async () => {
                const file = checked(root, src);
                if (!fs.existsSync(file) || !fs.statSync(file).isFile() || !fs.statSync(file).size) throw new Error('启动必需文件缺失或为空');
            });
        }
        for (const binary of [ffmpeg, ffprobe, chromium])
            await preflight.stage(binary, 'runtime-tool', async () => { if (!fs.existsSync(binary)) throw new Error('Required executable missing'); });
        json('preflight-report.json', preflight.report()); preflight.assert();
        const html = '<!doctype html><html><head><base href="/"><style>html,body{margin:0;background:black;overflow:hidden}</style>'
            + '<script src="/experiments/offline-export/clock.js"></script>'
            + scripts.map(src => `<script src="${src}"></script>`).join('')
            + '<script src="/experiments/offline-export/flow.js"></script><script src="/experiments/offline-export/movies.js"></script>'
            + '<script src="/experiments/offline-export/page.js"></script></head><body></body></html>';
        server = http.createServer((req, res) => {
            try {
                const requestUrl = new URL(req.url, 'http://localhost');
                const target = decodeURIComponent(requestUrl.pathname).replace(/^\//, '');
                if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; return res.end(); }
                if (target === 'proof-mix') {
                    const start = Number(requestUrl.searchParams.get('start'));
                    const file = path.join(output, requestUrl.searchParams.get('bus') === 'media' ? 'media-mix.f32' : 'mix.f32');
                    const bytes = fs.statSync(file).size;
                    if (!Number.isSafeInteger(start) || start < 0 || start * 8 >= bytes) throw new Error('Invalid PCM offset');
                    const end = Math.min(bytes - 1, (start + 48000) * 8 - 1);
                    res.setHeader('Content-Type', 'application/octet-stream');
                    res.setHeader('Content-Length', end - start * 8 + 1);
                    return fs.createReadStream(file, { start: start * 8, end }).pipe(res);
                }
                if (target === 'proof') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html); }
                if (target === 'audio-proof') {
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    return res.end('<!doctype html><script src="/experiments/offline-export/audio-master.js"></script>');
                }
                if (target.startsWith('proof-movie/')) {
                    const match = /^proof-movie\/([a-f0-9]{16})\/(\d+)$/.exec(target);
                    if (!match) throw new Error('Invalid movie-frame URL');
                    const file = checked(path.join(output, 'movie-frames'), `${match[1]}/${String(Number(match[2])).padStart(6, '0')}.png`);
                    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
                    res.setHeader('Content-Type', 'image/png');
                    res.setHeader('Cache-Control', 'no-store');
                    return fs.createReadStream(file).pipe(res);
                }
                const file = target.startsWith('assets/') ? localAsset(target) : checked(root, target);
                if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; return res.end(); }
                const types = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
                    '.jpg': 'image/jpeg', '.m4a': 'audio/mp4', '.otf': 'font/otf', '.ttf': 'font/ttf' };
                res.setHeader('Content-Type', types[path.extname(file).toLowerCase()] || 'application/octet-stream');
                res.setHeader('Content-Length', fs.statSync(file).size);
                if (req.method === 'HEAD') return res.end();
                fs.createReadStream(file).pipe(res);
            } catch (e) { res.statusCode = 400; res.end(e.message); }
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        const errors = [];
        async function openBrowserPage(pageUrl) {
        browser = await playwright.chromium.launch({
            executablePath: chromium,
            headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-extensions',
                '--disable-background-networking', '--disable-component-update'],
        });
        session = await browser.newBrowserCDPSession();
        governor.session = session;
        const processList = await session.send('SystemInfo.getProcessInfo');
        processList.processInfo.forEach(p => { try { os.setPriority(p.id, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (_) {} });
        page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
        // Rendering must never silently fall back to a remote resource mid-job.
        await page.route('**/*', route => {
            const url = route.request().url();
            return url.startsWith(base + '/') || url.startsWith('data:') || url.startsWith('blob:')
                ? route.continue() : route.abort('blockedbyclient');
        });
        page.on('pageerror', e => { errors.push(e.message); log('PAGE ERROR', e.message); });
        page.on('console', m => { if (['warning', 'error'].includes(m.type()) || m.text().startsWith('[proof]')) log(m.type(), m.text()); });
        await page.goto(base + pageUrl);
        }
        async function closeVisualBrowser() {
            const parameters = await page.evaluate(() => proof.audioMasterParameters());
            await page.evaluate(() => proof.releaseVisuals());
            await governor.checkpoint('before-visual-release', true);
            governor.session = null;
            await browser.close(); browser = null; page = null;
            await governor.checkpoint('after-visual-release', true);
            json('audio-parameters.json', parameters);
            log('Visual browser released before mixing/mastering');
            return parameters;
        }
        await openBrowserPage('/proof?clock=offline');
        const resources = await page.evaluate(({ raw, options }) => proof.describe(raw, options), { raw, options });
        for (const [, url] of resources) await preflight.ensure(resourcePath(url));
        json('resource-manifest.json', Object.fromEntries(inventory));
        await preflight.stage('fonts', 'font-decode', () => page.evaluate(async () => {
            for (const [name, url] of [['proof-jp', './fonts/FOT-HummingPro-B.OTF'], ['proof-zh', './fonts/FZFWQINGYINTIJWB.TTF']])
                await new FontFace(name, `url("${url}")`).load();
        }));
        let textureBytes = 0;
        for (const [relative] of inventory) {
            if (/\.(png|jpe?g|webp)$/i.test(relative)) {
                const pixels = await preflight.stage(relative, 'image-decode', () => page.evaluate(async url => {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const bitmap = await createImageBitmap(await response.blob());
                try {
                    if (!bitmap.width || bitmap.width * bitmap.height > 16777216) throw new Error('Unsupported image size');
                    return bitmap.width * bitmap.height;
                }
                finally { bitmap.close(); }
                }, './' + relative));
                textureBytes += (pixels || 0) * 8;
            }
        }
        const movieMetadata = {};
        for (const entry of resources.filter(([, url]) => url.endsWith('.mp4'))) {
            if (!inventory.has(resourcePath(entry[1]))) continue;
            const prepared = await preflight.stage(entry[1], 'movie-decode', () => prepareMovies([entry]));
            if (prepared) Object.assign(movieMetadata, prepared);
        }
        json('movie-metadata.json', movieMetadata);
        const audioMetadata = {};
        for (const [, url] of resources.filter(([, url]) => url.endsWith('.m4a') || movieMetadata[url]?.hasAudio)) {
            if (audioMetadata[url]) continue;
            if (!inventory.has(resourcePath(url))) continue;
            await preflight.stage(url, 'audio-decode', async () => {
            const sourceHash = inventory.get(resourcePath(url)).sha256;
            const pcm = path.join(output, 'audio', sha(Buffer.from(url)).slice(0, 16) + '.browser.f32');
            const completion = pcm + '.json';
            fs.mkdirSync(path.dirname(pcm), { recursive: true });
            let cached;
            try { cached = JSON.parse(fs.readFileSync(completion, 'utf8')); } catch (_) {}
            if (!cached || !Number.isSafeInteger(cached.samples) || cached.samples <= 0 || cached.sourceHash !== sourceHash
                || !fs.existsSync(pcm) || fs.statSync(pcm).size !== cached.samples * 8) {
                const probe = JSON.parse(cp.execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,channels',
                    '-of', 'json', localAsset(resourcePath(url))], { encoding: 'utf8', windowsHide: true, timeout: 15000 }));
                const audio = probe.streams.find(s => s.codec_type === 'audio');
                const seconds = Number(probe.format.duration);
                if (!audio || !Number.isFinite(seconds) || seconds <= 0 || seconds * 48000 * 8 > 256 * 1024 * 1024)
                    throw new Error('Audio missing, invalid or too long');
                await governor.allocation(seconds * 48000 * Math.max(2, audio.channels) * 4 * 3 + 32 * 1024 * 1024, 'audio-decode');
                let metadata;
                const partial = pcm + '.partial';
                const fd = fs.openSync(partial, 'w');
                try {
                    metadata = await page.evaluate(url => proof.decodeAudio(url), url);
                    if (metadata.samples * 8 > 256 * 1024 * 1024) throw new Error('Audio too large for this proof decoder');
                    for (let start = 0; start < metadata.samples; start += 48000) {
                        await governor.checkpoint('audio-decode');
                        const chunk = await page.evaluate(start => proof.audioChunk(start), start);
                        fs.writeSync(fd, Buffer.from(chunk, 'base64'));
                    }
                } finally { fs.closeSync(fd); await page.evaluate(() => { proof.decodedAudio = null; }); }
                if (fs.statSync(partial).size !== metadata.samples * 8) throw new Error('Incomplete decoded PCM');
                fs.renameSync(partial, pcm);
                fs.writeFileSync(completion, JSON.stringify({ sourceHash, samples: metadata.samples }));
                log('Browser decoded', url, metadata.duration);
            }
            const samples = fs.statSync(pcm).size / 8;
            audioMetadata[url] = { duration: samples / 48000, samples, pcm };
            });
        }
        json('audio-metadata.json', audioMetadata);
        await preflight.stage('H.264 1080p60', 'encoder-support', () => page.evaluate(() => proof.checkEncoder()));
        preflight.finished = true;
        json('preflight-report.json', preflight.report()); preflight.assert();
        log('PREFLIGHT PASSED', inventory.size, 'resources; local-only rendering');
        if (mode === 'prepare' || mode === 'preflight') { log('PREPARED', output); return; }
        const heap = await page.context().newCDPSession(page);
        try { await heap.send('HeapProfiler.collectGarbage'); } finally { await heap.detach(); }
        await governor.allocation(textureBytes + 256 * 1024 * 1024, 'renderer-preparation');
        if (mode === 'verify-branches') {
            await page.evaluate(({ audioMetadata, movieMetadata }) => proof.prepare(audioMetadata, movieMetadata), { audioMetadata, movieMetadata });
            await page.evaluate(() => proof.start());
            for (let frame = 0; frame < 60 * maxSeconds; frame++) {
                const tick = Date.now(); await governor.checkpoint('branch-verification');
                const state = await page.evaluate(frame => proof.step(frame, false), frame);
                if (state.done) break;
                await governor.pace(tick);
            }
            const report = await page.evaluate(() => proof.report());
            const clicks = report.events.filter(e => e.kind === 'choice-click');
            const returns = report.events.filter(e => e.kind === 'transition-end');
            const valid = report.endedAt != null && clicks.map(e => e.position).join(',') === 'middle,left,right'
                && clicks.every(e => Math.abs(e.wait - 3) < 1e-6) && returns.length === 2 && returns.every(e => e.auto);
            json('branch-cycle-check.json', { valid, encoded: false, clicks, returns, report });
            if (!valid) throw new Error('Full branch cycle validation failed');
            await page.evaluate(() => {
                proof.releaseVisuals();
                if (!PIXI.sound.context.compressor) throw new Error('Audio master was released with visual assets');
            });
            log('ALL THREE BRANCHES VERIFIED, no full video generated');
        }
        if (mode === 'all' || mode === 'offline' || mode === 'branch-preview') {
            const renderer = await page.evaluate(({ audioMetadata, movieMetadata }) => proof.prepare(audioMetadata, movieMetadata), { audioMetadata, movieMetadata });
            log('Renderer ready', renderer);
            const gpu = await session.send('SystemInfo.getInfo');
            json('renderer-info.json', { renderer, gpu: gpu.gpu, headless: true });
            const videoPath = path.join(output, 'picture.mp4');
            const codec = await page.evaluate(() => proof.prepareEncoder());
            json('encoder-config.json', codec);
            log('Encoder configured', codec);
            elementary = fs.createWriteStream(path.join(output, 'picture.h264'));
            elementary.on('error', error => log('Video output error', error.message));
            await page.evaluate(() => proof.start());
            const started = performance.now();
            const frameTiming = { checkpointMs: 0, renderEncodeMs: 0, transportMs: 0, pacingMs: 0 };
            const hashes = {};
            let count = 0;
            let beforeStall = null;
            let afterStall = null;
            let firstFrame = 0, prepared = null;
            if (options.branchPreview && !runProfile.diagnostics && process.env.SSV_PROOF_FAST_PREROLL !== '0') {
                while (firstFrame < 60 * maxSeconds) {
                    await governor.checkpoint('preroll');
                    const begin = Date.now();
                    const result = await page.evaluate(frame => proof.advancePreroll(frame, 6), firstFrame);
                    progress('preroll', { simulatedSeconds: result.frame / 60, track: result.index,
                        pressure: governor.current.reason });
                    if (result.done) throw new Error('Story ended before preview start');
                    if (result.captureStartFrame != null) { firstFrame = result.frame; prepared = result; break; }
                    firstFrame = result.frame + 1;
                    await governor.pacePreroll(begin, result.steps);
                }
            }
            for (let frame = firstFrame; frame < 60 * maxSeconds; frame++) {
                const checkpointStart = performance.now();
                await governor.checkpoint('render');
                frameTiming.checkpointMs += performance.now() - checkpointStart;
                if (frame === runProfile.stallFrame) {
                    beforeStall = await page.evaluate(() => proof.state());
                    await new Promise(r => setTimeout(r, 1800));
                    afterStall = await page.evaluate(() => proof.state());
                }
                // Measurement/pressure waits already yield the CPU. Do not
                // charge them a second time as GPU rendering duty.
                const begin = Date.now();
                const capture = runProfile.sampleFrame(frame);
                const renderStart = performance.now();
                const result = await page.evaluate(async ({ frame, capture, count, prepared }) => {
                    const state = prepared || await proof.step(frame, capture);
                    if (prepared && capture) state.png = proof.app.view.toDataURL('image/png').split(',')[1];
                    if (!state.done && state.captureStartFrame != null) state.packet = await proof.encodeFrame(count);
                    return state;
                }, { frame, capture, count, prepared });
                frameTiming.renderEncodeMs += performance.now() - renderStart;
                prepared = null;
                const transportStart = performance.now();
                if (result.packet) {
                    if (result.packet.timestamp !== Math.round(count * 1000000 / 60)) throw new Error('Encoded timestamp mismatch');
                    await writeStream(elementary, Buffer.from(result.packet.data, 'base64'));
                    count++;
                }
                if (capture && result.packet) {
                    const bytes = Buffer.from(result.png, 'base64');
                    hashes[frame] = sha(bytes);
                    fs.writeFileSync(path.join(output, `frame-${String(frame).padStart(4, '0')}.png`), bytes);
                }
                frameTiming.transportMs += performance.now() - transportStart;
                if (frame % 300 === 0) log('Rendered', frame, 'video seconds', frame / 60,
                    'wall seconds', ((performance.now() - started) / 1000).toFixed(1));
                progress('render', { encodedFrames: count, videoSeconds: count / 60,
                    storyCompleted: result.storyCompleted, storyTotal: result.storyTotal,
                    pressure: governor.current.reason });
                if (result.done) break;
                // Bounded queue (one frame) and a configurable conservative wall-clock cap.
                const pacingStart = performance.now();
                await governor.pace(begin);
                frameTiming.pacingMs += performance.now() - pacingStart;
            }
            const report = await page.evaluate(() => proof.report());
            if (report.endedAt == null) throw new Error('Scenario failed to reach End');
            report.wallSeconds = (performance.now() - started) / 1000;
            report.frameTiming = frameTiming;
            report.encodedFrames = count;
            report.frameTransport = 'WebCodecs H.264 Annex B, one acknowledged frame, no desktop capture';
            report.encoder = codec;
            report.wallFpsCap = wallFps;
            report.diagnostics = runProfile.diagnostics;
            const encodedCount = await page.evaluate(() => proof.finishEncoder());
            if (encodedCount !== count) throw new Error('Encoder frame count mismatch');
            report.hashes = hashes;
            report.stall = runProfile.diagnostics ? { before: beforeStall, after: afterStall,
                unchanged: JSON.stringify(beforeStall) === JSON.stringify(afterStall) } : null;
            json('offline-report.json', report);
            elementary.end();
            await once(elementary, 'finish');
            const parameters = await closeVisualBrowser();
            progress('audio', {}, true);
            await ff(['-r', '60', '-f', 'h264', '-i', path.join(output, 'picture.h264'),
                '-an', '-c:v', 'copy', '-video_track_timescale', '60000', '-y', videoPath]);
            await mixAudio(report, audioMetadata, count);
            await mixAudio(report, audioMetadata, count, 'media');
            await openBrowserPage('/audio-proof');
            const mastered = await masterAudio(page, count * 800, parameters);
            progress('mux', {}, true);
            const finalVideo = path.join(output, `${eventId}.offline.mp4`);
            const partialVideo = path.join(output, `${eventId}.offline.partial.mp4`);
            await ff(['-i', videoPath, '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', mastered,
                '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k',
                '-movflags', '+faststart', '-shortest', '-y', partialVideo]);
            progress('verify', { outputPath: finalVideo, encodedFrames: count }, true);
            await ff(['-xerror', '-i', partialVideo, '-f', 'null', '-']);
            fs.renameSync(partialVideo, finalVideo);
            log('OFFLINE SAMPLE COMPLETE', count, 'frames', report.wallSeconds.toFixed(1), 'seconds wall time');
        }
        if (mode === 'mix') {
            const report = JSON.parse(fs.readFileSync(path.join(output, 'offline-report.json'), 'utf8'));
            if (!fs.existsSync(path.join(output, 'media-mix.f32'))) await mixAudio(report, audioMetadata, report.encodedFrames, 'media');
            const parameters = await closeVisualBrowser();
            await openBrowserPage('/audio-proof');
            const mastered = await masterAudio(page, report.encodedFrames * 800, parameters);
            const partialVideo = path.join(output, `${eventId}.offline.partial.mp4`);
            await ff(['-i', path.join(output, 'picture.mp4'), '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', mastered,
                '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k',
                '-movflags', '+faststart', '-shortest', '-y', partialVideo]);
            fs.renameSync(partialVideo, path.join(output, `${eventId}.offline.mp4`));
            log('AUDIO MASTERING COMPLETE');
        }
        if (mode === 'all' || mode === 'reference') {
            await page.goto(base + '/proof?clock=realtime');
            await page.evaluate(({ raw, options }) => proof.describe(raw, options), { raw, options });
            await page.evaluate(({ audioMetadata, movieMetadata }) => proof.prepare(audioMetadata, movieMetadata), { audioMetadata, movieMetadata });
            await page.evaluate(() => proof.start());
            for (let i = 0; i < maxSeconds; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const state = await page.evaluate(() => proof.state());
                if (state.endedAt != null && state.time >= state.endedAt + 2) break;
            }
            const reference = await page.evaluate(() => proof.report());
            if (reference.endedAt == null) throw new Error('Real-time reference failed to reach End');
            json('realtime-reference.json', reference);
            log('REALTIME REFERENCE COMPLETE', reference.endedAt);
        }
        if (mode === 'all' || mode === 'determinism') {
            const previous = JSON.parse(fs.readFileSync(path.join(output, 'offline-report.json'), 'utf8'));
            if (!Object.keys(previous.hashes || {}).length) throw new Error('No diagnostic frames: rerun with mode all or SSV_PROOF_DIAGNOSTICS=1');
            await page.goto(base + '/proof?clock=offline');
            await page.evaluate(({ raw, options }) => proof.describe(raw, options), { raw, options });
            await page.evaluate(({ audioMetadata, movieMetadata }) => proof.prepare(audioMetadata, movieMetadata), { audioMetadata, movieMetadata });
            await page.evaluate(() => proof.start());
            const comparisons = [];
            for (let frame = 0; frame <= previous.frame; frame++) {
                const tick = Date.now(); await governor.checkpoint('determinism');
                const capture = Object.hasOwn(previous.hashes, frame);
                const result = await page.evaluate(({ frame, capture }) => proof.step(frame, capture), { frame, capture });
                if (capture) comparisons.push({ frame, identical: sha(Buffer.from(result.png, 'base64')) === previous.hashes[frame] });
                // Second render deliberately follows a different wall-clock cadence.
                if (frame % 20 === 0) await new Promise(r => setTimeout(r, 15));
                await governor.pace(tick);
            }
            const repeat = await page.evaluate(() => proof.report());
            json('determinism-report.json', { comparisons,
                identicalTimeline: JSON.stringify(repeat.events) === JSON.stringify(previous.events),
                repeatEnd: repeat.endedAt, originalEnd: previous.endedAt, movies: repeat.movies, errors });
            log('DETERMINISM', comparisons);
            if (JSON.stringify(repeat.events) !== JSON.stringify(previous.events) || comparisons.some(c => !c.identical)) {
                throw new Error('Repeated virtual-clock run did not match');
            }
        }
        json('browser-errors.json', errors);
        if (errors.length) throw new Error('浏览器演出异常：' + errors.join('; '));
        succeeded = true;
        log('OUTPUT', output);
    } catch (error) {
        if (unlock) json('failure.json', { message: error.message, phase: governor.phase, cancelled: governor.cancelled });
        throw error;
    } finally {
        if (unlock) {
            json('preflight-report.json', preflight.report());
            json('load-report.json', governor.report());
        }
        if (elementary && !elementary.closed) elementary.destroy();
        if (encoder) encoder.kill();
        try { if (browser) await browser.close(); }
        finally {
            if (server) server.close();
            process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
            process.off('message', control); process.off('disconnect', cancel);
            try {
                if (unlock && process.env.SSV_PROOF_CLEANUP === '1') {
                    progress('cleanup', {}, true);
                    try { cleanup(output, { success: succeeded, managed: !!jobId }); }
                    catch (error) {
                        json('cleanup-warning.json', { message: error.message });
                        log('Cleanup warning; outputs preserved', error.message);
                    }
                }
            } finally { if (unlock) unlock(); }
        }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
