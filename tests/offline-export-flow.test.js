'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const flow = require('../experiments/offline-export/flow.js');

test('story progress counts each branch node once and ignores return transitions', () => {
    const tracks = [{ bg: 'scene' }, { text: 'intro' }, { select: 'middle' }, { select: 'left' },
        { select: 'right' }, { label: 'middle', text: 'middle line' }, { movie: 'return' },
        { label: 'left', text: 'left line' }, { label: 'right', text: 'right line' }, { bg: '00000' }];
    const nodes = new Set(flow.storyNodeIndices(tracks));
    assert.deepEqual([...nodes], [1, 2, 3, 4, 5, 6, 7, 8]);
    const visited = new Set();
    for (const index of [1, 2, 3, 4, 5, 6, 2, 3, 4, 7, 2, 3, 4, 8]) {
        if (nodes.has(index)) visited.add(index);
    }
    assert.equal(visited.size, nodes.size);
});

test('choices are ordered by actual screen position, not assumed source order', () => {
    const left = { x: 212 }, mid = { x: 564 }, right = { x: 912 };
    assert.deepEqual(flow.choiceOrder([right, mid, left]), [mid, left, right]);
    assert.deepEqual(flow.choiceOrder([left]), [left]);
    assert.throws(() => flow.choiceOrder([left, right]), /exactly one or three/);
});
test('preview begins at the second preceding text, retaining intervening silent nodes', () => {
    assert.equal(flow.previewStart([{ text: 'a' }, {}, { text: 'b' }, {}, { text: 'c' }, { select: '1' }]), 2);
});
test('only final silent fade is omitted, never a story movie or intermediate scene fade', () => {
    const tracks = [{ text: 'a' }, { bg: '00000', bgEffect: 'fade' }, { movie: 'x' },
        { text: 'b' }, { bg: '00000', bgEffect: 'fade', waitTime: 4000 }, { label: 'end' }];
    assert.equal(flow.terminalOutro(tracks), 4);
    assert.equal(flow.terminalOutro([{ text: 'a' }, { bg: '00000', bgEffect: 'fade', se: 'x' }, { label: 'end' }]), -1);
});
test('movie frames follow source timestamps including repeated 30fps frames in 60fps output', () => {
    const pts = [0, 1 / 30, 2 / 30, 0.12];
    assert.deepEqual([0, 1/60, 2/60, 3/60, 4/60, 6/60].map(t => flow.movieFrame(pts, t)), [0, 0, 1, 1, 2, 2]);
    assert.equal(flow.movieFrame(pts, 2), 3);
});

test('final dialogue is held before terminal hiding/removal/fade, along the actual route', () => {
    const tracks = [{ text: 'last' },
        { charLabel: 'idol', charAnim1: 'wait', charEffect: { type: 'to', alpha: 0, time: 100 } },
        { textFrame: 'off', bg: '00000', bgEffect: 'fade', waitType: 'time', waitTime: 4000,
            bgEffectTime: 2000, bgmFadeTime: 4000, se: 'outro', nextLabel: 'end' },
        { text: 'another branch' }, { label: 'end', textFrame: 'off' }];
    const before = JSON.stringify(tracks);
    assert.equal(flow.terminalDialogue(tracks, 0), true);
    assert.equal(flow.terminalDialogue(tracks, 0, 'end'), true);
    assert.equal(flow.terminalDialogue(tracks, 0, 'missing'), false);
    assert.equal(JSON.stringify(tracks), before);
    assert.equal(flow.terminalDialogue([{ text: 'last' }], 0), true);
});

test('terminal detection never skips new dialogue, silent story actions, movies or standalone sound', () => {
    for (const next of [{ text: 'more' }, { select: 'choice' }, { movie: 'movie' },
        { charAnim1: 'happy' }, { waitTime: 3000 }, { se: 'story' }, { bg: '00001' },
        { bg: '00000', bgEffect: 'fade', voice: 'story' }, { textFrame: '001' }]) {
        assert.equal(flow.terminalDialogue([{ text: 'line' }, next, { label: 'end' }], 0), false);
    }
    assert.equal(flow.terminalDialogue([{ text: 'line' }, { label: 'loop', nextLabel: 'loop' }], 0), false);
    assert.equal(flow.terminalDialogue([{ textFrame: 'off' }, { label: 'end' }], 0), false);
});
