'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('workshop visual hierarchy keeps the three existing work areas', () => {
    assert.match(html, /class="panel fetch-panel"/);
    assert.match(html, /class="section-heading subsection-main-heading"/);
    assert.match(html, /class="offline-export-panel"/);
    assert.match(html, /id="game-update-monitor"/);
    assert.match(css, /\.panel::before\s*\{/);
    assert.match(css, /\.fetch-grid\s*\{[^}]*border:/s);
    assert.match(css, /\.offline-export-panel\[open\]/);
    assert.match(css, /\.monitor-library\s*\{[^}]*border-top:/s);
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
