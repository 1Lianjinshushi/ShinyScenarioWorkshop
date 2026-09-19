'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Preflight, safeRelative, dependency, inspect, hashFile } = require('../experiments/offline-export/preflight.cjs');
function fixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssv-preflight-'));
    const resolve = name => path.join(dir, name);
    const write = (name, value) => { fs.mkdirSync(path.dirname(resolve(name)), { recursive: true }); fs.writeFileSync(resolve(name), value); };
    return { dir, resolve, write, clean: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAvsAAAAASUVORK5CYII=', 'base64');
test('Spine atlas companions and spritesheet images are all checked and hashed once', async () => {
    const f = fixture(); let acquired = 0;
    try {
        f.write('assets/model/data.json', JSON.stringify({ bones: [{}] }));
        f.write('assets/model/data.atlas', 'a.png\nsize: 1,1\n\nb.png\nsize: 1,1\n');
        f.write('assets/model/a.png', png); f.write('assets/model/b.png', png);
        f.write('assets/ui.json', JSON.stringify({ meta: { image: ['ui.png'] } })); f.write('assets/ui.png', png);
        const p = new Preflight({ resolve: f.resolve, acquire: async () => { acquired++; throw new Error('missing'); } });
        assert.equal(p.report().status, 'incomplete');
        await p.ensure('assets/model/data.json'); await p.ensure('assets/ui.json'); await p.ensure('assets/model/data.json');
        p.assert(); assert.equal(p.inventory.size, 6); assert.equal(acquired, 0);
        p.finished = true; assert.equal(p.report().status, 'passed');
        assert.equal(p.inventory.get('assets/ui.png').sha256, await hashFile(f.resolve('assets/ui.png')));
    } finally { f.clean(); }
});
test('reports missing model pages, voice and movie together before encoding', async () => {
    const f = fixture();
    try {
        f.write('assets/model/data.json', JSON.stringify({ bones: [{}] }));
        f.write('assets/model/data.atlas', 'missing.png\nsize: 1,1\n\nmissing2.png\nsize: 1,1\n');
        const p = new Preflight({ resolve: f.resolve, acquire: async () => { throw new Error('HTTP 404'); } });
        for (const file of ['assets/model/data.json', 'assets/voice.m4a', 'assets/card.mp4']) await p.ensure(file);
        assert.equal(p.failures.length, 4); assert.equal(p.report().ok, false);
        assert.throws(() => p.assert(), /missing.png[\s\S]*missing2.png[\s\S]*voice.m4a[\s\S]*card.mp4/);
    } finally { f.clean(); }
});
test('bad cached HTML, JSON and image fail without silently replacing user cache', async () => {
    const f = fixture();
    try {
        f.write('assets/fake.m4a', '<html>unavailable</html>'); f.write('assets/bad.json', '{'); f.write('assets/bad.png', 'bad');
        const p = new Preflight({ resolve: f.resolve, acquire: async () => { throw new Error('must not replace'); } });
        for (const name of ['fake.m4a', 'bad.json', 'bad.png']) await p.ensure('assets/' + name);
        assert.equal(p.failures.length, 3);
        assert.equal(fs.readFileSync(f.resolve('assets/bad.png'), 'utf8'), 'bad');
        await p.stage('font', 'decode', async () => { throw new Error('cannot decode'); });
        assert.equal(p.failures.at(-1).stage, 'decode');
    } finally { f.clean(); }
});
test('resource paths cannot escape cache/root via dependencies', () => {
    for (const value of ['../assets/a', '/assets/a', 'assets/../private', 'assets\\a', 'assets/a?x=1']) assert.throws(() => safeRelative(value));
    for (const value of ['../a.png', '/a.png', 'https://example/a.png', '..\\a.png']) assert.throws(() => dependency('assets/ui/data.json', value));
    assert.equal(dependency('assets/ui/data.json', 'sheet.png'), 'assets/ui/sheet.png');
});
test('oversized PNG rejected from header before decode allocation', () => {
    const f = fixture();
    try {
        const bytes = Buffer.from(png); bytes.writeUInt32BE(100000, 16); bytes.writeUInt32BE(100000, 20);
        f.write('assets/huge.png', bytes);
        assert.throws(() => inspect(f.resolve('assets/huge.png'), 'assets/huge.png'), /dimensions/);
    } finally { f.clean(); }
});
