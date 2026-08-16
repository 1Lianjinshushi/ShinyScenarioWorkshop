'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class MockContainer {
    constructor() { this.children = []; }
    addChild(child) { this.children.push(child); }
    removeChild(child) { this.children = this.children.filter(item => item !== child); }
}

class MockSprite {
    constructor(texture) {
        this.texture = texture;
        this.alpha = 1;
    }
}

class MockMedia {
    constructor() {
        this.listeners = new Map();
        this.currentTime = 0;
        this.duration = 10;
        this.ended = false;
        this.paused = true;
    }
    addEventListener(name, listener) {
        if (!this.listeners.has(name)) this.listeners.set(name, []);
        this.listeners.get(name).push(listener);
    }
    emit(name) { (this.listeners.get(name) || []).forEach(listener => listener()); }
    setAttribute() {}
    play() {
        this.paused = false;
        this.emit('playing');
        return Promise.resolve();
    }
    pause() { this.paused = true; this.emit('pause'); }
}

class MockFilter {
    constructor(vertex, fragment, uniforms) {
        this.vertex = vertex;
        this.fragment = fragment;
        this.uniforms = uniforms;
    }
}

async function main() {
    const video = new MockMedia();
    const tweens = [];
    const warnings = [];
    const animationFrames = new Map();
    const cues = [];
    let nextFrame = 1;
    const context = {
        ASSET_PATH: './assets',
        console: {
            log: console.log,
            error: console.error,
            warn(message) { warnings.push(message); },
        },
        document: {
            createElement(type) {
                if (type === 'video') return video;
                return new MockMedia();
            },
        },
        PIXI: {
            Container: MockContainer,
            Sprite: MockSprite,
            Filter: MockFilter,
            Texture: { from: () => ({ destroy() {} }) },
        },
        Power1: { easeInOut: 'easeInOut' },
        TweenMax: {
            to(target, seconds, props) {
                tweens.push({ from: target.alpha, to: props.alpha, seconds });
                target.alpha = props.alpha;
                if (props.onComplete) props.onComplete();
                return {};
            },
            killTweensOf() {},
        },
        requestAnimationFrame(callback) {
            const id = nextFrame++;
            animationFrames.set(id, callback);
            return id;
        },
        cancelAnimationFrame(id) { animationFrames.delete(id); },
        module: { exports: null },
    };
    vm.createContext(context);
    const source = fs.readFileSync(require.resolve('../scripts/MovieLayer.js'), 'utf8');
    vm.runInContext(`${source}\nmodule.exports = MovieLayer;`, context);
    const MovieLayer = context.module.exports;
    const layer = new MovieLayer();
    const finished = layer.control('1040100140', {
        cueTimeSeconds: 0.7,
        onCue(payload) { cues.push(payload); },
    });

    assert.deepStrictEqual(tweens[0], { from: 0, to: 1, seconds: 0.35 });
    video.currentTime = 0.6;
    animationFrames.get(layer._fadeMonitor)();
    assert.equal(cues.length, 0);
    video.currentTime = 0.8;
    animationFrames.get(layer._fadeMonitor)();
    assert.equal(cues.length, 1);
    assert.equal(cues[0].currentTime, 0.8);
    animationFrames.get(layer._fadeMonitor)();
    assert.equal(cues.length, 1, 'a playback cue must fire only once');

    video.currentTime = 9.8;
    const frame = animationFrames.get(layer._fadeMonitor);
    frame();
    assert.equal(layer._fadeOutStarted, true);
    assert.equal(tweens.at(-1).to, 0);
    assert.ok(tweens.at(-1).seconds <= 0.35);

    video.ended = true;
    video.emit('ended');
    await finished;
    assert.equal(layer._sprite.alpha, 0);
    video.emit('error');
    assert.deepEqual(warnings, [],
        'clearing a successfully completed movie must not report a false load failure');

    const keyed = layer._createChromaKeyFilter({ threshold: 0.1, softness: 0.2, despill: 0.9 });
    assert.ok(keyed instanceof MockFilter);
    assert.match(keyed.fragment, /greenDominance/);
    assert.match(keyed.fragment, /pixel\.a \*= alpha/);
    assert.match(keyed.fragment, /pixel\.rgb \*= alpha/,
        'keyed pixels must become transparent instead of being painted black');
    assert.deepEqual(JSON.parse(JSON.stringify(keyed.uniforms)),
        { threshold: 0.1, softness: 0.2, despill: 0.9 });
    console.log('movie-layer-fade: PASS');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
