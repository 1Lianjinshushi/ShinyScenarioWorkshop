'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

globalThis.PIXI = {
    Loader: { shared: { resources: {} } },
    sound: { volumeAll: 1 },
};
globalThis.UI_INTERACTION_VOLUME = 0.35;

function makeSound(duration = 1) {
    const instances = [];
    return {
        duration,
        volume: 1,
        instances,
        play(options) {
            const instance = {
                options,
                volume: 1,
                stopCalls: 0,
                stop() { this.stopCalls++; },
            };
            instances.push(instance);
            return instance;
        },
    };
}

const bgmSound = makeSound(120);
const firstVoiceSound = makeSound(2);
const secondVoiceSound = makeSound(3);
const uiSound = makeSound(1);
PIXI.Loader.shared.resources = {
    bgm: { url: 'bgm', sound: bgmSound },
    voice1: { url: 'voice1', sound: firstVoiceSound },
    voice2: { url: 'voice2', sound: secondVoiceSound },
    uiTapSe: { url: 'ui-tap', sound: uiSound },
};

const controllerPath = path.resolve(__dirname, '..', 'scripts', 'SoundController.js');
const controllerSource = `${fs.readFileSync(controllerPath, 'utf8')}\n;globalThis.SoundController = SoundController;`;
vm.runInThisContext(controllerSource, { filename: controllerPath });

const controller = new SoundController({ masterVolume: 1, bgmVolume: 1, voiceVolume: 1 });
controller.playSeUrl('uiTapSe');
assert.equal(uiSound.instances[0].volume, 0.35,
    'button interaction sounds should use the quieter UI-only mix');
controller.control('bgm', 'bgm');
const bgmInstance = bgmSound.instances[0];
assert.ok(bgmInstance, 'BGM should start');
assert.equal(bgmInstance.options.loop, true, 'BGM should loop');

controller.control('voice', 'voice1');
assert.equal(bgmInstance.stopCalls, 0, 'Starting voice must not stop BGM');

const firstVoiceInstance = firstVoiceSound.instances[0];
controller.control('voice', 'voice2');
assert.equal(firstVoiceInstance.stopCalls, 1, 'A new voice should stop only the previous voice');
assert.equal(bgmInstance.stopCalls, 0, 'Replacing voice must not stop BGM');
assert.equal(controller._currentBgm, bgmInstance, 'BGM instance must remain active');

controller.control('bgm', 'bgm');
assert.equal(bgmSound.instances.length, 1, 'Repeated identical BGM commands must not restart the track');
assert.equal(bgmInstance.stopCalls, 0, 'Repeated identical BGM commands must not stop the track');

// pixi-sound pools media instances across different Sound resources. A BGM
// instance stopped during an unfinished fade can therefore be reused by the
// next BGM while the stale tween still targets the same JavaScript object.
// Completing that stale tween must never stop/clear the replacement BGM.
let pendingFade = null;
let killedFadeTargets = 0;
globalThis.gsap = {
    to(target, options) {
        pendingFade = { target, options };
        return {};
    },
    killTweensOf(target) {
        if (pendingFade && pendingFade.target === target) killedFadeTargets++;
    },
};

const pooledBgmInstance = {
    volume: 1,
    loop: false,
    stopCalls: 0,
    stop() { this.stopCalls++; },
};
function pooledSound() {
    return {
        duration: 30,
        volume: 1,
        play(options) {
            pooledBgmInstance.options = options;
            pooledBgmInstance.volume = 1;
            return pooledBgmInstance;
        },
    };
}
PIXI.Loader.shared.resources.oldBgm = { url: 'oldBgm', sound: pooledSound() };
PIXI.Loader.shared.resources.newBgm = { url: 'newBgm', sound: pooledSound() };

const pooledController = new SoundController({ masterVolume: 1, bgmVolume: 1 });
pooledController.control('bgm', 'oldBgm');
pooledController.control('bgm', 'fade_out', 5000);
const staleFade = pendingFade;
pooledController.control('bgm', 'newBgm');

assert.ok(killedFadeTargets > 0, 'Replacing a fading BGM must kill its stale volume tween');
assert.equal(pooledBgmInstance.loop, true, 'Replacement BGM instance must remain explicitly looped');
assert.equal(pooledBgmInstance.stopCalls, 1, 'Only the old pooled BGM should be stopped during replacement');
staleFade.options.onComplete();
assert.equal(pooledBgmInstance.stopCalls, 1, 'Stale fade completion must not stop the reused BGM instance');
assert.equal(pooledController._currentBgm, pooledBgmInstance, 'Replacement BGM must remain controller-owned');
assert.equal(pooledController._currentBgmUrl, 'newBgm', 'Replacement BGM URL must not be cleared by stale fade');

// The LOG button is special: opening the overlay synchronously pauses the
// scenario's SE/voice.  Its tap sound therefore has to start after the LOG
// control event, otherwise the ding can freeze and only continue on close.
const mainControllerSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'scripts', 'MainController.js'),
    'utf8',
);
assert.match(
    mainControllerSource,
    /'log_button\.png',[\s\S]*?_onTapLog\(\),\s*0\.5,\s*0\.5,\s*false\)/,
    'LOG must suppress the generic pointer-down tap sound',
);
const logTapMethod = mainControllerSource.match(/_onTapLog\(\)\s*\{([\s\S]*?)\n\s*\}/);
assert.ok(logTapMethod, 'LOG tap handler should exist');
assert.ok(
    logTapMethod[1].indexOf("this.emit('control', CONTROL_PRESETS.LOG)")
        < logTapMethod[1].indexOf('this._playUiSe()'),
    'LOG tap sound must start after the synchronous pause/open event',
);

console.log('sound-controller-regression: PASS');
