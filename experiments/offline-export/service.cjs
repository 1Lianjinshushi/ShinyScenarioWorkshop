'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const { acquireLock } = require('./governor.cjs');
const { ExportQueue } = require('./queue.cjs');
const root = path.resolve(__dirname, '../..'), exportsDir = path.join(root, 'exports');
fs.mkdirSync(exportsDir, { recursive: true });
const release = acquireLock(path.join(exportsDir, '.offline-service.lock'));
const token = crypto.randomBytes(32).toString('hex'), queue = new ExportQueue(root);
const endpoint = path.join(exportsDir, '.offline-service.json');
let lastRequest = Date.now();
const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    try {
        if (req.headers.authorization !== `Bearer ${token}`) { res.statusCode = 403; return res.end('{}'); }
        lastRequest = Date.now();
        let chunks = [], bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 32 * 1024 * 1024) throw new Error('请求过大'); chunks.push(chunk); }
        const payload = bytes ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        let result;
        if (req.method === 'GET' && req.url === '/jobs') result = queue.list();
        else if (req.method === 'POST' && req.url === '/jobs') result = queue.submit(payload.items);
        else if (req.method === 'POST' && req.url === '/start') result = queue.start(payload.ids, payload.settings);
        else if (req.method === 'POST' && req.url === '/settings') result = await queue.updateSettings(payload.ids, payload.settings);
        else if (req.method === 'POST' && req.url === '/resume') result = await queue.resume(payload.id);
        else if (req.method === 'POST' && req.url === '/open-root') result = queue.openRoot();
        else if (req.method === 'POST' && req.url === '/cancel') result = queue.cancel(payload.id);
        else if (req.method === 'POST' && req.url === '/open') result = queue.open(payload.id);
        else throw new Error('未知直出操作');
        res.end(JSON.stringify(result));
    } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: error.message })); }
});
server.listen(0, '127.0.0.1', () => {
    fs.writeFileSync(endpoint + '.tmp', JSON.stringify({ port: server.address().port, token, pid: process.pid }));
    fs.renameSync(endpoint + '.tmp', endpoint);
});
const idle = setInterval(() => {
    if (!queue.active && Date.now() - lastRequest > 10 * 60 * 1000) server.close(() => process.exit(0));
}, 10000); idle.unref();
process.on('exit', () => {
    release();
    try { if (JSON.parse(fs.readFileSync(endpoint)).token === token) fs.unlinkSync(endpoint); } catch (_) {}
});
