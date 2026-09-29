'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function converter() {
    const source = fs.readFileSync(path.join(__dirname, '../scripts/AdvResourceConverter.js'), 'utf8');
    const context = {
        ASSET_FORMAT: { textFrame: './assets/images/event/text_frame/${id}.png' },
        CHARACTER_ASSET_FORMAT: { logTextFrame: './assets/images/event/log_text_frame/${id}.png' },
        DEFAULT_TEXT_FRAME: '001',
        PRESERVED_VALUES: new Set(['off']),
        SPINE_ALIAS: {},
        PRODUCER_SPEAKERS: new Set(),
        SPEAKER_ICON_SUB: {}, SPEAKER_ICON_MAIN: {},
        DEFAULT_SPEAKER_ICON_TYPE: 'sub_characters', DEFAULT_SPEAKER_ICON_ID: '801',
    };
    vm.runInNewContext(source + '\nthis.AdvResourceConverter = AdvResourceConverter;', context);
    return new context.AdvResourceConverter();
}

test('background direct export omits optional log frame but keeps the visible text frame', () => {
    const c = converter();
    const tracks = c.convertResourcePaths([{ textFrame: '016', text: 'narration' }]);
    const normal = c.extractResourceList(tracks);
    assert(normal.includes('./assets/images/event/text_frame/016.png'));
    assert(normal.includes('./assets/images/event/log_text_frame/016.png'));

    const direct = c.extractResourceList(tracks, { includeLogTextFrames: false });
    assert(direct.includes('./assets/images/event/text_frame/016.png'));
    assert(!direct.includes('./assets/images/event/log_text_frame/016.png'));
});

test('offline proof explicitly opts out of log frames only', () => {
    const source = fs.readFileSync(path.join(__dirname, '../experiments/offline-export/page.js'), 'utf8');
    assert.match(source, /extractResourceList\(tracks, \{ includeLogTextFrames: false \}\)/);
});
