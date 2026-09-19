'use strict';

// Execute the actual bundled apply methods. No browser, model downloads, or
// copied implementation: the test covers all three shipped runtime branches.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../lib/pixi-spine.umd.js'), 'utf8');
const Blend = { setup: 0, first: 1, replace: 2, add: 3 };
class VertexAttachment {
    applyDeform(attachment) { return attachment === this; }
}
const Utils = {
    setArraySize(array, size) { while (array.length < size) array.push(0); array.length = size; return array; },
    arrayCopy(from, offset, to, start, length) { for (let i = 0; i < length; i++) to[start + i] = from[offset + i]; },
};
function loadApply(version, text = source) {
    const symbol = { '3.7': 'DeformTimeline$1', '3.8': 'DeformTimeline$2', '4.0': 'DeformTimeline' }[version];
    const block = text.indexOf(`var ${symbol} =`);
    assert.ok(block >= 0, `runtime ${version} must exist`);
    const method = text.indexOf('DeformTimeline.prototype.apply = function', block);
    const start = text.indexOf('function', method);
    const end = text.indexOf('\n        };', start);
    const body = text.slice(start, end) + '\n}';
    return vm.runInNewContext(`(${body})`, {
        VertexAttachment, VertexAttachment$1: VertexAttachment, VertexAttachment$2: VertexAttachment,
        Utils, exports: { MixBlend: Blend },
        Animation$1: { binarySearch: () => 1 }, Animation$2: { binarySearch: () => 1 },
        Timeline: { search1: () => 0 },
    });
}
function fixture(version, weighted, empty = false) {
    const attachment = new VertexAttachment();
    attachment.bones = weighted ? [1, 0] : null;
    attachment.vertices = [10, 20];
    attachment.deformAttachment = attachment;
    const deform = empty ? [] : [14, 16];
    const slot = { bone: { active: true }, getAttachment: () => attachment, attachmentVertices: deform, deform };
    const timeline = { slotIndex: 0, attachment, frames: [0, 2], frameVertices: [[20, 30], [30, 40]],
        vertices: [[20, 30], [30, 40]], getCurvePercent: version === '4.0' ? time => time / 2 : (_, percent) => percent };
    return { attachment, deform, slot, timeline, skeleton: { data: { version }, slots: [slot] } };
}
function close(actual, expected, message) {
    assert.equal(actual.length, expected.length, message);
    actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < 1e-9, `${message}: ${n} != ${expected[i]}`));
}
for (const version of ['3.7', '3.8', '4.0']) {
    const apply = loadApply(version);
    for (const weighted of [false, true]) for (const empty of [false, true]) {
        for (const [mode, blend] of Object.entries(Blend)) for (const alpha of [0, 0.25, 0.99, 1]) {
            for (const time of [0, 1, 2, 3]) {
                test(`${version} ${weighted ? 'weighted' : 'unweighted'} ${empty ? 'reset' : 'retained'} ${mode} alpha=${alpha} t=${time}`, () => {
                    const f = fixture(version, weighted, empty);
                    const base = [14, 16], setup = weighted ? [0, 0] : [10, 20];
                    const target = time === 0 ? [20, 30] : time === 1 ? [25, 35] : [30, 40];
                    const effective = empty ? Blend.setup : blend;
                    const expected = target.map((v, i) => effective === Blend.setup ? setup[i] + (v - setup[i]) * alpha
                        : effective === Blend.add ? base[i] + (v - setup[i]) * alpha : base[i] + (v - base[i]) * alpha);
                    apply.call(f.timeline, f.skeleton, 0, time, null, alpha, blend, 0);
                    close(f.deform, expected, 'blend formula');
                });
            }
        }
    }
    test(`${version} attachment reset during lower-track blink cannot change upper-track amplitude`, () => {
        const retained = fixture(version, true), reset = fixture(version, true, true);
        retained.deform.fill(0); // Lower body track's neutral deformation.
        for (const f of [retained, reset]) apply.call(f.timeline, f.skeleton, 0, 3, null, 0.99, Blend.replace, 0);
        close(retained.deform, reset.deform, 'body blink must not produce a 2x/1x jump');
    });
    test(`${version} mismatched attachment is untouched`, () => {
        const f = fixture(version, true);
        f.timeline.attachment = new VertexAttachment();
        apply.call(f.timeline, f.skeleton, 0, 3, null, 0.99, Blend.replace, 0);
        close(f.deform, [14, 16], 'unrelated attachment');
    });
}
test('regression suite detects the historical missing-break mutation', () => {
    const marker = 'vertices[i] += (lastVertices[i] - vertices[i]) * alpha;';
    const at = source.indexOf(marker, source.indexOf('var DeformTimeline$1 ='));
    const tail = source.slice(at + marker.length);
    const breakAt = tail.indexOf('break;');
    assert.ok(breakAt >= 0 && breakAt < tail.indexOf('case exports.MixBlend.add:'), 'replacement must end before addition');
    const broken = source.slice(0, at + marker.length) + tail.slice(0, breakAt) + tail.slice(breakAt + 'break;'.length);
    const f = fixture('3.7', true);
    f.deform.fill(0);
    loadApply('3.7', broken).call(f.timeline, f.skeleton, 0, 3, null, 0.99, Blend.replace, 0);
    close(f.deform, [59.4, 79.2], 'historical twofold deformation');
});

// The public game's 3.6 runtime keeps the blend on attachment reset, unlike
// 3.7. This matters for unweighted lashes/mouth meshes as well as weighted ones.
for (const weighted of [false, true]) for (const empty of [false, true]) {
    for (const [mode, blend] of Object.entries(Blend).filter(([mode]) => mode !== 'add')) {
        for (const alpha of [0, 0.25, 0.99, 1]) for (const time of [-1, 0, 1, 2, 3]) {
            test(`3.6 compatibility ${weighted ? 'weighted' : 'unweighted'} ${empty ? 'reset' : 'retained'} ${mode} alpha=${alpha} t=${time}`, () => {
                const f = fixture('3.6.53', weighted, empty);
                const base = empty ? [0, 0] : [14, 16], setup = weighted ? [0, 0] : [10, 20];
                const target = time === 0 ? [20, 30] : time === 1 ? [25, 35] : [30, 40];
                const expected = time < 0
                    ? setup.map((v, i) => blend === Blend.setup ? v : blend === Blend.first && alpha !== 1 ? base[i] + (v - base[i]) * alpha : base[i])
                    : target.map((v, i) => blend === Blend.setup ? setup[i] + (v - setup[i]) * alpha : base[i] + (v - base[i]) * alpha);
                loadApply('3.7').call(f.timeline, f.skeleton, 0, time, null, alpha, blend, 0);
                close(f.deform, expected, 'game 3.6 blend semantics');
            });
        }
    }
}

function loadRotate() {
    const block = source.indexOf('var AnimationState$1 =');
    const method = source.indexOf('AnimationState.prototype.applyRotateTimeline = function', block);
    const start = source.indexOf('function', method);
    const end = source.indexOf('\n        };', start);
    return vm.runInNewContext(`(${source.slice(start, end)}\n})`, {
        exports: { MixBlend: Blend, MixDirection: { mixIn: 0 } }, MathUtils: { signum: Math.sign },
    });
}
for (const version of ['3.6', '3.6.53', '3.7.94']) {
    for (const [mode, blend] of Object.entries(Blend)) {
        test(`${version} rotation before first key: ${mode}`, () => {
            const bone = { data: { rotation: 10 }, rotation: 40 };
            loadRotate().call({}, { frames: [1, 20], boneIndex: 0 }, { data: { version }, bones: [bone] },
                0.5, 0.25, blend, [], 0, true);
            const expected = blend === Blend.setup ? 10 : blend === Blend.first && version.startsWith('3.7') ? 32.5 : 40;
            assert.equal(bone.rotation, expected, 'legacy pose is retained; native 3.7 behavior is unchanged');
        });
    }
}
