'use strict';
// Compare new audio-only mastering against saved pre-change PCM, including a
// full 245-second story with dynamic-card media. Does not rewrite the reference.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os'), crypto = require('node:crypto');
const { Governor, limits } = require('./governor.cjs');
const { audioMemoryBytes } = require('./profile.cjs');
const { addMedia } = require('./audio-merge.cjs');
const root = path.resolve(__dirname, '../..');
const playwright = require(process.env.SSV_PLAYWRIGHT || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
(async () => {
    const results = [];
    for (const relative of ['4902005026/contention-20260917-v3', '201002001', '202701002']) {
        const dir = path.join(root, 'exports/offline-proof', relative);
        const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'audio-mastering.json'), 'utf8'));
        const governor = new Governor(limits());
        let browser, server, reference, media;
        try {
            server = http.createServer((req, res) => {
                const url = new URL(req.url, 'http://localhost');
                if (url.pathname === '/') return res.end('<!doctype html><script src="/master.js"></script>');
                if (url.pathname === '/master.js') { res.setHeader('Content-Type', 'text/javascript'); return fs.createReadStream(path.join(__dirname, 'audio-master.js')).pipe(res); }
                const start = Number(url.searchParams.get('start'));
                if (url.pathname !== '/proof-mix' || !Number.isSafeInteger(start) || start < 0 || start >= metadata.frames) { res.statusCode = 400; return res.end(); }
                fs.createReadStream(path.join(dir, 'mix.f32'), { start: start * 8, end: Math.min(start + 48000, metadata.frames) * 8 - 1 }).pipe(res);
            });
            await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
            browser = await playwright.chromium.launch({ executablePath: process.env.SSV_CHROMIUM || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
            governor.session = await browser.newBrowserCDPSession();
            const page = await browser.newPage();
            await page.goto(`http://127.0.0.1:${server.address().port}/`);
            await governor.allocation(audioMemoryBytes(metadata.frames), 'audio-equivalence');
            await page.evaluate(({ frames, parameters }) => audioMaster.render(frames, parameters), metadata);
            reference = fs.openSync(path.join(dir, 'mastered.f32'), 'r'); media = fs.openSync(path.join(dir, 'media-mix.f32'), 'r');
            let differingSamples = 0, maxDifference = 0;
            const expectedHash = crypto.createHash('sha256'), actualHash = crypto.createHash('sha256');
            for (let start = 0; start < metadata.frames; start += 48000) {
                await governor.checkpoint('comparison');
                const pcm = Buffer.from(await page.evaluate(start => audioMaster.chunk(start), start), 'base64');
                const expected = Buffer.alloc(pcm.length), movie = Buffer.alloc(pcm.length);
                if (fs.readSync(reference, expected, 0, expected.length, start * 8) !== expected.length || fs.readSync(media, movie, 0, movie.length, start * 8) !== movie.length) throw new Error('Incomplete reference');
                addMedia(pcm, movie); expectedHash.update(expected); actualHash.update(pcm);
                for (let i = 0; i < pcm.length; i += 4) {
                    const delta = Math.abs(pcm.readFloatLE(i) - expected.readFloatLE(i));
                    if (delta) differingSamples++;
                    maxDifference = Math.max(maxDifference, delta);
                }
            }
            const result = { source: relative, seconds: metadata.frames / 48000, frames: metadata.frames,
                differingSamples, maxDifference, expectedSha256: expectedHash.digest('hex'), actualSha256: actualHash.digest('hex'),
                load: governor.report() };
            results.push(result); console.log('AUDIO COMPARISON', JSON.stringify({ ...result, load: undefined }));
            if (result.expectedSha256 !== result.actualSha256) throw new Error('Audio output is not byte-identical; do not enable new path');
        } finally {
            if (reference != null) fs.closeSync(reference); if (media != null) fs.closeSync(media);
            if (browser) await browser.close(); if (server) server.close();
            fs.writeFileSync(path.join(root, 'exports/offline-proof/audio-optimization-20260917.json'), JSON.stringify(results, null, 2));
        }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
