'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { ExportClock } = require('../experiments/offline-export/clock.js');
const OfflineFlow = require('../experiments/offline-export/flow.js');

function harness({ raw = [{ text: 'last' }, { label: 'end', textFrame: 'off' }],
    branchPreview = false, choiceNumber = 0, endHoldSeconds = 2, trimEnd = true } = {}) {
    const clock = new ExportClock();
    const context = { window: {}, exportOffline: true, exportClock: clock, OfflineFlow,
        PIXI: { utils: { EventEmitter } }, gsap: { ticker: { tick() {}, sleep() {} } } };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../experiments/offline-export/page.js'), 'utf8'), context);
    const proof = context.window.proof;
    const player = new EventEmitter();
    const counts = { forward: 0, play: 0, pause: 0, animation: 0, audio: 0, render: 0 };
    Object.assign(player, {
        _trackManager: { currentTrack: raw[0], currentIndex: 0, _nextLabel: null },
        _selectList: Object.assign(new EventEmitter(), { active: false }),
        _scenarioPlayer: { playing: false }, _movieLayer: {},
        _forward() { counts.forward++; }, _playTrack() { counts.play++; },
        pause() { counts.pause++; }, update() { counts.animation++; counts.audio++; },
    });
    Object.assign(proof, { player, raw, options: { branchPreview, endHoldSeconds, trimEnd },
        choiceNumber, branchTextCount: 2, outroIndex: -1,
        app: { renderer: { render() { counts.render++; } } }, captureSnapshot() {} });
    proof.installFlow();
    return { proof, player, counts, clock };
}

test('last dialogue remains live for 120 frames: no forward cleanup or pause during the hold', async () => {
    const { proof, player, counts } = harness();
    player._forward();
    for (let f = 0; f < 120; f++) {
        assert.equal((await proof.step(f, false)).done, false);
        player._forward(); // duplicate advance must not restart the deadline
        assert.equal(counts.forward, 0);
        assert.equal(counts.pause, 0);
    }
    assert.equal(counts.animation, 120);
    assert.equal(counts.audio, 120);
    assert.equal(counts.render, 120);
    assert.equal(player._trackManager.currentIndex, 0);
    assert.equal((await proof.step(120, false)).done, true);
    assert.equal(proof.endedAt, 2);
    assert.equal(counts.pause, 1);
    assert.equal(proof.events.filter(e => e.kind === 'ending-hold-start').length, 1);
});

test('early autoWait waits for both text and the natural voice end before starting two seconds', async () => {
    const { proof, player } = harness();
    player._scenarioPlayer.playing = true;
    player._currentVoiceEndHandler = {};
    player._forward();
    await proof.step(120, false);
    assert.equal(proof.ending.startedAt, null);
    player._scenarioPlayer.playing = false;
    await proof.step(180, false);
    assert.equal(proof.ending.startedAt, null);
    player._currentVoiceEndHandler = null;
    await proof.step(240, false);
    assert.equal(proof.ending.startedAt, 4);
    assert.equal((await proof.step(359, false)).done, false);
    assert.equal((await proof.step(360, false)).done, true);
});

test('producer looping bubble does not block finishing; zero-duration hold is supported', () => {
    const { proof, player } = harness({ endHoldSeconds: 0 });
    player._currentVoiceEndHandler = {};
    player._currentVoiceIsLooping = true;
    player._forward();
    assert.equal(proof.endedAt, 0);
});

for (const choiceNumber of [1, 2, 3]) {
    test(`full export holds only its final branch (choice ${choiceNumber})`, () => {
        const { proof, player, counts } = harness({ raw: [{ text: 'branch end' },
            { nextLabel: 'end' }, { select: 'choice elsewhere' }, { label: 'end', textFrame: 'off' }], choiceNumber });
        player._forward();
        assert.equal(!!proof.ending, choiceNumber === 3);
        assert.equal(counts.forward, choiceNumber === 3 ? 0 : 1);
    });
}

test('branch preview holds the second branch second line, not just an actual story ending', () => {
    const { proof, player } = harness({ raw: [{ text: 'second' }, { text: 'third' }, { select: 'choice' }],
        branchPreview: true, choiceNumber: 2 });
    player._forward();
    assert.equal(proof.ending.reason, 'two-lines-after-second-choice');
});

test('intermediate dialogue and untrimmed endings preserve original forward behavior', () => {
    for (const options of [{ raw: [{ text: 'line' }, { text: 'more' }] }, { trimEnd: false }]) {
        const { proof, player, counts } = harness(options);
        player._forward();
        assert.equal(proof.ending, undefined);
        assert.equal(counts.forward, 1);
    }
});
