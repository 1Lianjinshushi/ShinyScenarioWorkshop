'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
const workspaceCss = fs.readFileSync(path.join(root, 'app-workspace.css'), 'utf8');
const navigation = fs.readFileSync(path.join(root, 'scripts/WorkspaceNavigation.js'), 'utf8');
const monitorApp = fs.readFileSync(path.join(root, 'scripts', 'GameUpdateMonitorApp.js'), 'utf8');

test('workshop has four independent workspace views and shared stable controls', () => {
    assert.match(html, /class="panel fetch-panel"/);
    for (const view of ['library', 'workbench', 'export', 'maintenance']) {
        assert.equal((html.match(new RegExp('data-workspace-view="' + view + '"', 'g')) || []).length, 1);
        assert.match(html, new RegExp('data-go-workspace="' + view + '"'));
    }
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, 'no duplicated controls or file inputs');
    assert.match(html, /class="offline-export-panel panel"/);
    assert.match(html, /id="game-update-monitor"/);
    assert.ok(html.indexOf('id="translation-batch"') < html.indexOf('id="speaker-details"'));
    assert.ok(html.indexOf('id="offline-export-active-jobs"') < html.indexOf('id="offline-export-jobs"'));
    assert.match(html, /data-workspace-click="translation-batch"/);
    assert.match(html, /data-library-tab="updates"/);
    assert.match(html, /data-library-tab="all"/);
    assert.match(html, /scripts\/WorkspaceNavigation\.js/);
    assert.match(workspaceCss, /\.workspace-shell \[hidden\] \{ display: none !important;/);
    assert.doesNotMatch(navigation, /innerHTML|replaceChildren|setInterval/);
    assert.match(css, /\.panel::before\s*\{/);
    assert.match(css, /\.fetch-grid\s*\{[^}]*border:/s);
    assert.match(css, /\.offline-export-panel\[open\]/);
    assert.match(css, /\.monitor-library\s*\{[^}]*border-top:/s);
    assert.match(monitorApp, /function cardResourceMarkup\(node\)/);
    assert.match(monitorApp, /载入本地 MP4/);
    assert.match(css, /\.monitor-card-resources\s*\{/);
});

test('workspace CSS and navigation are included in portable builds', () => {
    const builder = fs.readFileSync(path.join(root, 'build-portable.ps1'), 'utf8');
    assert.match(builder, /'app-workspace\.css'/);
    assert.match(builder, /Copy-RequiredDirectory 'scripts'/);
    assert.match(navigation, /data-help-fallback/);
    assert.match(navigation, /ssv\.workspace\.view\.v1/);
    assert.match(workspaceCss, /@media \(max-width: 800px\)/);
});

test('game check, name completion and their status belong to the library', () => {
    const library = html.slice(html.indexOf('<section id="game-update-monitor"'), html.indexOf('<section id="maintenance"'));
    const maintenance = html.slice(html.indexOf('<section id="maintenance"'));
    assert.match(library, /href="https:\/\/shinycolors\.enza\.fun\/"/);
    assert.match(library, /id="game-update-rebuild-labels"/);
    assert.match(library, /id="game-update-note"/);
    assert.ok(library.indexOf('id="game-update-rebuild-labels"') < library.indexOf('class="library-toolbar"'));
    assert.doesNotMatch(maintenance, /id="game-update-rebuild-labels"|id="game-update-note"|href="https:\/\/shinycolors\.enza\.fun\/"/);
    assert.match(maintenance, /href="\.\/scripts\/ShinyScenarioUpdateMonitor\.user\.js"/);
});

test('workshop controls retain focus, reduced-motion, and narrow-screen treatments', () => {
    assert.match(css, /:focus-visible/);
    assert.match(css, /\.file-drop:focus-within/);
    assert.match(css, /@media \(max-width: 980px\)/);
    assert.match(css, /@media \(max-width: 760px\)/);
    assert.match(css, /@media \(max-width: 480px\)/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /\.offline-export-body \[hidden\]\s*\{\s*display:\s*none !important;/);
});

test('background export links to the FFmpeg installation article in a new tab', () => {
    assert.match(html, /<a class="button-link" href="https:\/\/www\.bilibili\.com\/read\/cv33507583\/" target="_blank" rel="noopener noreferrer">FFmpeg 安装图文教程 ↗<\/a>/);
    assert.match(html, /<code>ffprobe\.exe<\/code> 放进工坊 <code>tools<\/code>/);
    assert.match(css, /\.offline-export-install \.button-link\s*\{/);
});

test('listener install opens in a new tab and explains Chrome userscript setup', () => {
    assert.match(html, /<a class="button-link primary" href="\.\/scripts\/ShinyScenarioUpdateMonitor\.user\.js" target="_blank" rel="noopener noreferrer">安装／更新监听脚本<\/a>/);
    assert.match(html, /Chrome 需先安装并启用 Tampermonkey 或 Violentmonkey/);
    assert.match(html, /扩展“详情”页提供“允许用户脚本”/);
    assert.match(html, /新标签页只显示脚本源码，说明脚本管理器缺失或未启用/);
});
