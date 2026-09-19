'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const builder = read('build-portable.ps1');
const launcher = read('start-portable.cmd');

test('r13 portable builder cannot silently replace r12 or an existing package', () => {
    assert.match(builder, /\$Version = '20260919-r13'/);
    assert.match(builder, /\$Version -eq '20260907-r12'/);
    assert.match(builder, /Package target already exists/);
    assert.doesNotMatch(builder, /Remove-Item -LiteralPath \$PackageRoot/);
    assert.doesNotMatch(builder, /Remove-Item -LiteralPath \$ZipPath/);
});

test('offline experiment inclusion is a fixed production dependency list', () => {
    const match = builder.match(/\$offlineRuntimeFiles = @\(([\s\S]*?)\n\)/);
    assert.ok(match);
    const files = [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]);
    assert.deepEqual(files.sort(), [
        'audio-master.js', 'audio-merge.cjs', 'bridge.cjs', 'cleanup.cjs',
        'clock.js', 'flow.js', 'governor.cjs', 'language.cjs', 'movies.js',
        'naming.cjs', 'page.js', 'preflight.cjs', 'profile.cjs', 'queue.cjs',
        'run.cjs', 'service.cjs',
    ].sort());
    for (const file of files) assert.ok(fs.statSync(path.join(root, 'experiments/offline-export', file)).isFile());
    assert.doesNotMatch(builder, /Copy-RequiredDirectory 'experiments\/offline-export'/);
    assert.ok(!files.includes('README.md'));
    assert.ok(!files.some(file => /^(?:audit|diagnose|verify)/.test(file)));
});

test('runtime manifest carries workshop font and both 016 dialogue frames', () => {
    const files = new Set(JSON.parse(read('portable-runtime-assets.json')).files);
    for (const file of [
        'fonts/AlimamaShuHeiTi.ttf',
        'assets/images/event/text_frame/016.png',
        'assets/images/event/log_text_frame/016.png',
    ]) {
        assert.ok(files.has(file), file);
        assert.ok(fs.statSync(path.join(root, file)).size > 0, file);
    }
});

test('trusted local tool sources, license notices, and explicit FFmpeg opt-in are wired', () => {
    assert.match(builder, /\[switch\]\$BundleOfflineRuntime/);
    assert.match(builder, /Assert-ExternalFile \$NodeExecutable/);
    assert.match(builder, /Copy-ExternalFile \$NodeExecutable 'tools\/node\.exe'/);
    assert.match(builder, /Copy-ExternalDirectory \(Join-Path \$PlaywrightModules \$name\) "tools\/node_modules\/\$name"/);
    assert.match(builder, /playwrightPackage\.dependencies\.'playwright-core' -ne \$playwrightCorePackage\.version/);
    assert.match(builder, /if \(\$BundleOfflineRuntime\) \{\s+Copy-ExternalFile \(Join-Path \$FFmpegDirectory 'bin\\ffmpeg\.exe'\)/);
    assert.match(builder, /tools\/licenses\/node-LICENSE\.txt/);
    assert.match(builder, /tools\/licenses\/ffmpeg-LICENSE\.txt/);
    assert.match(builder, /FFmpeg was included without -BundleOfflineRuntime/);
});

test('launcher binds package tools and prefers Edge before Chrome', () => {
    assert.match(launcher, /set "SSV_NODE=%~dp0tools\\node\.exe"/);
    assert.match(launcher, /set "SSV_PLAYWRIGHT=%~dp0tools\\node_modules\\playwright"/);
    assert.match(launcher, /set "SSV_FFMPEG=%~dp0tools\\ffmpeg\.exe"/);
    assert.match(launcher, /set "SSV_FFPROBE=%~dp0tools\\ffprobe\.exe"/);
    assert.ok(launcher.indexOf('Microsoft\\Edge') < launcher.indexOf('Google\\Chrome'));
    assert.match(launcher, /Microsoft Edge and Google Chrome were not found/);
    assert.match(launcher, /FFmpeg is not bundled/);
});
