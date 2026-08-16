'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const controller = fs.readFileSync(require.resolve('../scripts/MainController.js'), 'utf8');
const player = fs.readFileSync(require.resolve('../scripts/AdvPlayer.js'), 'utf8');
const log = fs.readFileSync(require.resolve('../scripts/ScenarioLogLayer.js'), 'utf8');

assert.ok(!controller.includes('_decorateLocalizedButton'), 'original button artwork must not be covered by localized overlays');
assert.ok(controller.includes("'skip_to_select_track_button.png'"), 'original choice-skip button artwork must remain in use');
assert.ok(controller.includes("'fast_button_4_off.png'"), 'original fast button artwork must remain in use');
assert.ok(controller.includes("'auto_button_off.png'"), 'original auto button artwork must remain in use');
assert.ok(controller.includes("'log_button.png'"), 'original log button artwork must remain in use');
assert.ok(controller.includes("'hide_button.png'"), 'original hide button artwork must remain in use');
assert.match(controller, /setChoiceSkipVisible\(visible\)/);
assert.match(player, /_findInitialChoiceCheckpoint\(this\._tracks\)/,
    'choice jump must be available before the first selection screen is reached');
assert.match(player, /this\._mainController\.on\('skip', \(\) => this\.returnToLastChoice\(\)\)/);
assert.match(log, /new PIXI\.Text\('关闭'/);

console.log('original-choice-controls: PASS');
