const assert = require('assert');
const monitor = require('../scripts/GameUpdateMonitorCore.js');

const parsed = monitor.parseScenarioPath('/assets/json/produce_events/300502501.json?v=123');
assert.deepStrictEqual(parsed, {
    key: 'produce_events/300502501',
    eventType: 'produce_events',
    eventId: '300502501',
    path: 'json/produce_events/300502501.json',
});
assert.strictEqual(monitor.parseScenarioPath('images/content/foo.png'), null);
assert.strictEqual(monitor.parseScenarioPath('json/not_a_scenario/123.json'), null);

assert.deepStrictEqual(monitor.inferCardIdentity('produce_events', '202701011'), {
    characterId: '027',
    characterName: '铃木羽那',
    characterNameJp: '鈴木羽那',
    cardType: 'Produce',
    cardSequence: '010',
    storySequence: '11',
});
assert.deepStrictEqual(monitor.inferCardIdentity('produce_events', '300502501'), {
    characterId: '005',
    characterName: '田中摩美美',
    characterNameJp: '田中摩美々',
    cardType: 'Support',
    cardSequence: '025',
    storySequence: '01',
});

const produceCard = monitor.classifyScenario('produce_events', '201002001');
assert.strictEqual(produceCard.category, 'produce-card');
assert.strictEqual(produceCard.characterName, '园田智代子');
assert.strictEqual(produceCard.cardSequence, '020');
assert.strictEqual(produceCard.storySequence, '01');
assert.strictEqual(produceCard.groupCode, '2010020__');
assert.strictEqual(produceCard.groupLabel, '园田智代子P卡');
assert.strictEqual(
    monitor.childDisplayLine({
        eventType: 'produce_events',
        eventId: '201002001',
        storyTitle: '夏のチョコアイドル',
    }),
    '201002001 · 01.夏のチョコアイドル',
);
assert.strictEqual(
    monitor.childDisplayLine({
        eventType: 'produce_events',
        eventId: '201002011',
        storyTitle: 'なんて　アイドル',
    }),
    '201002011 · TE.なんて　アイドル',
);

const supportCard = monitor.classifyScenario('produce_events', '300402701');
assert.strictEqual(supportCard.category, 'support-card');
assert.strictEqual(supportCard.characterName, '月冈恋钟');
assert.strictEqual(supportCard.cardSequence, '027');
assert.strictEqual(supportCard.groupCode, '3004027__');

const trueEnd = monitor.classifyScenario('produce_events', '201002011');
assert.strictEqual(trueEnd.storyLabel, 'True End');

const gameEvent = monitor.classifyScenario('game_event_communications', '400109501');
assert.strictEqual(gameEvent.category, 'game-event');
assert.strictEqual(gameEvent.eventSequence, '095');
assert.strictEqual(gameEvent.storySequence, '01');
assert.strictEqual(gameEvent.groupCode, '4001095__');
assert.strictEqual(gameEvent.groupLabel, '第95次组活');
assert.strictEqual(
    monitor.classifyScenario('game_event_communications', '400109401').groupLabel,
    '第94次组活',
);

const stepStory = monitor.classifyScenario('produce_events', '101000501');
assert.strictEqual(stepStory.category, 'produce-mode');
assert.strictEqual(stepStory.characterName, '园田智代子');
assert.strictEqual(stepStory.produceModeLabel, 'STEP');
assert.strictEqual(stepStory.groupCode, '1010005__');
const wingVariant = monitor.classifyScenario('produce_events', '1001003071');
assert.strictEqual(wingVariant.category, 'produce-mode');
assert.strictEqual(wingVariant.characterName, '樱木真乃');
assert.strictEqual(wingVariant.produceModeLabel, 'GRAD');
assert.strictEqual(wingVariant.groupCode, '1001003___');
assert.strictEqual(
    monitor.inferTrainingCharacterId('produce_communication_auditions', '501000100011'),
    '010',
);
const wingFailure = monitor.classifyScenario('produce_events', '600100102');
assert.strictEqual(wingFailure.category, 'produce-common');
assert.strictEqual(wingFailure.characterName, '樱木真乃');
assert.strictEqual(wingFailure.produceModeLabel, 'W.I.N.G.篇');
assert.strictEqual(wingFailure.groupLabel, 'W.I.N.G.篇・半决赛／决赛');
assert.strictEqual(wingFailure.storyLabel, '敗退コミュ');
assert.strictEqual(monitor.inferTrainingCharacterId('produce_events', '700100102'), '001');
const commonProduceStory = monitor.classifyScenario('produce_events', '2000001001');
assert.strictEqual(commonProduceStory.category, 'produce-common');
assert.strictEqual(commonProduceStory.characterName, '樱木真乃');
assert.strictEqual(monitor.inferTrainingCharacterId('special_communications', '490300191'), '');

const birthday = monitor.classifyScenario('special_communications', '4902008013');
assert.strictEqual(birthday.category, 'special');
assert.strictEqual(birthday.characterName, '有栖川夏叶');
assert.strictEqual(birthday.groupCode, '4902008___');
assert.strictEqual(birthday.groupLabel, '2026年生日剧情');
assert.strictEqual(monitor.classifyScenario('special_communications', '490200101').groupLabel, '2019年生日剧情');
assert.strictEqual(monitor.classifyScenario('special_communications', '4902002001').groupLabel, '2020年生日剧情');
assert.strictEqual(monitor.classifyScenario('special_communications', '4902004001').groupLabel, '2022年生日剧情');
assert.strictEqual(monitor.classifyScenario('special_communications', '490210113').groupLabel, '2020年生日剧情');
assert.strictEqual(monitor.classifyScenario('special_communications', '490210113').characterId, '013');
assert.notStrictEqual(monitor.classifyScenario('special_communications', '490200001').specialKind, 'birthday');
const legacyBirthday = monitor.classifyScenario('special_communications', '490270010');
assert.strictEqual(legacyBirthday.category, 'special');
assert.strictEqual(legacyBirthday.characterName, '园田智代子');
assert.strictEqual(monitor.classifyScenario('special_communications', '490190001').category, 'special');
assert.strictEqual(monitor.classifyScenario('special_communications', '490180001').groupLabel, '2025年情人节剧情');
assert.strictEqual(monitor.classifyScenario('special_communications', '490190001').groupLabel, '2025年白色情人节剧情');
assert.strictEqual(monitor.classifyScenario('special_communications', '490220001').groupLabel, '2025年万圣节剧情');
assert.strictEqual(monitor.classifyScenario('special_communications', '490230001').groupLabel, '2025年圣诞节剧情');
assert.strictEqual(monitor.classifyScenario('special_communications', '490240001').groupLabel, '2026年情人节剧情');
assert.strictEqual(monitor.classifyScenario('mypage_communications', '490160001').groupLabel, '2024年万圣节剧情');
assert.strictEqual(monitor.classifyScenario('special_communications', '490170001').groupLabel, '2024年圣诞节剧情');
assert.strictEqual(monitor.classifyScenario('special_communications', '490300191').category, 'special');
assert.strictEqual(monitor.classifyScenario('special_communications', '490300191').groupCode, '49030____');

const decoratedBirthday = monitor.decorateSpecialEntries([{
    eventType: 'special_communications', eventId: '4902007005',
    storyTitle: '【田中 摩美々】 誕生日ミニコミュ⑥',
}])[0];
assert.strictEqual(
    monitor.childDisplayLine(decoratedBirthday),
    '4902007005 · 摩美美生日・【田中 摩美々】 誕生日ミニコミュ⑥',
);
const decorated2026Holiday = monitor.decorateSpecialEntries(Array.from({ length: 56 }, (_, index) => ({
    eventType: 'special_communications',
    eventId: `490240${String(index + 1).padStart(3, '0')}`,
})));
assert.strictEqual(decorated2026Holiday[0].stableStoryLabel, '真乃情人节01');
assert.strictEqual(decorated2026Holiday[1].stableStoryLabel, '真乃情人节02');
assert.strictEqual(decorated2026Holiday[2].stableStoryLabel, '灯织情人节01');
const splitHolidayLog = monitor.buildUpdateLog(decorated2026Holiday.map((entry, index) => Object.assign({}, entry, {
    updateDetectedAt: index < 2
        ? '2026-02-14T01:00:00+00:00'
        : (index < 4 ? '2026-02-15T01:00:00+00:00' : ''),
})));
assert.strictEqual(splitHolidayLog[0].children[0].children[0].stableStoryLabel, '灯织情人节01');
assert.strictEqual(splitHolidayLog[1].children[0].children[0].stableStoryLabel, '真乃情人节01');

const groupedCards = monitor.groupScenarioEntries([
    { eventType: 'produce_events', eventId: '201002011', unread: true, cardName: '【Candyならいらない】' },
    { eventType: 'produce_events', eventId: '201002002', unread: false },
    { eventType: 'produce_events', eventId: '201002001', unread: true },
]);
assert.strictEqual(groupedCards.length, 1);
assert.strictEqual(groupedCards[0].groupCode, '2010020__');
assert.strictEqual(groupedCards[0].unreadCount, 2);
assert.strictEqual(groupedCards[0].cardName, '【Candyならいらない】');
assert.deepStrictEqual(groupedCards[0].children.map(item => item.eventId), ['201002001', '201002002', '201002011']);

const namedActivity = monitor.groupScenarioEntries([
    { eventType: 'game_event_communications', eventId: '400109501', activityLabel: '第95次组活-跨组组活' },
    { eventType: 'game_event_communications', eventId: '400109502', activityLabel: '第95次组活-跨组组活' },
]);
assert.strictEqual(namedActivity[0].groupLabel, '第95次组活-跨组组活');

const categoryOrder = monitor.groupScenarioEntries([
    { eventType: 'special_communications', eventId: '490300191' },
    { eventType: 'produce_events', eventId: '300402701' },
    { eventType: 'produce_events', eventId: '201002001' },
    { eventType: 'game_event_communications', eventId: '400109501' },
]);
assert.deepStrictEqual(categoryOrder.map(group => group.category), [
    'game-event', 'produce-card', 'support-card', 'special',
]);

const hierarchy = monitor.buildScenarioHierarchy([
    { eventType: 'game_event_communications', eventId: '400109501', unread: false, activityLabel: '第95次组活-跨组组活' },
    { eventType: 'special_communications', eventId: '490300191', unread: true },
    { eventType: 'produce_events', eventId: '101000501', unread: true },
    { eventType: 'produce_communication_auditions', eventId: '501000100011', unread: false },
    { eventType: 'support_skills', eventId: '901099901', unread: false },
    { eventType: 'produce_events', eventId: '600100102', unread: false },
    { eventType: 'special_communications', eventId: '490180001', unread: false },
    { eventType: 'produce_events', eventId: '201002001', unread: false, cardName: '【Candyならいらない】' },
    { eventType: 'produce_events', eventId: '300502501', unread: true },
    { eventType: 'produce_events', eventId: '300502502', unread: false },
]);
assert.deepStrictEqual(hierarchy.map(node => node.label), ['活动', '育成', '特殊剧情', '角色']);
assert.deepStrictEqual(hierarchy.map(node => node.totalCount), [1, 4, 2, 3]);
assert.deepStrictEqual(hierarchy.map(node => node.unreadCount), [0, 1, 1, 1]);
const trainingRoot = hierarchy.find(node => node.treeKey === 'root/training');
const starsTraining = trainingRoot.children.find(node => node.label === '星组');
const manoTraining = starsTraining.children.find(node => node.label === '真乃');
const manoWing = manoTraining.children.find(node => node.label === 'W.I.N.G.篇');
const manoWingMisc = manoWing.children.find(node => node.label === '篇章杂项');
assert.strictEqual(manoWingMisc.children[0].label, 'W.I.N.G.篇・半决赛／决赛');
const houkagoTraining = trainingRoot.children.find(node => node.label === '放课后');
const chiyokoTraining = houkagoTraining.children.find(node => node.label === '智代子');
const chiyokoStep = chiyokoTraining.children.find(node => node.label === 'S.T.E.P.篇');
assert.strictEqual(chiyokoStep.children[0].label, '主线剧情');
const chiyokoWing = chiyokoTraining.children.find(node => node.label === 'W.I.N.G.篇');
const chiyokoWingMisc = chiyokoWing.children.find(node => node.label === '篇章杂项');
assert.strictEqual(chiyokoWingMisc.children.find(node => node.label === '试镜剧情').totalCount, 1);
assert.strictEqual(chiyokoWingMisc.children.find(node => node.label === '试镜剧情').trainingGroup, true);
const chiyokoTrainingMisc = chiyokoTraining.children.find(node => node.label === '育成模式杂项');
assert.strictEqual(chiyokoTrainingMisc.children.find(node => node.label === 'Support技能剧情').totalCount, 1);
assert.strictEqual(chiyokoTrainingMisc.children.find(node => node.label === 'Support技能剧情').trainingGroup, true);
const specialRoot = hierarchy.find(node => node.treeKey === 'root/special');
assert.strictEqual(specialRoot.children.find(node => node.label === '节日剧情').children[0].label, '2025年情人节剧情');
const characterRoot = hierarchy.find(node => node.treeKey === 'root/characters');
const lantica = characterRoot.children.find(node => node.label === '安提卡');
const mamimi = lantica.children.find(node => node.label === '摩美美');
assert.strictEqual(mamimi.description, '田中摩美美 · 角色 005');
const supportCards = mamimi.children.find(node => node.label === 'S卡');
assert.strictEqual(supportCards.unreadCount, 1);
assert.strictEqual(supportCards.children[0].label, '第25张');
assert.strictEqual(supportCards.children[0].code, '3005025__');
assert.deepStrictEqual(
    supportCards.children[0].children.map(item => item.eventId),
    ['300502501', '300502502'],
);
const houkago = characterRoot.children.find(node => node.label === '放课后');
const chiyoko = houkago.children.find(node => node.label === '智代子');
const produceCards = chiyoko.children.find(node => node.label === 'P卡');
assert.strictEqual(produceCards.children[0].label, '第20张 · 【Candyならいらない】');
assert.strictEqual(monitor.CHARACTER_SHORT_NAMES['091'], '叶月');
assert.strictEqual(monitor.CHARACTER_SHORT_NAMES['801'], '露比');
assert.strictEqual(monitor.CHARACTER_SHORT_NAMES['803'], 'MEM啾');
assert.strictEqual(monitor.UNITS.alstroemeria.label, '花组');
assert.strictEqual(monitor.UNITS.noctchill.label, '水组');
assert.strictEqual(monitor.UNITS.shhis.label, '嘘组');
assert.strictEqual(monitor.UNITS.cometik.label, '黑星');
assert.strictEqual(monitor.CHARACTER_UNITS['804'], 'lalalai');

const updateLog = monitor.buildUpdateLog([
    { eventType: 'produce_events', eventId: '201002001', unread: true, cardName: '【Candyならいらない】', updateDetectedAt: '2026-08-07T15:28:46+00:00' },
    { eventType: 'produce_events', eventId: '201002002', unread: false, updateDetectedAt: '2026-08-07T15:28:46+00:00' },
    { eventType: 'special_communications', eventId: '4902008013', unread: false, updateDetectedAt: '2026-08-07T15:28:46+00:00' },
    { eventType: 'game_event_communications', eventId: '400109501', unread: true, activityLabel: '第95次组活-跨组组活', updateDetectedAt: '2026-07-30T10:00:00+00:00' },
    { eventType: 'produce_events', eventId: '300502501', unread: false },
]);
assert.strictEqual(updateLog.length, 2);
assert.strictEqual(updateLog[0].children[0].label, '智代子-P · 【Candyならいらない】');
assert.strictEqual(updateLog[0].children.find(node => node.specialKind === 'birthday').label, '夏叶生日');
assert.strictEqual(updateLog[0].unreadCount, 1);
assert.strictEqual(updateLog[1].children[0].label, '第95次组活-跨组组活');

assert.strictEqual(monitor.childDisplayLine({
    eventType: 'produce_events', eventId: '100100101', storyTitle: '公園の歌声',
}), '100100101 · 01.公園の歌声');
assert.strictEqual(monitor.childDisplayLine({
    eventType: 'produce_events', eventId: '600100102', storyTitle: '敗退コミュ',
}), '600100102 · 敗退コミュ');
assert.strictEqual(monitor.childDisplayLine({
    eventType: 'produce_communication_auditions', eventId: '501000100011', storyTitle: 'オーディション前',
}), '501000100011 · オーディション前');
assert.strictEqual(monitor.childDisplayLine({
    eventType: 'produce_communication_auditions', eventId: '501000100019',
}), '501000100019');

const entries = monitor.extractScenarioEntries([
    'json/produce_events/300502501.json',
    '/assets/json/produce_events/300502501.json',
    'json/special_communications/101.json',
]);
assert.strictEqual(entries.length, 2);

const metadata = monitor.extractMetadataFromApi('userSupportIdols/123', {
    supportIdol: {
        id: '3005025',
        name: '【テストカード】田中摩美々',
        character: { id: '5' },
        produceSupportIdolEvents: [{ id: '300502501', title: '01.テスト' }],
    },
});
assert.deepStrictEqual(metadata, [{
    eventType: 'produce_events',
    eventId: '300502501',
    characterId: '005',
    characterName: '田中摩美美',
    characterNameJp: '田中摩美々',
    cardType: 'Support',
    cardId: '3005025',
    cardName: '【テストカード】田中摩美々',
    storyTitle: '01.テスト',
    metadataSource: 'official-game-api',
}]);
const implemented = monitor.applyImplementationStatus(entries, metadata, [
    'https://example.invalid/images/content/support_idols/card/3005025.jpg?version=1',
]);
const implementedSupport = implemented.find(item => item.eventId === '300502501');
assert.strictEqual(implementedSupport.scenarioStatus, 'available');
assert.strictEqual(implementedSupport.metadataStatus, 'available');
assert.strictEqual(implementedSupport.staticCardPath, 'images/content/support_idols/card/3005025.jpg');
assert.strictEqual(implementedSupport.staticCardStatus, 'available');
assert.strictEqual(implementedSupport.dynamicCardStatus, 'not-applicable');
const implementedSpecial = implemented.find(item => item.eventType === 'special_communications');
assert.strictEqual(implementedSpecial.metadataStatus, 'not-applicable');
assert.deepStrictEqual(monitor.extractCardResources([
    'images/content/idols/card/1040100200.jpg',
    'movies/idols/card/1040100200.mp4',
    'images/content/support_idols/card/2040050120.jpg',
]), [{
    key: 'Produce/1040100200', cardType: 'Produce', cardId: '1040100200',
    staticCardStatus: 'available', dynamicCardStatus: 'available',
    implementationSource: 'official-game-asset-map',
    staticCardPath: 'images/content/idols/card/1040100200.jpg',
    dynamicCardPath: 'movies/idols/card/1040100200.mp4',
}, {
    key: 'Support/2040050120', cardType: 'Support', cardId: '2040050120',
    staticCardStatus: 'available', dynamicCardStatus: 'not-applicable',
    implementationSource: 'official-game-asset-map',
    staticCardPath: 'images/content/support_idols/card/2040050120.jpg',
}]);
assert.strictEqual(
    monitor.displayLine(Object.assign({}, entries.find(item => item.eventId === '300502501'), metadata[0])),
    '田中摩美美 - 【テストカード】田中摩美々 - 300502501 - 01.テスト',
);

console.log('game-update-monitor: PASS');
