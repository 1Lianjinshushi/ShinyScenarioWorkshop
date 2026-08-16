'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync(require.resolve('../scripts/EndRelatedScenario.js'), 'utf8');
const localMainSource = fs.readFileSync(require.resolve('../main.js'), 'utf8');
const remoteMainSource = fs.readFileSync(require.resolve('../remote-main.js'), 'utf8');
const context = {
    window: { location: { search: '' } },
    showEndOverlay() {},
    buildEndOverlay() {},
    URLSearchParams,
    console,
    module: { exports: {} },
};
vm.createContext(context);
vm.runInContext(source, context);
const logic = context.module.exports;
const plain = value => JSON.parse(JSON.stringify(value));

assert.deepStrictEqual(
    plain(logic.buildFollowingGroups('200702001')),
    [
        { label: '20070200X', ids: ['200702002', '200702003', '200702004', '200702005', '200702006', '200702007', '200702008', '200702009'] },
        { label: '20070201X', ids: ['200702011', '200702012', '200702013', '200702014', '200702015', '200702016', '200702017', '200702018', '200702019'] },
    ],
);
assert.deepStrictEqual(
    plain(logic.buildFollowingGroups('200702002')),
    [
        { label: '20070200X', ids: ['200702003', '200702004', '200702005', '200702006', '200702007', '200702008', '200702009'] },
        { label: '20070201X', ids: ['200702011', '200702012', '200702013', '200702014', '200702015', '200702016', '200702017', '200702018', '200702019'] },
    ],
);
assert.deepStrictEqual(plain(logic.buildFollowingGroups('invalid')), []);
assert.strictEqual(
    logic.buildScenarioSearch('?eventType=produce_events&eventId=300502501&language=cn&source=remote', {
        eventType: 'produce_events', eventId: '300502502', source: 'remote',
    }),
    'eventType=produce_events&eventId=300502502&language=cn&source=remote',
);
assert.deepStrictEqual(
    plain(logic.buildRelatedPages([1, 2, 3, 4, 5, 6, 7])),
    [[1, 2, 3], [4, 5, 6], [7]],
);
assert.strictEqual(logic.workshopReturnAction('?returnMode=current'), 'navigate');
assert.strictEqual(logic.workshopReturnAction('?eventId=201002004'), 'close');
assert.match(source, /退回选择节点/);
assert.match(source, /once\('choiceReturn', leaveEndMode\)/);
assert.doesNotMatch(source, /播放绿幕并返回选择节点/);
assert.match(source, /choice_branch_return\.mp4/);
assert.match(source, /playChoiceReturnTransition\(CHOICE_RETURN_MOVIE\)/);
let transitionCalls = 0;
const choicePlayer = {
    canReturnToLastChoice: () => true,
    playChoiceReturnTransition: () => { transitionCalls++; },
};
assert.strictEqual(logic.tryAutoReturnChoice(choicePlayer, '?mode=edit'), false);
assert.strictEqual(transitionCalls, 0, 'correction mode must keep its direct-return End control');
assert.strictEqual(logic.tryAutoReturnChoice(choicePlayer, '?language=cn'), true);
assert.strictEqual(transitionCalls, 1, 'ordinary choice playback must auto-start the keyed transition');
assert.match(localMainSource, /tryAutoReturnChoice\(advPlayer\)/);
assert.match(remoteMainSource, /tryAutoReturnChoice\(advPlayer\)/);
assert.match(localMainSource, /advPlayer\.on\('end', handleScenarioEnd\)/,
    'local playback must rebuild End after every returned choice branch');
assert.match(remoteMainSource, /advPlayer\.on\('end', handleScenarioEnd\)/,
    'remote playback must rebuild End after every returned choice branch');
assert.match(localMainSource, /advPlayer\.on\('choiceReturnLeadIn', handleChoiceReturnLeadIn\)/,
    'local playback should begin the choice return before the terminal black hold finishes');
assert.match(remoteMainSource, /advPlayer\.on\('choiceReturnLeadIn', handleChoiceReturnLeadIn\)/,
    'remote playback should begin the choice return before the terminal black hold finishes');
console.log('end-related-scenario: PASS');
