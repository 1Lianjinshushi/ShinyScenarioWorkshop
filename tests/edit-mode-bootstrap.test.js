'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8');
const remote = fs.readFileSync(path.resolve(__dirname, '..', 'remote-main.js'), 'utf8');

assert.match(app, /async function ensureEditableTranslationCsv\(\)/);
assert.match(app, /ScenarioCsvTranslation\.createEditableScenarioCsv\(state\.tracks\)/);
assert.match(app, /ui\['play-edit'\]\.disabled = !loaded/,
    'loading Japanese JSON alone must enable edit mode');
assert.match(app, /await ensureEditableTranslationCsv\(\)/,
    'edit mode must create its working CSV without a download/re-import round trip');
assert.match(app, /const workflow = translated > 0 \? 'correction' : 'translation'/,
    'an imported CSV with existing translations must be treated as a correction workflow');
assert.match(app, /params\.set\('editWorkflow', state\.csvWorkflow\)/,
    'the workshop must pass the translation/correction workflow into edit mode');
assert.match(remote, /ScenarioCsvTranslation\.createEditableScenarioCsv\(source\.tracks\)/,
    'a direct edit-mode URL must also bootstrap a blank working CSV');
assert.match(remote, /exportWorkflow: editWorkflow/,
    'the player must pass the workflow into CSV export naming');
assert.doesNotMatch(remote, /编辑模式需要先在工坊选择并保存当前剧情的翻译 CSV/);

console.log('edit-mode-bootstrap: PASS');
