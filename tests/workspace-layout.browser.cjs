'use strict';
// Isolated UI integration: real app scripts/styles, synthetic API and CSV data.
// No requests reach the user's live service or upstream game resources.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root = path.resolve(__dirname, '..'), screenshots = path.join(root, 'tmp/workspace-layout');
fs.mkdirSync(screenshots, { recursive: true });
const calls = [], errors = [];
const tracks = id => [{ id: id + '0001', speaker: '櫻木 真乃', text: 'こんにちは', charAnim1: 'idle' }, { id: id + '0002', speaker: '未登记人物', text: 'ありがとう' }];
const csv = id => 'id,name,text,trans\n' + id + '0001,櫻木 真乃,こんにちは,你好\n' + id + '0002,未登记人物,ありがとう,谢谢\n';
let jobs = [
    {id: 'p', eventId: '302801301', displayGroup: '阳希S卡・【探偵は二面相】', displayTitle: '01.任せてください', state: 'pending', stage: 'pending', language: 'zh-cn'},
    {id: 'r', eventId: '302801302', displayGroup: '阳希S卡・【探偵は二面相】', displayTitle: '02.報酬はあなたの笑顔', state: 'running', stage: 'render', language: 'zh-cn', speedMode: 'high-speed', concurrency: 2, verificationMode: 'auto', progress: {stage: 'render', storyTotal: 80, storyCompleted: 40, videoSeconds: 126.5, encodedFrames: 7590}},
    {id: 'm', eventId: '200902204', displayGroup: '果穗P卡・【げっと！！！】', displayTitle: '04.ウサギだらけの夜？', state: 'paused', stage: 'paused', language: 'zh-cn', pause: {reason: '系统空闲内存不足，清理后点击“继续任务”。'}, speedMode: 'high-speed', concurrency: 2, verificationMode: 'auto'}
];
const monitor = { initialized: true, totalCount: 3, unreadCount: 1, lastObservedAt: '2026-10-08T14:00:00Z', items: [
    {eventType: 'produce_events', eventId: '302801301', cardName: '【探偵は二面相】', storyTitle: '任せてください', unread: true, firstSeenAt: '2026-10-08T14:00:00Z', updateDetectedAt: '2026-10-08T14:00:00Z', updateKind: 'new', pageImplementationStatus: 'implemented'},
    {eventType: 'produce_events', eventId: '302801302', cardName: '【探偵は二面相】', storyTitle: '報酬はあなたの笑顔', firstSeenAt: '2026-10-08T14:00:00Z', updateDetectedAt: '2026-10-08T14:00:00Z', updateKind: 'new'},
    {eventType: 'produce_events', eventId: '3000300101', storyTitle: '新しい朝', firstSeenAt: '2026-10-08T14:00:00Z', updateDetectedAt: '2026-10-08T14:00:00Z', updateKind: 'new'}
] };
const data = () => ({jobs, available: true, manualStart: true, policyDefaults: {memoryMiB: 3072, reserveMiB: 3247},
    policyBounds: {memoryMiB: {min: 512, max: 8192}, reserveMiB: {min: 1024, max: 8192}}, speedModes: ['low-load', 'high-speed'], concurrencyModes: [1,2], verificationModes: ['auto','quick','full']});
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    if (url.pathname.startsWith('/api/')) {
        let raw = ''; for await (const chunk of req) raw += chunk;
        let body = {}; try { body = JSON.parse(raw || '{}'); } catch (_) {}
        calls.push({path: url.pathname, method: req.method, body});
        if (url.pathname.startsWith('/api/offline-export/')) {
            let ids = [];
            if (url.pathname.endsWith('/jobs') && req.method === 'POST') {
                for (const item of body.items) { const id = 'new' + jobs.length; jobs.push({...item, id, displayTitle: item.eventId, state:'pending', stage:'pending'}); ids.push(id); }
            }
            if (url.pathname.endsWith('/start')) jobs = jobs.map(j => body.ids.includes(j.id) ? {...j, state:'queued', stage:'queued', ...Object.fromEntries(['speedMode','concurrency','verificationMode'].map(k=>[k, body[k]]))} : j);
            if (url.pathname.endsWith('/cancel')) jobs = jobs.filter(j => j.id !== body.id);
            if (url.pathname.endsWith('/resume')) jobs = jobs.map(j=>j.id===body.id ? {...j, state:'running', stage:'render'} : j);
            return send({...data(), ids, resumed:true});
        }
        if (url.pathname === '/api/state') return send({speakers:[{name:'櫻木 真乃',trans:'真乃'}]});
        if (url.pathname === '/api/game-update-monitor') return send(monitor);
        if (url.pathname === '/api/scenario-library-labels') return send({cards:{},activities:{},stories:{}});
        if (url.pathname === '/api/scenario-metadata') return send({storyTitle:'测试子剧情标题',eventId:url.searchParams.get('eventId')});
        if (url.pathname === '/api/scenario-types') return send({eventTypes:['produce_events']});
        if (url.pathname === '/api/resource-cache-status') return send({present:body.paths,missing:[],bytes:128});
        return send({ok:true});
    }
    if (/\.pdf$/.test(url.pathname)) { res.statusCode = url.pathname.startsWith('/output/') ? 404 : 200; return res.end(); }
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root+path.sep) || !/\.(html|css|js|ttf)$/.test(file) || !fs.existsSync(file)) { res.statusCode=404; return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'font/ttf');
    fs.createReadStream(file).pipe(res);
});
(async () => {
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch({executablePath:process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
    try {
        const context = await browser.newContext({viewport:{width:1440,height:1100}});
        await context.route('**/*', route => {
            const url = route.request().url();
            if (url.startsWith(base+'/')) return route.continue();
            const match = /\/(\d+)\.json$/.exec(url);
            if (match) return route.fulfill({contentType:'application/json',body:JSON.stringify(tracks(match[1]))});
            return route.abort();
        });
        const page = await context.newPage(); page.on('pageerror', error=>errors.push(error.message));
        await page.goto(base+'/app.html'); await page.waitForFunction(()=>document.getElementById('offline-export-badge').textContent==='等待手动继续');
        await page.evaluate(()=>document.fonts.ready);
        assert.equal(await page.locator('[data-workspace-view]:visible').count(),1);
        assert(await page.locator('#workbench').isVisible());
        await page.locator('#translator-name').fill('测试译者');
        // Real shared CSV file input, reached via the new export entry.
        await page.locator('.workspace-nav [data-go-workspace="export"]').click();
        const chooser = page.waitForEvent('filechooser');
        await page.locator('[data-workspace-click="translation-batch"]').click();
        await (await chooser).setFiles(['200902204','200902211'].map(id=>({name:id+'.csv',mimeType:'text/csv',buffer:Buffer.from(csv(id))})));
        await page.waitForFunction(()=>document.getElementById('offline-export-start').textContent==='开始导出（2）');
        assert.equal(calls.filter(c=>c.path.endsWith('/start')).length,0);
        assert.equal(await page.locator('#offline-export-jobs .offline-export-job').count(),3);
        assert.equal(await page.locator('#offline-export-active-jobs .offline-export-job').count(),2);
        await page.waitForFunction(()=>document.getElementById('workspace-csv').textContent.includes('CSV 已匹配'));
        await page.evaluate(()=>{window.refs={tracks:state.tracks,csv:state.csvText,input:document.getElementById('translation-batch'),row:document.querySelector('[data-job-id="r"]')};});
        await page.screenshot({path:path.join(screenshots,'export-desktop.png'),fullPage:true,animations:'disabled'});
        await page.locator('.workspace-nav [data-go-workspace="workbench"]').click();
        assert(await page.locator('#speaker-details').getAttribute('open')!==null);
        assert.equal(await page.locator('#speaker-editor input').count(),1);
        await page.locator('#speaker-editor input').fill('测试未保存译名');
        await page.screenshot({path:path.join(screenshots,'workbench-desktop.png'),fullPage:true,animations:'disabled'});
        await page.locator('.workspace-nav [data-go-workspace="library"]').click();
        assert(await page.locator('#game-update-monitor #game-update-rebuild-labels').isVisible());
        assert(await page.locator('#game-update-monitor a[href="https://shinycolors.enza.fun/"]').isVisible());
        assert(await page.locator('#game-update-monitor #game-update-note').isVisible());
        await page.locator('#library-tab-all').click();
        const rootTree=page.locator('#library-pane-all .monitor-tree-node').first();
        await rootTree.locator(':scope > summary').click();
        await page.evaluate(()=>{window.refs.tree=document.querySelector('#library-pane-all .monitor-tree-node');});
        await page.locator('#library-tab-updates').click();
        await page.locator('#library-tab-all').click();
        assert.equal(await rootTree.getAttribute('open'),'');
        await page.locator('#game-update-refresh').click();
        await page.waitForFunction(()=>!document.getElementById('game-update-refresh').disabled);
        assert(await page.evaluate(()=>window.refs.tree===document.querySelector('#library-pane-all .monitor-tree-node')));
        assert((await page.locator('#library-pane-all').innerText()).includes('育成'));
        await page.locator('#game-update-rebuild-labels').click();
        await page.waitForFunction(()=>!document.getElementById('game-update-rebuild-labels').disabled);
        assert.equal(calls.filter(c=>c.path==='/api/rebuild-scenario-library-labels' && c.method==='POST').length,1);
        assert((await page.locator('#game-update-monitor #game-update-note').innerText()).includes('资料库名称已补全'));
        await page.screenshot({path:path.join(screenshots,'library-desktop.png'),fullPage:true,animations:'disabled'});
        await page.locator('#library-tab-updates').click();
        for (let depth=0; depth<8 && !(await page.locator('#library-pane-updates .monitor-use:visible').count()); depth++) {
            const closed=page.locator('#library-pane-updates details:not([open]) > summary:visible').first();
            assert(await closed.count(), 'update tree must expose a usable story');
            const details=await closed.locator('..').elementHandle(); await closed.click();
            await page.waitForFunction(node=>node.dataset.childrenRendered==='true', details);
        }
        const use=page.locator('#library-pane-updates .monitor-use:visible').first();
        const expected=await use.evaluate(button=>button.closest('.monitor-row').dataset.eventId);
        await use.click(); assert(await page.locator('#workbench').isVisible());
        assert.equal(await page.locator('#event-id').inputValue(), expected);
        assert(await page.locator('#fetch-scenario').isVisible());
        await page.locator('.workspace-nav [data-go-workspace="maintenance"]').click();
        assert(!(await page.locator('#game-update-rebuild-labels').isVisible()));
        assert(await page.locator('#maintenance a[href="./scripts/ShinyScenarioUpdateMonitor.user.js"]').isVisible());
        assert.equal(await page.locator('[data-help-fallback]').first().getAttribute('href'),'./Quick-Guide-ZH.pdf');
        await page.screenshot({path:path.join(screenshots,'maintenance-desktop.png'),fullPage:true,animations:'disabled'});
        await page.locator('.workspace-nav [data-go-workspace="workbench"]').click();
        assert(await page.evaluate(()=>window.refs.tracks===state.tracks && window.refs.csv===state.csvText && window.refs.input===document.getElementById('translation-batch') && window.refs.row===document.querySelector('[data-job-id="r"]')));
        assert.equal(await page.locator('#speaker-editor input').inputValue(),'测试未保存译名');
        await page.locator('.workspace-nav [data-go-workspace="export"]').click();
        await page.locator('#offline-export-speed-mode').selectOption('high-speed');
        await page.locator('#offline-export-start').click();
        await page.waitForFunction(()=>document.querySelectorAll('#offline-export-active-jobs .offline-export-job').length===4);
        assert.equal(context.pages().length,1);
        assert.equal(calls.filter(c=>c.path.endsWith('/start')).length,1);
        assert.equal(calls.find(c=>c.path.endsWith('/start')).body.speedMode,'high-speed');
        await page.locator('[data-job-id="m"] button').first().click();
        await page.waitForFunction(()=>!document.querySelector('[data-job-id="m"][data-state="paused"]'));
        await page.locator('#offline-export-jobs button').last().click();
        await page.waitForFunction(()=>document.querySelectorAll('#offline-export-jobs .offline-export-job').length===0);
        await page.reload();
        assert(await page.locator('#offline-export-panel').isVisible());
        assert.equal(await page.locator('#translator-name').inputValue(),'测试译者');
        // Stored view, legacy deep-link routing, keyboard sub-tabs and phone width.
        await page.goto(base+'/app.html'); assert(await page.locator('#offline-export-panel').isVisible());
        await page.goto(base+'/app.html#game-update-monitor'); assert(await page.locator('#game-update-monitor').isVisible());
        await page.locator('#library-tab-all').focus(); await page.keyboard.press('Home');
        assert.equal(await page.locator('#library-tab-updates').getAttribute('aria-selected'),'true');
        await page.setViewportSize({width:390,height:844});
        for (const view of ['workbench','export','library','maintenance']) {
            await page.locator('.workspace-nav [data-go-workspace="'+view+'"]').click();
            assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),view+' has horizontal overflow');
            await page.screenshot({path:path.join(screenshots,view+'-mobile.png'),fullPage:true,animations:'disabled'});
        }
        assert.deepEqual(errors,[]);
        console.log(JSON.stringify({passed:true,defaultAndRememberedView:true,realBatchCsvShared:true,noAutoStart:true,noPopup:true,domStatePreserved:true,libraryStableRefresh:true,queueSplit:true,resumeCancel:true,mobileOverflow:false,screenshots,errors}));
    } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
