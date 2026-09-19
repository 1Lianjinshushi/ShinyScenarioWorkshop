'use strict';
// Same bridge used by Python and PowerShell hosts. No client-supplied command,
// executable path, output path or remote URL is accepted.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const root = path.resolve(__dirname, '../..'), endpoint = path.join(root, 'exports/.offline-service.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(settings, method, route, payload, timeout = 4000) {
    if (!Number.isSafeInteger(settings.port) || settings.port < 1 || settings.port > 65535 || !/^[a-f0-9]{64}$/.test(settings.token)) throw new Error('Invalid local endpoint');
    const response = await fetch(`http://127.0.0.1:${settings.port}${route}`, { method,
        headers: { Authorization: 'Bearer ' + settings.token, 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(timeout) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Local service HTTP ${response.status}`);
    if (method === 'GET' && !Array.isArray(data.jobs)) throw new Error('Invalid local service response');
    return data;
}
(async () => {
    let bytes = 0, chunks = [];
    for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 32 * 1024 * 1024) throw new Error('请求过大'); chunks.push(chunk); }
    const { method, route, payload } = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''));
    if (!((method === 'GET' && route === '/jobs') || (method === 'POST' && ['/jobs', '/start', '/settings', '/resume', '/cancel', '/open', '/open-root'].includes(route)))) throw new Error('Invalid bridge operation');
    let settings;
    try {
        settings = JSON.parse(fs.readFileSync(endpoint, 'utf8'));
        await request(settings, 'GET', '/jobs', undefined, 600);
    } catch (_) {
        cp.spawn(process.execPath, [path.join(__dirname, 'service.cjs')], { cwd: root, windowsHide: true,
            detached: true, stdio: 'ignore' }).unref();
        settings = null;
        const deadline = Date.now() + 5000;
        for (let n = 0; n < 35 && Date.now() < deadline; n++) {
            await sleep(100);
            try { const s = JSON.parse(fs.readFileSync(endpoint, 'utf8')); await request(s, 'GET', '/jobs', undefined, 600); settings = s; break; } catch (_) {}
        }
        if (!settings) throw new Error('后台直出服务未能启动；请检查 Node 与本地运行依赖');
    }
    // Do not retry a POST after an uncertain response; avoid duplicate actions.
    process.stdout.write(JSON.stringify(await request(settings, method, route, payload, route === '/resume' ? 35000 : 4000)));
})().catch(error => { process.stdout.write(JSON.stringify({ error: error.message })); process.exitCode = 1; });
