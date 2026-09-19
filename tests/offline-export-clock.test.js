'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ExportClock } = require('../experiments/offline-export/clock');
test('offline timers follow virtual deadlines, not render throughput', () => {
    const clock = new ExportClock();
    const fired = [];
    clock.setTimeout(() => { fired.push(clock.ms); clock.setTimeout(() => fired.push(clock.ms), 20); }, 10);
    const cancelled = clock.setTimeout(() => assert.fail('cancelled timer'), 15);
    clock.clearTimeout(cancelled);
    clock.advanceTo(35);
    assert.deepEqual(fired, [10, 30]);
    assert.equal(clock.ms, 35);
    assert.throws(() => clock.advanceTo(34));
});
