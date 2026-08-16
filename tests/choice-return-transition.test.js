'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class EventEmitter {}
globalThis.PIXI = { utils: { EventEmitter } };
globalThis.SpeedMode = { MANUAL: 1, AUTO: 2 };
globalThis.WaitType = { TIME: 'time', EFFECT: 'effect' };

const source = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'AdvPlayer.js'), 'utf8');
vm.runInThisContext(`${source}\n;globalThis.AdvPlayer = AdvPlayer;`, { filename: 'AdvPlayer.js' });

async function main() {
    const movieCalls = [];
    const movieResolvers = [];
    const events = [];
    let movieResets = 0;
    let returns = 0;
    let pauses = 0;
    let soundStops = 0;
    const returnOptions = [];
    const player = Object.create(globalThis.AdvPlayer.prototype);
    Object.assign(player, {
        _lastChoiceCheckpoint: { startIndex: 10, pathBeforeChoice: [0, 1] },
        _trackManager: {},
        _choiceReturnTransitionPromise: null,
        _mode: SpeedMode.AUTO,
        _container: { visible: false },
        _mainController: { stageObj: { visible: true, interactiveChildren: true } },
        _interactionLayer: { interactive: true },
        _scenarioLogLayer: { hideImmediately() {} },
        _soundController: { removeAll() { soundStops++; } },
        _movieLayer: {
            control(url, options) {
                movieCalls.push({ url, options });
                return new Promise(resolve => movieResolvers.push(resolve));
            },
            reset() { movieResets++; },
        },
        pause() { pauses++; },
        returnToLastChoice(options) {
            returns++;
            returnOptions.push(options);
            return true;
        },
        emit(name, payload) { events.push({ name, payload }); },
    });

    const first = player.playChoiceReturnTransition('./assets/movies/choice_branch_return.mp4');
    const duplicate = player.playChoiceReturnTransition('./assets/movies/choice_branch_return.mp4');
    assert.strictEqual(duplicate, first, 'double taps must share one active transition');
    assert.equal(player._container.visible, true);
    assert.equal(player._mainController.stageObj.visible, true,
        'transparent opening must reveal the authored black scene, not an empty renderer');
    assert.equal(player._interactionLayer.interactive, false);
    assert.equal(player._isMoviePlaying, true);
    assert.equal(pauses, 1);
    assert.equal(soundStops, 1);

    assert.equal(returns, 0, 'the choice node must not be rebuilt before the colour cover');
    const { onCue, ...movieOptions } = movieCalls[0].options;
    assert.equal(typeof onCue, 'function');
    assert.deepEqual(movieOptions, {
        fadeInSeconds: 0,
        fadeOutSeconds: 0,
        cueTimeSeconds: 0.7,
        chromaKey: { threshold: 0.08, softness: 0.18, despill: 1 },
    });

    onCue();
    onCue();
    assert.equal(returns, 1, 'the opaque-cover cue must rebuild the choice exactly once');
    assert.deepEqual(returnOptions, [{ preserveMovie: true, restoreAuto: true }]);
    assert.equal(player._mainController.stageObj.visible, true);
    assert.equal(player._mainController.stageObj.interactiveChildren, false,
        'choice input must remain locked while the wipe retreats');
    assert.equal(player._interactionLayer.interactive, false);
    assert.equal(player._isMoviePlaying, true);

    movieResolvers[0]();
    assert.equal(await first, true);
    assert.equal(movieResets, 1);
    assert.equal(returns, 1);
    assert.equal(player._mainController.stageObj.visible, true);
    assert.equal(player._interactionLayer.interactive, true);
    assert.equal(player._isMoviePlaying, false);
    assert.equal(player._choiceReturnTransitionPromise, null);
    assert.deepEqual(events.map(event => event.name), [
        'choiceReturnTransitionStart',
        'choiceReturnTransitionEnd',
    ]);

    const second = player.playChoiceReturnTransition('./assets/movies/choice_branch_return.mp4');
    movieResolvers[1]();
    assert.equal(await second, true);
    assert.equal(movieCalls.length, 2, 'the transition must remain reusable after returning');
    assert.equal(returns, 2, 'early movie completion must fall back to rebuilding the choice');

    const leadPlayer = Object.create(globalThis.AdvPlayer.prototype);
    Object.assign(leadPlayer, {
        _tracks: [{ label: 'end' }],
        canReturnToLastChoice: () => true,
    });
    assert.equal(leadPlayer._choiceReturnLeadDelay({
        waitType: 'time', waitTime: 4000, nextLabel: 'end', bg: '00000',
    }, 4000), 3100, 'the terminal black hold should start the transition 0.9 s early');
    assert.equal(leadPlayer._choiceReturnLeadDelay({
        waitType: 'time', waitTime: 4000, nextLabel: 'missing', bg: '00000',
    }, 4000), null, 'a non-terminal scripted wait must remain untouched');

    console.log('choice-return-transition: PASS');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
