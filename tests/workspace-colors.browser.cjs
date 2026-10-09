'use strict';
// Visual regression using the real workshop HTML/CSS, with inert local fixture
// data only. No app scripts, upstream requests, services or export jobs run.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const http = require('node:http'), crypto = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root = path.resolve(__dirname, '..'), output = path.join(root, 'tmp/workspace-colors');
fs.mkdirSync(output, { recursive: true });
const markup = fs.readFileSync(path.join(root, 'app.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/app.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(markup); }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || !/\.(css|ttf)$/.test(file) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'font/ttf'); fs.createReadStream(file).pipe(res);
});
const fingerprint = bytes => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const failures = [], report = [];
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
        await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
        await page.goto(base + '/app.html'); await page.evaluate(() => document.fonts.ready);
        const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const samples = async view => {
            const box = await page.locator('[data-workspace-view="' + view + '"]').boundingBox();
            const positions = { backdrop: [8, 520], panelTop: [box.x + box.width - 12, box.y + 60], panelBody: [box.x + box.width - 12, box.y + 150] };
            if (view === 'library') {
                const tree = await page.locator('#color-tree').boundingBox();
                positions.treeHeader = [tree.x + 8, tree.y + 36];
            }
            const colors = {};
            for (const [name, [x, y]] of Object.entries(positions)) colors[name] = fingerprint(await page.screenshot({ clip: { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 } }));
            return { colors, x: box.x, width: box.width, height: box.height };
        };
        const same = (view, label, before, after) => {
            const changed = Object.keys(before.colors).filter(key => before.colors[key] !== after.colors[key]);
            const widthChanged = before.x !== after.x || before.width !== after.width;
            report.push({ view, label, changed, widthChanged, beforeHeight: before.height, afterHeight: after.height });
            if (changed.length || widthChanged) failures.push(view + '/' + label + ': ' + [...changed, ...(widthChanged ? ['layout-width'] : [])].join(','));
        };
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 1100 });
            for (const view of ['library', 'workbench', 'export', 'maintenance']) {
                await page.evaluate(view => {
                    for (const panel of document.querySelectorAll('[data-workspace-view]')) panel.hidden = panel.dataset.workspaceView !== view;
                    for (const link of document.querySelectorAll('.workspace-nav [data-go-workspace]')) link.setAttribute('aria-current', link.dataset.goWorkspace === view ? 'page' : 'false');
                    const panel = document.querySelector('[data-workspace-view="' + view + '"]');
                    document.querySelectorAll('[data-color-fixture]').forEach(node => node.remove());
                    if (view === 'library') {
                        document.getElementById('game-update-list').innerHTML = '<details id="color-tree" class="monitor-tree-node" data-depth="0"><summary class="monitor-tree-summary"><span class="monitor-copy"><strong>活动</strong></span><span>783 条</span></summary><div class="monitor-tree-children">' + Array.from({length: 80}, (_, i) => '<details class="monitor-tree-node" data-depth="1"><summary class="monitor-tree-summary"><span>第 ' + (i+1) + ' 次活动</span></summary><div style="height:200px">子剧情</div></details>').join('') + '</div></details>';
                    } else {
                        const details = document.createElement('details'); details.dataset.colorFixture = ''; details.id = 'color-details'; details.className = 'workspace-details';
                        details.innerHTML = '<summary>展开更多内容</summary><div class="details-body" style="height:6000px">长列表，仅用于测试面板高度变化</div>';
                        panel.querySelector('.panel-body').append(details);
                    }
                    window.scrollTo(0, 0);
                }, view);
                await page.mouse.move(0, 0); await settle();
                const before = await samples(view);
                await page.screenshot({path:path.join(output,view+'-'+width+'-closed.png'), animations:'disabled'});
                await page.evaluate(view => { document.getElementById(view === 'library' ? 'color-tree' : 'color-details').open = true; window.scrollTo(0, 0); }, view);
                await settle(); const expanded = await samples(view);
                assert(expanded.height > before.height + 3000, 'fixture must significantly expand ' + view);
                same(view + '-' + width, 'expanded', before, expanded);
                await page.screenshot({path:path.join(output,view+'-'+width+'-open.png'), animations:'disabled'});
                if (view === 'library') {
                    await page.locator('#color-tree .monitor-tree-node > summary').first().hover();
                    // Hover must highlight only the child summary, never tint its ancestors.
                    await page.evaluate(() => window.scrollTo(0, 0)); await settle();
                    same(view + '-' + width, 'child-hover', expanded, await samples(view));
                    // Exercise a deeper ancestor too: depth 0 has a separate legacy
                    // background override which would otherwise hide hover tint bugs.
                    await page.evaluate(() => {
                        const parent = document.querySelector('#color-tree .monitor-tree-node');
                        parent.id = 'color-parent'; parent.open = true;
                        parent.insertAdjacentHTML('beforeend', '<details id="color-child" class="monitor-tree-node" data-depth="2"><summary class="monitor-tree-summary">嵌套目录</summary></details>');
                        parent.scrollIntoView({ block: 'center' });
                    });
                    await page.mouse.move(0, 0); await settle();
                    const parentSample = async () => {
                        const box = await page.locator('#color-parent > summary').boundingBox();
                        return { colors: { parentHeader: fingerprint(await page.screenshot({clip: {x: Math.floor(box.x + 8), y: Math.floor(box.y + 10), width: 1, height: 1}})) }, x:box.x, width:box.width, height:box.height };
                    };
                    const unhovered = await parentSample();
                    await page.locator('#color-child > summary').hover();
                    await page.waitForTimeout(200);
                    assert(await page.locator('#color-parent').evaluate(node => node.matches(':hover')));
                    same(view + '-' + width, 'nested-hover', unhovered, await parentSample());
                }
                await page.mouse.move(0, 0);
                await page.evaluate(view => { document.getElementById(view === 'library' ? 'color-tree' : 'color-details').open = false; window.scrollTo(0, 0); }, view);
                await settle(); same(view + '-' + width, 'collapsed', before, await samples(view));
            }
        }
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ report, failures }, null, 2));
        console.log(JSON.stringify({ checks: report.length, failures, screenshots: output }));
        if (process.env.SSV_COLOR_BASELINE !== '1') assert.deepEqual(failures, []);
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
