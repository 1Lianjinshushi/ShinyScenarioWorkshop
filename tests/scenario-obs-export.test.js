'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadApi(search, supported = []) {
    class RecorderStub {}
    RecorderStub.isTypeSupported = mime => supported.includes(mime);
    const context = {
        URLSearchParams,
        location: { search },
        MediaRecorder: RecorderStub,
        console,
        globalThis: null,
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.resolve(__dirname, '../scripts/ScenarioObsExport.js'), 'utf8'),
        context,
    );
    return context.ScenarioObsExport;
}

test('OBS export requires its dedicated mode and job id', () => {
    assert.equal(loadApi('?mode=obs-export&obsJob=abc').requested(), true);
    assert.equal(loadApi('?mode=obs-export').requested(), false);
});

test('OBS export records a lightweight Opus-only stream', () => {
    const api = loadApi('', ['audio/webm;codecs=opus', 'audio/webm']);
    assert.equal(api.chooseAudioMimeType(), 'audio/webm;codecs=opus');
    const source = fs.readFileSync(path.resolve(__dirname, '../scripts/ScenarioObsExport.js'), 'utf8');
    assert.match(source, /createMediaStreamDestination\(\)/);
    assert.match(source, /obs-export\/audio-chunk/);
    assert.doesNotMatch(source, /captureStream\(/,
        'OBS mode must never record the 1080p canvas in Chromium memory');
});

test('OBS starts audio and video before the independent clock and scenario', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../remote-main.js'), 'utf8');
    const ready = source.indexOf('await ScenarioObsExport.ready()');
    const clock = source.indexOf('await ScenarioObsExport.startFrameDriver');
    const preroll = source.indexOf('await ScenarioObsExport.waitForPreroll(800)');
    const scenario = source.indexOf('advPlayer.start(tracks)');
    assert.ok(ready >= 0 && ready < clock);
    assert.ok(clock < preroll && preroll < scenario);
});
