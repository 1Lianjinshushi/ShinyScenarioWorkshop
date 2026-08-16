'use strict';

const assert = require('node:assert/strict');
const metadata = require('../scripts/ScenarioStoryMetadata.js');

assert.equal(metadata.storyPrefix('produce_events', '201002001'), '01');
assert.equal(metadata.storyPrefix('produce_events', '201002011'), 'TE');
assert.equal(metadata.storyPrefix('game_event_communications', '400109501'), '序章');
assert.equal(metadata.storyPrefix('game_event_communications', '400109502'), '01');
assert.equal(metadata.storyPrefix('game_event_communications', '400109507'), '06');
assert.equal(metadata.storyPrefix('game_event_communications', '400109508'), '终章');
assert.equal(metadata.storyPrefix('produce_events', '100100101'), '01');
assert.equal(metadata.storyPrefix('produce_events', '600100102'), '');
assert.equal(metadata.storyPrefix('produce_communication_auditions', '501000100011'), '');
assert.equal(metadata.csvFilename({
    eventType: 'produce_events', eventId: '201002001', storyTitle: '夏のチョコアイドル',
}, { corrected: true }), '【校】01.夏のチョコアイドル.csv');
assert.equal(metadata.csvFilename({
    eventType: 'produce_events', eventId: '201002001', storyTitle: '夏のチョコアイドル',
}, { workflow: 'translation' }), '【翻】01.夏のチョコアイドル.csv');
assert.equal(metadata.csvFilename({
    eventType: 'produce_events', eventId: '201002001', storyTitle: '夏のチョコアイドル',
}, { workflow: 'correction' }), '【校】01.夏のチョコアイドル.csv');
assert.equal(metadata.csvFilename({
    eventType: 'produce_events', eventId: '201002011', storyTitle: 'なんて　アイドル',
}), 'TE.なんて　アイドル.csv');
assert.equal(metadata.csvFilename({
    eventType: 'game_event_communications', eventId: '400109508', storyTitle: 'ENDING',
}), '终章.ENDING.csv');
assert.equal(metadata.csvFilename({
    eventType: 'produce_events', eventId: '201002001', storyTitle: 'a/b:c*',
}), '01.a＿b＿c＿.csv');
assert.equal(metadata.csvFilename({
    eventType: 'produce_events', eventId: '600100102', storyTitle: '敗退コミュ',
}), '敗退コミュ.csv');

console.log('scenario-story-metadata: PASS');
