'use strict';
// Isolated browser test: no user tabs, translation archives or source files are modified.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const { chromium } = require(process.env.SSV_PLAYWRIGHT || path.join(require('node:os').homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base = 'http://127.0.0.1:8766', portable = 'http://127.0.0.1:8767';
const output = path.join(root, 'exports/offline-proof/staged-ui-20260917'); fs.mkdirSync(output, { recursive: true });
const source = fs.readFileSync(path.join(root, 'exports/offline-proof/4902005026/lean-20260917/source.json'), 'utf8');
const request = async (url, payload, origin) => {
    const response = await fetch(url, { method: payload === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', 'X-SSV-Offline': '1', ...(origin ? { Origin: origin } : {}) },
        body: payload === undefined ? undefined : JSON.stringify(payload) });
    return { status: response.status, data: await response.json() };
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    for (const host of [base, portable]) {
        assert.equal((await request(host + '/api/offline-export/jobs', { items: [] }, 'https://example.invalid')).status, 403);
        assert.equal((await request(host + '/api/offline-export/jobs')).data.available, true);
        assert.equal((await request(host + '/api/offline-export/jobs')).data.manualStart, true);
        assert.equal((await request(host + '/api/offline-export/start', { ids: [] }, host)).status, 400);
        assert.equal((await request(host + '/api/offline-export/jobs', { items: [{ eventId: '../bad' }] }, host)).status, 400);
    }
    console.log('Both hosts: availability, validation and origin checks passed');
    const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/offline-export/'))
            return route.fulfill({ json: url.pathname === '/api/state' ? { speakers: [] } : { entries: {}, groups: [], batches: [] } });
        return route.continue();
    });
    const errors = []; let page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    try {
        await page.goto(base + '/app.html');
        await page.locator('#offline-export-panel summary').click();
        assert.equal(await page.locator('#export-video, #export-video-browser, #video-export-frame, #offline-export-mode').count(), 0);
        assert.equal(await page.locator('#offline-export-jobs .offline-export-job').count(), 0, 'Historical jobs must not be rendered');
        await page.evaluate(source => {
            state.tracks = JSON.parse(source); state.eventId = '4902005026'; state.eventType = 'special_communications';
            window.SSVOfflineExport.refreshAvailability();
        }, source);
        await page.waitForFunction(() => !document.getElementById('offline-export-ja').disabled);
        const oldIds = new Set((await request(base + '/api/offline-export/jobs')).data.jobs.map(j => j.id));
        await page.locator('#offline-export-ja').click();
        await page.waitForFunction(() => document.getElementById('offline-export-message').textContent.includes('已加入'));
        let fresh = (await request(base + '/api/offline-export/jobs')).data.jobs.filter(j => !oldIds.has(j.id));
        const activeId = fresh[0].id; assert(activeId);
        await page.evaluate(() => {
            // Synthetic translation fixture, kept only in this isolated page / output snapshot.
            state.csvEventId = state.eventId; state.csvEventType = state.eventType;
            const rows = [['id', 'name', 'text', 'trans']];
            for (const t of state.tracks.filter(t => t.text)) rows.push([t.id, t.speaker, t.text.replace(/\r?\n/g, '\\n'), '测试译文\\n第二行']);
            state.csvText = ScenarioCsvTranslation.serializeCsvRows(rows); state.speakerMap.set('ルカ', '路加');
            window.SSVOfflineExport.refreshAvailability();
        });
        await page.locator('#offline-export-zh').click();
        await sleep(1000);
        fresh = (await request(base + '/api/offline-export/jobs')).data.jobs.filter(j => !oldIds.has(j.id));
        const translated = fresh.find(j => j.language === 'zh-cn'); assert(translated);
        const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'exports/offline-jobs', translated.id, '4902005026.json'), 'utf8'));
        assert.equal(snapshot[1].text, '测试译文\r\n第二行'); assert.equal(snapshot[1].speaker, '路加');
        await page.locator('#offline-export-files').setInputFiles({ name: '4902005026.json', mimeType: 'application/json', buffer: Buffer.from(source) });
        await sleep(1000);
        fresh = (await request(base + '/api/offline-export/jobs')).data.jobs.filter(j => !oldIds.has(j.id));
        const queued = fresh.find(j => ![activeId, translated.id].includes(j.id)); assert(queued);
        assert(fresh.every(j => j.state === 'pending')); assert(fresh.every(j => !j.progress));
        await page.reload(); await page.locator('#offline-export-panel summary').click();
        await page.waitForFunction(() => document.querySelectorAll('.offline-export-job[data-state="pending"]').length === 3);
        assert.equal(await page.locator('#offline-export-start').isDisabled(), true);
        await page.locator('[data-job-id="' + activeId + '"] input[type="checkbox"]').check();
        await page.locator('[data-job-id="' + translated.id + '"] input[type="checkbox"]').check();
        const typography = await page.evaluate(() => [document.querySelector('.offline-export-note'), document.querySelector('#offline-export-message'), document.querySelector('.offline-export-help')].map(e => getComputedStyle(e).fontSize));
        assert.equal(new Set(typography).size, 1);
        await page.locator('#offline-export-panel').screenshot({ path: path.join(output, 'pending-desktop.png') });
        await page.setViewportSize({ width: 420, height: 1100 });
        const noOverflow = await page.locator('#offline-export-panel').evaluate(e => e.scrollWidth <= e.clientWidth);
        assert(noOverflow, 'Export panel must fit narrow windows');
        await page.locator('#offline-export-panel').screenshot({ path: path.join(output, 'pending-mobile.png') });
        await page.setViewportSize({ width: 1440, height: 1100 });
        await page.locator('#offline-export-start').click();
        await page.waitForFunction(() => document.querySelector('.offline-export-job[data-state="running"]'));
        fresh = (await request(base + '/api/offline-export/jobs')).data.jobs.filter(j => !oldIds.has(j.id));
        assert.equal(fresh.find(j => j.id === queued.id).state, 'pending', 'Unselected item must not start');
        // Cancel via the portable host too; both hosts must see the same queue.
        await request(portable + '/api/offline-export/cancel', { id: queued.id }, portable);
        const deadline = Date.now() + 120000;
        let preparationBudgetStop = false;
        while (Date.now() < deadline) {
            const job = (await request(base + '/api/offline-export/jobs')).data.jobs.find(j => j.id === activeId);
            if (job.stage === 'render') break;
            if (job.state === 'failed' && /超过当前安全预算/.test(job.error || '')) { preparationBudgetStop = true; break; }
            if (['failed', 'complete'].includes(job.state)) throw new Error('Expected a cancellable renderer: ' + JSON.stringify(job));
            await sleep(2000);
        }
        if (!preparationBudgetStop) await page.locator('[data-job-id="' + activeId + '"]').getByRole('button', { name: '取消', exact: true }).click();
        await page.close(); console.log('UI snapshot + batch submitted; queued and running cancellation requested; page closed');
        const completionDeadline = Date.now() + 180000;
        let jobs;
        while (Date.now() < completionDeadline) {
            jobs = (await request(base + '/api/offline-export/jobs')).data.jobs;
            const job = jobs.find(j => j.id === translated.id);
            console.log(job.state, job.stage, job.progress?.encodedFrames || 0);
            if (['complete', 'failed', 'cancelled'].includes(job.state)) break;
            await sleep(5000);
        }
        assert.equal(jobs.find(j => j.id === activeId).state, preparationBudgetStop ? 'failed' : 'cancelled');
        assert.equal(jobs.find(j => j.id === queued.id).state, 'cancelled');
        const complete = jobs.find(j => j.id === translated.id); assert.equal(complete.state, 'complete', complete.error);
        const dir = path.join(root, 'exports/offline-jobs', complete.id);
        for (const file of ['picture.h264', 'picture.mp4', 'mix.f32', 'media-mix.f32', 'mastered.f32', 'audio', 'movie-frames']) assert(!fs.existsSync(path.join(dir, file)), file);
        assert(fs.existsSync(path.join(dir, 'source.json'))); assert(fs.existsSync(path.join(dir, 'cleanup-report.json')));
        assert.equal((await fetch(base + complete.outputUrl, { headers: { Range: 'bytes=0-100' } })).status, 206);
        page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.goto(base + '/app.html');
        await page.locator('#offline-export-panel summary').click();
        await page.waitForFunction(() => document.getElementById('offline-export-badge').textContent === '准备就绪');
        assert.equal(await page.locator('#offline-export-jobs .offline-export-job').count(), 0);
        assert.equal(await page.locator('#offline-export-open-root').isEnabled(), true);
        let rootRequested = false;
        await page.route('**/api/offline-export/open-root', route => { rootRequested = true; return route.fulfill({ json: { opened: path.join(root, 'exports/offline-videos') } }); });
        await page.locator('#offline-export-open-root').click();
        await page.waitForFunction(() => document.getElementById('offline-export-message').textContent === '已打开统一保存目录。');
        assert(rootRequested);
        await page.locator('#offline-export-panel').screenshot({ path: path.join(output, 'panel.png') });
        assert.deepEqual(errors, []);
        const report = { passed: true, errors, currentJapaneseCancelled: activeId, queuedBatchCancelled: queued.id,
            translatedFixtureCompleted: translated.id, pageClosedDuringRender: true, bothHostsVerified: true, finalVideo: complete.outputPath,
            stagedWithoutStarting: true, uncheckedStayedPending: true, historyHidden: true, typography, mobileNoOverflow: noOverflow, rootButtonRequested: rootRequested,
            preparationBudgetStop, runningCancellationVerified: !preparationBudgetStop };
        fs.writeFileSync(path.join(output, 'validation.json'), JSON.stringify(report, null, 2)); console.log(report);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
