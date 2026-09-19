'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'portable-runtime-assets.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

test('portable runtime manifest contains only safe, non-empty local files', () => {
    assert.ok(Array.isArray(manifest.files));
    assert.ok(manifest.files.length >= 20);
    for (const relativePath of manifest.files) {
        assert.equal(path.isAbsolute(relativePath), false, relativePath);
        assert.equal(relativePath.split(/[\\/]+/).includes('..'), false, relativePath);
        const absolutePath = path.join(root, relativePath);
        const stat = fs.statSync(absolutePath);
        assert.equal(stat.isFile(), true, relativePath);
        assert.ok(stat.size > 0, relativePath);
    }
});

test('every portable texture atlas includes its referenced image', () => {
    for (const relativePath of manifest.files.filter(file => file.endsWith('.json'))) {
        const atlasPath = path.join(root, relativePath);
        const data = JSON.parse(fs.readFileSync(atlasPath, 'utf8'));
        if (!data.meta || !data.meta.image) continue;
        const imagePath = path.resolve(path.dirname(atlasPath), data.meta.image);
        assert.equal(fs.existsSync(imagePath), true, `${relativePath} -> ${data.meta.image}`);
        assert.equal(manifest.files.includes(path.relative(root, imagePath).replaceAll('\\', '/')), true);
    }
});

test('portable runtime includes locally available and cached-story text/log frames', () => {
    const declared = new Set(manifest.files);
    const framePath = (kind, id) => `assets/images/event/${kind}/${id}.png`;
    for (const kind of ['text_frame', 'log_text_frame']) {
        const directory = path.join(root, 'assets', 'images', 'event', kind);
        for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.png'))) {
            assert.ok(declared.has(framePath(kind, path.basename(name, '.png'))), `${kind}/${name}`);
        }
    }

    // Cached scenario JSON is personal data and is absent from a source checkout.
    // When present, every raw textFrame ID must have both locally forced variants.
    const cacheRoot = path.join(root, 'assets', 'json');
    if (!fs.existsSync(cacheRoot)) return;
    const pending = [cacheRoot];
    while (pending.length) {
        const directory = pending.pop();
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) { pending.push(entryPath); continue; }
            if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
            const tracks = JSON.parse(fs.readFileSync(entryPath, 'utf8'));
            if (!Array.isArray(tracks)) continue;
            for (const track of tracks) {
                if (!track || track.textFrame == null) continue;
                const id = String(track.textFrame);
                // "off" and similar control commands are preserved, not asset IDs.
                if (!/^\d+$/.test(id)) continue;
                for (const kind of ['text_frame', 'log_text_frame']) {
                    assert.ok(declared.has(framePath(kind, id)), `${path.relative(root, entryPath)} uses ${kind}/${id}.png`);
                }
            }
        }
    }
});

test('player loads common UI and interaction resources from the local runtime root', () => {
    const source = fs.readFileSync(path.join(root, 'remote-main.js'), 'utf8');
    assert.match(source, /const runtimeRoot = SSV_LOCAL_ASSET_ROOT;/);
    assert.match(source, /ssvAddResource\(loader, 'uiParts', ssvJoinUrl\(runtimeRoot,/);
    assert.match(source, /ssvAddResource\(loader, UI_TAP_SE_KEY, ssvJoinUrl\(runtimeRoot,/);
    assert.match(source, /textFrame:\s+ssvJoinUrl\(SSV_LOCAL_ASSET_ROOT,/);
    assert.match(source, /logTextFrame:\s+ssvJoinUrl\(SSV_LOCAL_ASSET_ROOT,/);
    assert.match(source, /speakerIcon:\s+ssvJoinUrl\(SSV_LOCAL_ASSET_ROOT,/);
    assert.match(source, /PIXI loader reached 100% without completing/);
    assert.match(source, /finish\('progress-100-fallback'\)/);
});

test('portable runtime contains every regular idol portrait plus Hazuki and fallbacks', () => {
    for (let id = 1; id <= 28; id++) {
        const relativePath = `assets/images/content/characters/icon_circle_l/${String(id).padStart(3, '0')}.png`;
        assert.ok(manifest.files.includes(relativePath), relativePath);
    }
    for (const relativePath of [
        'assets/images/content/characters/icon_circle_l/801.png',
        'assets/images/content/characters/icon_circle_l/802.png',
        'assets/images/content/characters/icon_circle_l/803.png',
        'assets/images/content/characters/icon_circle_l/804.png',
        'assets/images/content/sub_characters/icon_circle_l/801.png',
        'assets/images/content/sub_characters/icon_circle_l/901.png',
        'assets/images/content/sub_characters/icon_circle_l/902.png',
    ]) assert.ok(manifest.files.includes(relativePath), relativePath);
});

test('translated speaker names still resolve portraits through the Japanese source name', () => {
    const source = fs.readFileSync(path.join(root, 'scripts', 'AdvResourceConverter.js'), 'utf8');
    assert.match(source, /_getSpeakerIconPath\(e\.speaker_ja \|\| e\.speaker\)/);
});

test('portable build consumes and verifies the runtime manifest', () => {
    const source = fs.readFileSync(path.join(root, 'build-portable.ps1'), 'utf8');
    assert.match(source, /Get-Content -LiteralPath \$runtimeManifestPath -Raw \| ConvertFrom-Json/);
    assert.match(source, /Portable runtime file was not packaged correctly/);
});
