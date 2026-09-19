'use strict';
// One short synthetic Chinese fixture, never reads/writes translation archives.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..'), base = 'http://127.0.0.1:8766';
const sourceFile = path.join(root, 'exports/offline-proof/4902005026/chinese-font-fixed-20260917/source.json');
const source = fs.readFileSync(sourceFile, 'utf8');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const request = async (route, payload) => {
    const res = await fetch(base + '/api/offline-export/' + route, { method: payload ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', 'X-SSV-Offline': '1', Origin: base },
        body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(25000) });
    const data = await res.json(); assert(res.ok, JSON.stringify(data)); return data;
};
(async () => {
    const before = await request('jobs');
    assert(before.available); assert(!before.jobs.some(j => ['queued', 'running', 'cancelling'].includes(j.state)), 'User export active; do not start test');
    const submitted = await request('jobs', { items: [{ eventId: '4902005026', eventType: 'special_communications',
        language: 'zh-cn', mode: 'offline', content: source }] });
    const id = submitted.ids[0]; console.log('Submitted short naming verification:', id);
    assert(submitted.jobs.find(j => j.id === id).state === 'pending');
    await request('start', { ids: [id] });
    let job;
    for (const deadline = Date.now() + 240000; Date.now() < deadline;) {
        job = (await request('jobs')).jobs.find(j => j.id === id);
        console.log(job.state, job.stage, job.progress?.encodedFrames || 0);
        if (['complete', 'failed', 'cancelled'].includes(job.state)) break;
        await new Promise(r => setTimeout(r, 5000));
    }
    assert.equal(job.state, 'complete', job.error);
    assert(job.outputPath.includes(path.join('exports', 'offline-videos'))); assert(!job.namingWarning);
    const dir = path.join(root, 'exports/offline-jobs', id);
    assert.equal(digest(fs.readFileSync(path.join(dir, '4902005026.json'))), digest(Buffer.from(source)));
    const info = JSON.parse(fs.readFileSync(path.join(dir, 'renderer-info.json'), 'utf8'));
    assert.equal(info.renderer.language, 'cn');
    assert.deepEqual(info.renderer.fonts.dialogue, ['方正FW轻吟体 简 B']);
    const response = await fetch(base + job.outputUrl, { headers: { Range: 'bytes=0-100' } });
    assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, 101);
    const { chromium } = require(process.env.SSV_PLAYWRIGHT || path.join(require('node:os').homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
    const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin !== base) return route.abort();
            if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/offline-export/'))
                return route.fulfill({ json: url.pathname === '/api/state' ? { speakers: [] } : { entries: {}, groups: [], batches: [] } });
            return route.continue();
        });
        const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.goto(base + '/app.html'); await page.locator('#offline-export-panel summary').click();
        await page.waitForFunction(() => document.getElementById('offline-export-badge').textContent === '准备就绪');
        assert.equal(await page.locator('.offline-export-job[data-state="complete"]').count(), 0);
        assert.equal(await page.locator('#offline-export-open-root').isEnabled(), true);
        assert.deepEqual(errors, []);
        const out = path.join(root, 'exports/offline-proof/naming-20260917'); fs.mkdirSync(out, { recursive: true });
        await page.locator('#offline-export-panel').screenshot({ path: path.join(out, 'panel.png') });
        const report = { passed: true, jobId: id, outputPath: job.outputPath, outputName: job.outputName,
            downloadStatus: response.status, sourceUnchanged: true, rendererLanguage: info.renderer.language,
            browserErrors: errors, videoSha256: digest(fs.readFileSync(job.outputPath)) };
        fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify(report, null, 2)); console.log(report);
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
