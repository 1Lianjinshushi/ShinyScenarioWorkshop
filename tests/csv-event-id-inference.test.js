'use strict';

const assert = require('node:assert/strict');
const csv = require('../scripts/CsvTranslation.js');

const first = '\uFEFFid,name,text,trans\n'
    + '3005025010010,真乃,夏でもひんやり,即使在夏天也凉飕飕\n'
    + '3005025010020,真乃,次の行,下一行\n'
    + 'info,译者,,,\n';
assert.equal(csv.inferScenarioEventId(first), '300502501');

const second = 'id,name,text,trans\r\n'
    + '0000000000000,,選択肢,选项\r\n'
    + '3005025020010,めぐる,ひんやり超えても夏,凉过头也还是夏天\r\n'
    + '3005025020020,灯織,次の行,下一行\r\n';
assert.equal(csv.inferScenarioEventId(csv.parseScenarioCsv(second)), '300502502');

assert.throws(
    () => csv.inferScenarioEventId('id,name,text,trans\n1,a,b,c\n'),
    /无法自动识别剧情编号/,
);
assert.throws(
    () => csv.inferScenarioEventId('id,name,text,trans\n3005025010010,a,b,c\n3005025020010,d,e,f\n'),
    /多个剧情编号/,
);

const editable = '\uFEFFid,name,text,trans\r\n'
    + '0000000000000,真乃,一行目,旧译文\r\n'
    + '0000000000000,めぐる,二行目,\r\n';
const edited = csv.updateScenarioCsvTranslation(editable, 2, '新译文\n第二行');
assert.ok(edited.startsWith('\uFEFF'));
assert.equal(csv.parseScenarioCsv(edited)[0].trans, '新译文\\n第二行');
assert.equal(csv.parseScenarioCsv(edited)[1].trans, '');

const standardized = csv.ensureScenarioCsvMetadata(edited, 'produce_events', '201002001');
assert.match(standardized, /\ninfo,produce_events\/201002001\.json,,\n/);
assert.match(standardized, /\n译者,,,\n$/);
const repairedMetadata = csv.ensureScenarioCsvMetadata(
    'id,name,text,trans\n2010020010010,智代子,原文,译文\ninfo,wrong\/path.json,,\n译者,测试译者,,\n',
    'produce_events',
    '201002001',
);
assert.match(repairedMetadata, /info,produce_events\/201002001\.json,,/);
assert.match(repairedMetadata, /译者,测试译者,,/);
const signedMetadata = csv.ensureScenarioCsvMetadata(
    repairedMetadata,
    'produce_events',
    '201002001',
    '煉金術式',
);
assert.match(signedMetadata, /译者,煉金術式,,/);
const signedBlank = csv.createEditableScenarioCsv([
    { id: '2010020010010', speaker: '智代子', text: '原文' },
], { eventType: 'produce_events', eventId: '201002001', translator: '煉金術式' });
assert.match(signedBlank, /\n译者,煉金術式,,\n$/);

const mergedForEdit = csv.mergeScenarioTranslation([
    { id: '0000000000000', speaker: '真乃', text: '一行目' },
    { id: '0000000000000', speaker: 'めぐる', text: '二行目' },
], editable);
assert.equal(mergedForEdit.report.applied, 1);
assert.deepEqual(
    mergedForEdit.report.bindings.map(item => [item.trackIndex, item.rowNumber, item.trans]),
    [[0, 2, '旧译文'], [1, 3, '']],
);

console.log('csv-event-id-inference: PASS');
