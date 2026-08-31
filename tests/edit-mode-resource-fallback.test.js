'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fallback = require('../scripts/EditModeResourceFallback.js');

const remoteStill = 'https://service.sc-viewer.top/custom/images/content/support_idols/card/301302801.jpg';
const remoteMovie = 'https://service.sc-viewer.top/custom/movies/idols/card/1040130280.mp4';
const cachedStill = 'https://service.sc-viewer.top/custom/images/content/idols/card/1040280060.jpg';
const remoteSpine = 'https://service.sc-viewer.top/custom/spine/idols/stand/1040280060/data.json';
const eventStill = 'https://service.sc-viewer.top/custom/images/event/still/90001.jpg';
const background = 'https://service.sc-viewer.top/custom/images/event/bg/00001.jpg';

function makeTracks() {
    return [
        { charStill: remoteStill, text: '未实装卡图前的对白' },
        { movie: remoteMovie },
        { charStill: cachedStill },
        { charSpine: remoteSpine, charAnim1: 'wait' },
        { still: eventStill, bg: background },
    ];
}

const localSources = new Map([
    [cachedStill, './assets/images/content/idols/card/1040280060.jpg'],
]);

const normalTracks = makeTracks();
const normalResult = fallback.apply(normalTracks, localSources, { enabled: false });
assert.deepEqual(normalResult.skipped, []);
assert.equal(normalTracks[0].charStill, remoteStill);
assert.equal(normalTracks[1].movie, remoteMovie);
assert.equal(normalTracks[2].charStill, cachedStill);
assert.equal(normalTracks[3].charSpine, remoteSpine);
assert.equal(normalTracks[4].still, eventStill);
assert.equal(normalTracks[4].bg, background);

const editTracks = makeTracks();
const editResult = fallback.apply(editTracks, localSources, { enabled: true });
assert.deepEqual(
    editResult.skipped.map(item => [item.trackIndex, item.field]),
    [[0, 'charStill'], [1, 'movie']],
);
assert.equal(editTracks[0].charStill, undefined,
    'uncached static card art should not block edit mode');
assert.equal(editTracks[1].movie, undefined,
    'uncached animated card art should not block edit mode');
assert.equal(editTracks[2].charStill, cachedStill,
    'already cached card art remains visible in edit mode');
assert.equal(editTracks[3].charSpine, remoteSpine,
    'character staging remains part of the edit-mode picture');
assert.equal(editTracks[4].still, eventStill,
    'scenario stills are not card-art fallbacks and must remain required');
assert.equal(editTracks[4].bg, background,
    'ordinary scene resources must remain required');

const root = path.resolve(__dirname, '..');
const remoteMain = fs.readFileSync(path.join(root, 'remote-main.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(remoteMain, /EditModeResourceFallback\.apply\(tracks, resourceSources, \{ enabled: editMode \}\)/,
    'the fallback must be gated by editMode so normal Japanese/Chinese playback is unchanged');
assert.match(remoteMain, /const preloadUrls = converter\.extractResourceList\(tracks\)/,
    'the loader list must be rebuilt after optional edit-mode card media is removed');
assert.match(indexHtml, /scripts\/EditModeResourceFallback\.js/);

console.log('edit-mode-resource-fallback: PASS');
