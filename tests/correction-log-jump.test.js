'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class EventEmitter {
    on() { return this; }
    emit() { return this; }
}

globalThis.PIXI = {
    utils: { EventEmitter },
    Rectangle: class Rectangle {
        constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); }
    },
};

function loadClass(file, name) {
    const source = `${fs.readFileSync(file, 'utf8')}\n;globalThis.${name} = ${name};`;
    vm.runInThisContext(source, { filename: file });
    return globalThis[name];
}

const trackManagerPath = path.resolve(__dirname, '..', 'scripts', 'TrackManager.js');
const logLayerPath = path.resolve(__dirname, '..', 'scripts', 'ScenarioLogLayer.js');
const TrackManager = loadClass(trackManagerPath, 'TrackManager');
const ScenarioLogLayer = loadClass(logLayerPath, 'ScenarioLogLayer');
const advPlayerPath = path.resolve(__dirname, '..', 'scripts', 'AdvPlayer.js');
const AdvPlayer = loadClass(advPlayerPath, 'AdvPlayer');
const selectListPath = path.resolve(__dirname, '..', 'scripts', 'SelectList.js');
const SelectList = loadClass(selectListPath, 'SelectList');

const manager = new TrackManager([{ id: 1 }, { id: 2 }, { id: 3 }]);
manager.forward();
manager.nextLabel = 'unused';
assert.equal(manager.seekToIndex(0).id, 1);
assert.equal(manager.currentIndex, 0);
assert.throws(() => manager.seekToIndex(3), RangeError);

const log = Object.create(ScenarioLogLayer.prototype);
log._tracks = [];
log._container = { visible: false };
log.stackTrack({ text: 'first', textCtrl: 'l' }, { trackIndex: 4, historyPosition: 8 });
log.stackTrack({ text: 'second', textCtrl: 'p' }, { trackIndex: 5, historyPosition: 9 });
assert.equal(log._tracks.length, 1, 'continued text should remain one visible log sentence');
assert.equal(log._tracks[0].text, 'first\nsecond');
assert.equal(log._tracks[0].trackIndex, 4, 'jump target should be the beginning of the visible sentence');
assert.equal(log._tracks[0].historyPosition, 8);
assert.equal(log._tracks[0].endTrackIndex, 5);
assert.equal(log._tracks[0].endHistoryPosition, 9);
assert.equal(log.updateTrackText(5, 9, 'updated'), true);
assert.equal(log._tracks[0].text, 'first\nupdated',
    'live corrections should update the composed sentence stored by the log');

const selectList = Object.create(SelectList.prototype);
selectList._items = [{
    _metadata: { trackIndex: 12, historyPosition: 18 },
    _textObj: { text: 'old choice' },
    _textValue: 'old choice',
    _ssvChoiceText: 'old choice',
}];
assert.equal(selectList.updateItemText(12, 18, 'updated choice'), true);
assert.equal(selectList._items[0]._textObj.text, 'updated choice',
    'live choice corrections should update the visible option card');
assert.equal(selectList._items[0]._ssvChoiceText, 'updated choice',
    'keyboard selection must use the corrected option text');

function interactiveEntry() {
    const listeners = new Map();
    return {
        _entryHeight: 50,
        alpha: 1,
        on(name, listener) { listeners.set(name, listener); return this; },
        listeners,
    };
}

const disabledEntry = interactiveEntry();
log._jumpEnabled = false;
log._makeJumpable(disabledEntry, { trackIndex: 1 }, 840);
assert.equal(disabledEntry.interactive, undefined, 'ordinary playback log must stay read-only');

const enabledEntry = interactiveEntry();
log._jumpEnabled = true;
log._makeJumpable(enabledEntry, { trackIndex: 1, historyPosition: 2 }, 840);
assert.equal(enabledEntry.interactive, true, 'correction-mode log entries should be clickable');
assert.equal(enabledEntry.hitArea.width, 840);

const advSource = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'AdvPlayer.js'), 'utf8');
assert.match(advSource, /pathBeforeTarget\.forEach/,
    'jumping must rebuild the actually visited path before replaying the target');
assert.match(advSource, /this\._playHistory\[historyPosition\] !== trackIndex/,
    'stale log entries must be rejected instead of jumping to an unrelated track');

const rebuilt = [];
let playedTarget = null;
let selectResets = 0;
const tracks = [{ bg: 'a' }, { select: 'choice' }, {}, {}, {}, { text: 'target' }];
const jumpPlayer = Object.create(AdvPlayer.prototype);
Object.assign(jumpPlayer, {
    _logJumpEnabled: true,
    _trackManager: new TrackManager(tracks),
    _tracks: tracks,
    _playHistory: [0, 1, 5],
    _currentHistoryPosition: 2,
    _scenarioLogLayer: {
        hideImmediately() {},
        clear() {},
    },
    _selectList: { reset() { selectResets++; } },
    _mainController: { setManualMode() {} },
    _soundController: { setSoundDisabled() {} },
    _resetForLogJump() {},
    _applyHistoricalTrack(track, index) { rebuilt.push(index); },
    _changeToFree() {},
    resume() {},
    _playTrack(track) { playedTarget = track; },
    emit() {},
});
jumpPlayer._jumpToLogEntry({ trackIndex: 5, historyPosition: 2, text: 'target' });
assert.deepEqual(rebuilt, [0, 1], 'only the visited path before the selected sentence should be rebuilt');
assert.equal(jumpPlayer._trackManager.currentIndex, 5);
assert.equal(playedTarget, tracks[5], 'the selected sentence should be replayed normally after reconstruction');
assert.equal(selectResets, 1, 'a completed choice menu must not survive into the branch dialogue');

const checkpointPlayer = Object.create(AdvPlayer.prototype);
Object.assign(checkpointPlayer, {
    _pendingSelectEntries: [{ index: 5, historyPosition: 2 }],
    _playHistory: [0, 4, 5, 6],
    emit() {},
    _changeToLocked() {},
});
checkpointPlayer._onAppearSelectList();
assert.deepEqual(checkpointPlayer._lastChoiceCheckpoint, {
    startIndex: 5,
    pathBeforeChoice: [0, 4],
}, 'the latest selection screen should retain the visited path before its first option');

const choiceTracks = [{ bg: 'before-choice' }, { select: 'A' }, { select: 'B' }, { text: 'branch' }];
const rebuiltChoicePath = [];
let replayedChoice = null;
let choiceEvent = null;
const returnPlayer = Object.create(AdvPlayer.prototype);
Object.assign(returnPlayer, {
    _lastChoiceCheckpoint: { startIndex: 1, pathBeforeChoice: [0] },
    _trackManager: new TrackManager(choiceTracks),
    _tracks: choiceTracks,
    _playHistory: [0, 1, 3],
    _currentHistoryPosition: 2,
    _scenarioLogLayer: { hideImmediately() {}, clear() {} },
    _mainController: { setManualMode() {} },
    _soundController: { setSoundDisabled() {} },
    _resetForLogJump() {},
    _applyHistoricalTrack(track, index) { rebuiltChoicePath.push(index); },
    _changeToFree() {},
    resume() {},
    _playTrack(track) { replayedChoice = track; },
    emit(name, payload) { if (name === 'choiceReturn') choiceEvent = payload; },
});
assert.equal(returnPlayer.returnToLastChoice(), true);
assert.deepEqual(rebuiltChoicePath, [0]);
assert.equal(returnPlayer._trackManager.currentIndex, 1);
assert.equal(replayedChoice, choiceTracks[1]);
assert.equal(choiceEvent.index, 1);

globalThis.SpeedMode = { MANUAL: 'MANUAL' };
globalThis.State = { PLAYING: 'PLAYING', WAITING: 'WAITING', LOCKED: 'LOCKED' };
let correctionWaitSkips = 0;
const lockedCorrectionPlayer = Object.create(AdvPlayer.prototype);
Object.assign(lockedCorrectionPlayer, {
    _mode: SpeedMode.MANUAL,
    _state: State.LOCKED,
    _logJumpEnabled: true,
    _currentSkipActionType: 'time',
    _schedule: { hasEvents: true },
    emit() {},
    _forceEndSkippableTrack() { correctionWaitSkips++; },
});
lockedCorrectionPlayer._onTap();
assert.equal(correctionWaitSkips, 1,
    'a correction-mode tap should complete a scripted black-screen time wait');

const lockedNormalPlayer = Object.create(AdvPlayer.prototype);
Object.assign(lockedNormalPlayer, {
    _mode: SpeedMode.MANUAL,
    _state: State.LOCKED,
    _logJumpEnabled: false,
    _currentSkipActionType: 'time',
    _schedule: { hasEvents: true },
    emit() {},
    _forceEndSkippableTrack() { correctionWaitSkips++; },
});
lockedNormalPlayer._onTap();
assert.equal(correctionWaitSkips, 1,
    'ordinary playback must keep the authored black-screen wait');

const editModeSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'scripts', 'ScenarioEditMode.js'),
    'utf8',
);
assert.match(editModeSource, /导出编辑后 CSV/);
assert.match(editModeSource, /updateLogTrackText/,
    'editing a translation should immediately update its log snapshot');
assert.match(editModeSource, /field\.addEventListener\('keydown'/,
    'editor textareas must own their keyboard events so arrow-key cursor movement is preserved');
assert.match(editModeSource, /event\.stopPropagation\(\)/,
    'editor keystrokes must not leak into player-wide hotkeys');
assert.match(editModeSource, /class="scenario-edit-copy"[\s\S]*?aria-label="复制本句日文"/,
    'edit mode should offer an accessible copy icon for the current Japanese line');
assert.match(editModeSource, /navigator\.clipboard\.writeText\(text\)/,
    'current Japanese text should use the browser clipboard API');
assert.match(editModeSource, /document\.execCommand\('copy'\)/,
    'copying should keep a fallback for browsers without the clipboard API');

const ScenarioEditMode = require('../scripts/ScenarioEditMode.js');
const fakeTextarea = {
    value: '第一行\n第二行',
    selectionStart: 7,
    selectionEnd: 7,
    selectionDirection: 'none',
    setSelectionRange(start, end, direction = 'none') {
        Object.assign(this, { selectionStart: start, selectionEnd: end, selectionDirection: direction });
    },
};
const arrowEvent = {
    key: 'ArrowUp',
    preventDefault() { this.defaultPrevented = true; },
};
assert.equal(ScenarioEditMode.moveTextareaCaret(fakeTextarea, arrowEvent), false);
assert.equal(fakeTextarea.selectionStart, 7,
    'ArrowUp must remain native so the browser can navigate visual rows created by soft wrapping');
assert.equal(arrowEvent.defaultPrevented, undefined);

const selectHitFixSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'scripts', 'SelectListHitFix.js'),
    'utf8',
);
assert.match(selectHitFixSource, /addItemWithStableHitArea\(text, nextLabel, metadata/,
    'the hit-area wrapper must preserve choice edit metadata');
assert.match(selectHitFixSource, /call\(this, text, nextLabel, metadata\)/,
    'choice metadata must reach the underlying SelectList item');

const logSource = fs.readFileSync(logLayerPath, 'utf8');
assert.match(logSource, /_setupScrollbarInteraction\(\)/,
    'the visible scrollbar must have pointer interaction handlers');
assert.match(logSource, /sb\.scale\.set\(0\.90\)/,
    'log voice replay should provide pressed-state feedback');

console.log('correction-log-jump: PASS');
