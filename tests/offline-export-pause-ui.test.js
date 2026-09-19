'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('workshop exposes manual resume only for a paused export', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/AppOfflineExport.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
    assert.match(source, /resume\.onclick\s*=\s*\(\)\s*=>\s*action\('resume',\s*\{\s*id:\s*job\.id\s*\}\)/);
    assert.match(source, /entry\.resume\.hidden\s*=\s*job\.state\s*!==\s*'paused'/);
    assert.match(source, /entry\.resume\.disabled\s*=\s*busy\s*\|\|\s*!available\s*\|\|\s*j\.state\s*!==\s*'paused'/);
    assert.match(source, /job\.state\s*===\s*'paused'\s*\?\s*\(job\.pause\?\.reason/);
    assert.match(source, /route\s*===\s*'resume'\s*\?\s*45000/);
    assert.match(css, /\.offline-export-job\[data-state="paused"\]/);
});
