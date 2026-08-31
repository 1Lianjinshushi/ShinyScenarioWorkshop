'use strict';

const assert = require('node:assert/strict');
const csv = require('../scripts/CsvTranslation.js');

// 3000400101-style structure: the game reuses one id for an action-only
// character node and the dialogue immediately following it.
const sharedActionIdTracks = [
    {
        id: '30004001010510',
        charLabel: 'amana',
        charAnim1: 'anger2',
        voice: 'produce_events/3000400101/30004001010510',
    },
    {
        id: '30004001010510',
        speaker: '甘奈＆甜花',
        text: 'やってほしい……！',
        charLabel: 'tenka',
        charAnim1: 'wait4',
    },
];
const sharedActionIdCsv = [
    'id,name,text,trans',
    '30004001010510,甘奈＆甜花,やってほしい……！,希望你能接下……！',
].join('\r\n');
const sharedActionIdMerged = csv.mergeScenarioTranslation(sharedActionIdTracks, sharedActionIdCsv);
assert.deepEqual(
    sharedActionIdMerged.report.bindings.map(binding => [binding.trackIndex, binding.rowNumber]),
    [[1, 2]],
    'an action-only duplicate id must not steal the dialogue CSV binding',
);
assert.equal(sharedActionIdMerged.tracks[0].text_cn, undefined);
assert.equal(sharedActionIdMerged.tracks[1].text_cn, '希望你能接下……！');
assert.equal(sharedActionIdMerged.tracks[0].charAnim1, 'anger2');
assert.equal(sharedActionIdMerged.tracks[1].charAnim1, 'wait4');

// 3000400103-style structure: the same voiced line and id occur once normally
// and once later as a flashback.  A blank first translation must not make the
// translated second CSV row drift back onto the first occurrence.
const replayTracks = [
    {
        id: '30004001030210',
        speaker: '甜花',
        text: 'いってらっしゃい、なーちゃん……！',
        charAnim1: 'wait2',
    },
    { bg: '00001', bgEffect: 'fade_out' },
    {
        id: '30004001030210',
        label: '回想',
        speaker: '甜花',
        text: 'いってらっしゃい、なーちゃん……！',
    },
];
const replayCsv = [
    'id,name,text,trans',
    '30004001030210,甜花,いってらっしゃい、なーちゃん……！,',
    '30004001030210,甜花,いってらっしゃい、なーちゃん……！,路上小心、娜酱……！',
].join('\r\n');
const replayMerged = csv.mergeScenarioTranslation(replayTracks, replayCsv);
assert.deepEqual(
    replayMerged.report.bindings.map(binding => [binding.trackIndex, binding.rowNumber]),
    [[0, 2], [2, 3]],
    'replayed duplicate ids must bind to distinct occurrences in source order',
);
assert.equal(replayMerged.tracks[0].text_cn, undefined);
assert.equal(replayMerged.tracks[2].text_cn, '路上小心、娜酱……！');
assert.deepEqual(
    replayMerged.tracks.map(track => track.id || null),
    ['30004001030210', null, '30004001030210'],
    'CSV binding must not reorder or remove playback tracks',
);
assert.equal(replayMerged.tracks[1].bgEffect, 'fade_out');

console.log('csv-duplicate-track-id: PASS');
