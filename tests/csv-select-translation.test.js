'use strict';

const assert = require('node:assert/strict');
const csv = require('../scripts/CsvTranslation.js');

const tracks = [
    { select: 'その意気だ！', nextLabel: 1 },
    { select: 'いつも通りの\r\n智代子でな！', nextLabel: 2 },
    { select: '無理なくな', nextLabel: 3 },
];
const source = [
    'id,name,text,trans',
    'select,,その意気だ！,要的就是这种气势！',
    'select,,いつも通りの\\n智代子でな！,智代子像平时那种就好！',
    'select,,無理なくな,别勉强自己哦',
].join('\r\n');

const merged = csv.mergeScenarioTranslation(tracks, source);
assert.equal(merged.report.applied, 3);
assert.equal(merged.report.missing, 0);
assert.deepEqual(
    merged.tracks.map(track => track.select_cn),
    ['要的就是这种气势！', '智代子像平时那种就好！', '别勉强自己哦'],
);

const blankWorkingCopy = csv.createEditableScenarioCsv([
    { id: '2010020010010', speaker: '智代子', text: '一行目\r\n二行目' },
    { select: '選択肢だ！', nextLabel: 1 },
    { bg: '001' },
]);
assert.ok(blankWorkingCopy.startsWith('\uFEFFid,name,text,trans\n'));
assert.deepEqual(
    csv.parseScenarioCsv(blankWorkingCopy).map(row => [row.id, row.name, row.text, row.trans]),
    [
        ['2010020010010', '智代子', '一行目\\n二行目', ''],
        ['select', '', '選択肢だ！', ''],
    ],
);
const blankMerged = csv.mergeScenarioTranslation([
    { id: '2010020010010', speaker: '智代子', text: '一行目\r\n二行目' },
    { select: '選択肢だ！', nextLabel: 1 },
], blankWorkingCopy);
assert.equal(blankMerged.report.applied, 0);
assert.deepEqual(
    blankMerged.report.bindings.map(binding => [binding.trackIndex, binding.field]),
    [[0, 'text'], [1, 'select']],
    'a freshly generated blank CSV must bind every editable Japanese line',
);
assert.deepEqual(
    merged.report.bindings.map(binding => [binding.trackIndex, binding.rowNumber, binding.field]),
    [[0, 2, 'select'], [1, 3, 'select'], [2, 4, 'select']],
);

const untranslated = csv.mergeScenarioTranslation(
    [{ select: '未翻訳の選択肢', nextLabel: 1 }],
    'id,name,text,trans\r\nselect,,未翻訳の選択肢,',
);
assert.equal(untranslated.report.applied, 0);
assert.deepEqual(
    untranslated.report.bindings.map(binding => [binding.trackIndex, binding.rowNumber, binding.field]),
    [[0, 2, 'select']],
    'an untranslated choice must still be editable in correction mode',
);

console.log('csv-select-translation: PASS');
