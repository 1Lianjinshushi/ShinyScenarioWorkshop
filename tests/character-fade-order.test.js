'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class CharacterStage {
    constructor() {
        this.calls = [];
    }

    control(params) {
        this.calls.push(params);
        return `call-${this.calls.length}`;
    }
}

const source = fs.readFileSync(require.resolve('../scripts/CharacterFadeOrderFix.js'), 'utf8');
const context = { CharacterStage };
vm.createContext(context);
vm.runInContext(source, context);

const stage = new CharacterStage();
const result = stage.control({
    label: 'hana',
    anim1: 'wait',
    anim2: 'face_smile',
    lipAnim: 'lip_wait_s',
    effect: { type: 'to', alpha: 0, time: 100 },
    effectSpeed: 1,
});

assert.strictEqual(result, 'call-1');
assert.strictEqual(stage.calls.length, 2);
assert.deepStrictEqual(JSON.parse(JSON.stringify(stage.calls[0])), {
    label: 'hana',
    effect: { type: 'to', alpha: 0, time: 100 },
    effectSpeed: 1,
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(stage.calls[1])), {
    label: 'hana',
    anim1: 'wait',
    anim2: 'face_smile',
    lipAnim: 'lip_wait_s',
});

stage.calls = [];
stage.control({ label: 'hana', anim2: 'face_smile', effect: { type: 'from', alpha: 0, time: 100 } });
assert.strictEqual(stage.calls.length, 1, 'fade-in order must remain unchanged');

stage.calls = [];
stage.control({ label: 'hana', effect: { type: 'to', alpha: 0, time: 100 } });
assert.strictEqual(stage.calls.length, 1, 'fade without a pose change needs no split pass');

console.log('character-fade-order: PASS');
