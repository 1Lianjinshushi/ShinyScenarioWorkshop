'use strict';
// Controlled Edge playback probe; does not attach to or change the user's browser.
// Measures concurrent decoder/UI-loop responsiveness, not subjective mouse latency.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const cp = require('node:child_process');
const { once } = require('node:events');
const root = path.resolve(__dirname, '../..');
const playwright = require(process.env.SSV_PLAYWRIGHT || path.join(os.homedir(),
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const source = process.env.SSV_CONTENTION_SOURCE ? path.resolve(process.env.SSV_CONTENTION_SOURCE)
    : path.join(root, 'exports/offline-proof/4902005026/lean-20260917/4902005026.offline.mp4');
if (!fs.existsSync(source)) throw new Error('Generate a baseline sample first or set SSV_CONTENTION_SOURCE to a local MP4');
const tag = process.env.SSV_CONTENTION_TAG || 'contention-20260917';
if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(tag)) throw new Error('Invalid contention run tag');
const output = path.join(root, 'exports/offline-proof/4902005026', tag);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
    let browser, server, runner;
    try {
        fs.mkdirSync(output, { recursive: true });
        server = http.createServer((req, res) => {
            if (req.url !== '/sample.mp4') {
                res.setHeader('Content-Type', 'text/html');
                return res.end('<!doctype html><body style="margin:0"><video id="v" src="/sample.mp4" autoplay muted loop style="width:100vw;height:100vh"></video></body>');
            }
            const size = fs.statSync(source).size;
            const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
            const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
            res.setHeader('Content-Type', 'video/mp4'); res.setHeader('Accept-Ranges', 'bytes');
            if (range) { res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`); }
            res.setHeader('Content-Length', end - start + 1);
            fs.createReadStream(source, { start, end }).pipe(res);
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await playwright.chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
            headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-extensions', '--disable-background-networking'] });
        const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.evaluate(async () => {
            await v.play();
            window.probe = { gaps: [], waits: 0, previous: performance.now() };
            v.addEventListener('waiting', () => probe.waits++);
            const frame = t => { probe.gaps.push(t - probe.previous); probe.previous = t; requestAnimationFrame(frame); };
            requestAnimationFrame(frame);
            window.resetProbe = () => { probe.gaps = []; probe.waits = 0; probe.start = performance.now(); probe.startQuality = v.getVideoPlaybackQuality(); };
            window.readProbe = () => {
                const q = v.getVideoPlaybackQuality(), gaps = probe.gaps.slice().sort((a, b) => a - b);
                return { seconds: (performance.now() - probe.start) / 1000, visibility: document.visibilityState,
                    width: v.videoWidth, height: v.videoHeight, totalFrames: q.totalVideoFrames - probe.startQuality.totalVideoFrames,
                    droppedFrames: q.droppedVideoFrames - probe.startQuality.droppedVideoFrames, waitingEvents: probe.waits,
                    rafP95Ms: gaps[Math.floor(gaps.length * .95)], rafP99Ms: gaps[Math.floor(gaps.length * .99)],
                    rafOver100ms: gaps.filter(g => g > 100).length, mediaError: v.error?.message || null };
            };
        });
        await sleep(2000); await page.evaluate(() => resetProbe());
        await sleep(12000); const baseline = await page.evaluate(() => readProbe());
        console.log('EDGE BASELINE', JSON.stringify(baseline));
        await page.evaluate(() => resetProbe());
        runner = cp.spawn(process.execPath, [path.join(__dirname, 'run.cjs'), '4902005026', 'offline'], {
            cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, SSV_PROOF_RUN_TAG: tag, SSV_PROOF_OFFLINE: '1' },
        });
        runner.stdout.on('data', data => process.stdout.write(data)); runner.stderr.on('data', data => process.stderr.write(data));
        const [code] = await once(runner, 'close'); runner = null;
        const concurrent = await page.evaluate(() => readProbe());
        const report = { scope: 'Separate headless Edge looping local 1080p60 sample, muted, while an isolated headless browser exports. No user tabs touched. Not a physical foreground/mouse responsiveness test.',
            exportExitCode: code, baseline, concurrent };
        fs.writeFileSync(path.join(output, 'edge-contention.json'), JSON.stringify(report, null, 2));
        console.log('EDGE CONCURRENT', JSON.stringify(concurrent));
        if (code !== 0) throw new Error(`Export failed: ${code}`);
    } finally {
        if (runner) runner.kill();
        if (browser) await browser.close();
        if (server) server.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
