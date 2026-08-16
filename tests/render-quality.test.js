'use strict';

const assert = require('node:assert/strict');
const quality = require('../scripts/RenderQuality.js');

assert.equal(quality.calculateResolution({
    viewportWidth: 1280,
    viewportHeight: 720,
    devicePixelRatio: 1.5,
}), 1.75);

assert.equal(quality.calculateResolution({
    viewportWidth: 1707,
    viewportHeight: 960,
    devicePixelRatio: 1.5,
}), 2.25);

assert.equal(quality.calculateResolution({
    viewportWidth: 3840,
    viewportHeight: 2160,
    devicePixelRatio: 1.5,
}), 2.5);

assert.equal(quality.calculateResolution({
    viewportWidth: 800,
    viewportHeight: 450,
    devicePixelRatio: 1,
}), 1);

const options = quality.applicationOptions({
    devicePixelRatio: 1.5,
    document: { documentElement: { clientWidth: 1280, clientHeight: 720 } },
});
assert.equal(options.width, 1136);
assert.equal(options.height, 640);
assert.equal(options.resolution, 1.5);
assert.equal(options.textResolution, 1.25);
assert.equal(options.antialias, true);
assert.equal(options.autoDensity, true);

const highOptions = quality.applicationOptions({
    devicePixelRatio: 1.5,
    location: { search: '?quality=high' },
    document: { documentElement: { clientWidth: 1707, clientHeight: 960 } },
});
assert.equal(highOptions.resolution, 2.25);

const performanceOptions = quality.applicationOptions({
    devicePixelRatio: 2,
    location: { search: '?quality=performance' },
    document: { documentElement: { clientWidth: 1920, clientHeight: 1080 } },
});
assert.equal(performanceOptions.resolution, 1);

const editMetrics = quality.viewportMetrics({
    __scenarioReservedWidth: 400,
    devicePixelRatio: 1.5,
    document: { documentElement: { clientWidth: 1600, clientHeight: 900 } },
});
assert.equal(editMetrics.fullWidth, 1600);
assert.equal(editMetrics.reservedWidth, 400);
assert.equal(editMetrics.viewportWidth, 1200);

const fakeView = { style: {} };
const fakeInteraction = { resolution: 1 };
const resized = quality.resizeApplication({
    view: fakeView,
    renderer: { resolution: 1.5, resize() {}, plugins: { interaction: fakeInteraction } },
}, {
    __scenarioReservedWidth: 400,
    devicePixelRatio: 1,
    document: { documentElement: { clientWidth: 1600, clientHeight: 900 } },
});
assert.equal(fakeView.style.left, '600px');
assert.ok(resized.cssWidth <= 1200);
assert.equal(resized.textResolution, 1.25);
assert.equal(fakeInteraction.resolution, resized.resolution);

assert.equal(quality.calculateTextResolution({
    viewportWidth: 1707,
    viewportHeight: 960,
    devicePixelRatio: 1.5,
}), 1.5);

console.log('render-quality: PASS');
