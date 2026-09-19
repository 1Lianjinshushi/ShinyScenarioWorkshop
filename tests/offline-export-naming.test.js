'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { resolveNames, publishVideo, checkedDirectory, safePart } = require('../experiments/offline-export/naming.cjs');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ssv-naming-'));
    t.after(() => { assert(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true }); });
    const write = (name, data) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); };
    write('metadata/scenario-library-groups.json', { cards: { '3026009': { cardName: '【she sees】' } } });
    write('metadata/scenario-titles.json', { entries: {
        'produce_events/302600901': { storyTitle: '片方' },
        'produce_events/302600902': { storyTitle: '02.もう片方' },
        'produce_events/201002011': { storyTitle: 'なんて　アイドル', cardName: '【Candyならいらない】' }
    } });
    const job = { eventId: '302600901', eventType: 'produce_events', language: 'zh-cn', mode: 'offline' };
    return { root, write, job };
}
test('library card names and per-episode titles match without doubled numbering', t => {
    const { root, job } = fixture(t);
    assert.equal(resolveNames(root, job).folder, '路加S卡・【she sees】');
    assert.equal(resolveNames(root, job).title, '01.片方');
    assert.equal(resolveNames(root, { ...job, eventId: '302600902' }).title, '02.もう片方');
    assert.equal(resolveNames(root, { ...job, eventId: '201002011' }).title, 'TE.なんて　アイドル');
});
test('game-observed names override stale metadata, with blanks filled from library', t => {
    const { root, write, job } = fixture(t);
    write('monitor/game-update-state.json', { entries: { key: { ...job, storyTitle: '新标题', cardName: '【新卡名】' } } });
    assert.equal(resolveNames(root, job).title, '01.新标题');
    assert.equal(resolveNames(root, job).folder, '路加S卡・【新卡名】');
    write('monitor/game-update-state.json', { entries: { key: { ...job, storyTitle: '' } } });
    assert.equal(resolveNames(root, job).title, '01.片方');
});
test('unknown titles retain IDs; Japanese and preview videos are distinguishable', t => {
    const { root, job } = fixture(t);
    const missing = resolveNames(root, { ...job, eventId: '302600903' });
    assert(missing.missingTitle); assert.match(missing.title, /302600903/);
    assert.equal(resolveNames(root, { ...job, language: 'ja', mode: 'branch-preview' }).title, '01.片方【日文】【选择支样片】');
});
test('specials keep semantic labels rather than card/TE numbering', t => {
    const { root, job } = fixture(t);
    const birthday = resolveNames(root, { ...job, eventType: 'special_communications', eventId: '4902008013' });
    assert.equal(birthday.folder, '2026年生日剧情'); assert.equal(birthday.title, '夏叶生日');
});
test('publication preserves bytes, refuses overwrite, and URL-encodes title characters', t => {
    const { root, job } = fixture(t), source = path.join(root, 'video.mp4');
    fs.writeFileSync(source, Buffer.from([0, 1, 2, 255]));
    const first = publishVideo(root, job, source), second = publishVideo(root, job, source);
    assert.equal(first.outputName, '01.片方.mp4'); assert.equal(second.outputName, '01.片方 (2).mp4');
    assert.deepEqual(fs.readFileSync(first.outputPath), fs.readFileSync(source));
    assert.deepEqual(fs.readFileSync(second.outputPath), fs.readFileSync(source));
    assert.equal(decodeURIComponent(first.outputUrl), '/exports/offline-videos/路加S卡・【she sees】/01.片方.mp4');
    assert(fs.existsSync(source));
});
test('Windows invalid/reserved names and traversal are handled safely', t => {
    const { root } = fixture(t);
    assert.equal(safePart('CON', 'fallback', 70), '_CON');
    assert.doesNotMatch(safePart('a:b?c/.. ', 'fallback', 70), /[:?\/]/);
    assert.throws(() => checkedDirectory(root, path.dirname(root)), /outside/);
    const linked = path.join(root, 'linked'); fs.symlinkSync(os.tmpdir(), linked, 'junction');
    try { assert.throws(() => checkedDirectory(root, path.join(linked, 'child')), /Linked/); }
    finally { fs.unlinkSync(linked); }
});
