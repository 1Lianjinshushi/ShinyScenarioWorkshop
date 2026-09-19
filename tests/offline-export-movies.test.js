'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const OfflineFlow = require('../experiments/offline-export/flow.js');

test('offline movies advance only on virtual time, key to alpha, fire cue once, release bitmaps', async () => {
    let seconds = 0, fetches = 0, closes = 0, cues = 0;
    class MovieLayer {
        constructor() { this.stageObj = { addChild() {} }; }
        reset() { this._sprite = null; }
        _normalizeFadeSeconds(v, fallback) { return v == null ? fallback : v; }
        _createChromaKeyFilter(v) { return v || null; }
        _tweenAlpha(sprite, alpha) { sprite.alpha = alpha; }
    }
    const context = { MovieLayer, OfflineFlow, time: () => seconds,
        proof: { events: [], audioMetadata: {}, movieMetadata: { movie: {
            width: 20, height: 10, duration: 0.1, key: 'abc', timestamps: [0, 1/30, 2/30], hasAudio: false,
        } } },
        document: { createElement(name) {
            assert.equal(name, 'canvas');
            return { getContext: () => ({ clearRect() {}, drawImage() {} }) };
        } },
        PIXI: { Texture: { from: () => ({ update() {} }) }, Sprite: class { constructor(texture) { this.texture = texture; } } },
        fetch: async () => { fetches++; return { ok: true, blob: async () => ({}) }; },
        createImageBitmap: async () => ({ close() { closes++; } }),
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../experiments/offline-export/movies.js'), 'utf8')
        + '\nglobalThis.Layer = OfflineMovieLayer;', context);
    const layer = new context.Layer();
    const completed = layer.control('movie', { chromaKey: { threshold: 0.08 }, cueTimeSeconds: 0.05, onCue() { cues++; } });
    assert.equal(layer._sprite.filters.length, 1);
    await layer.updateOffline();
    await layer.updateOffline();
    assert.equal(fetches, 1, 'unchanged export time cannot advance movie or queue frames');
    for (seconds of [1/60, 2/60, 3/60, 4/60, 5/60, 6/60]) await layer.updateOffline();
    await completed;
    assert.equal(fetches, 3);
    assert.equal(closes, 3);
    assert.equal(cues, 1);
    assert.equal(layer.offline, null);
    assert.equal(context.proof.movies[0].decodedFrames, 3);
    assert.equal(context.proof.movies[0].lastFrame, 2);
});
