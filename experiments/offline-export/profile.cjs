'use strict';
function profile(mode, env = process.env) {
    const flag = env.SSV_PROOF_DIAGNOSTICS;
    if (flag !== undefined && !['0', '1'].includes(flag)) throw new Error('SSV_PROOF_DIAGNOSTICS must be 0 or 1');
    // Verification modes cannot accidentally disable their own evidence.
    const diagnostics = ['all', 'reference', 'determinism'].includes(mode) || flag === '1';
    return { diagnostics, sampleFrame: frame => diagnostics && (frame % 300 === 0
        || [33, 39, 60, 90, 120, 180, 240, 360, 420, 480, 540].includes(frame)),
        stallFrame: diagnostics ? 120 : -1 };
}
function audioMemoryBytes(frames) {
    if (!Number.isSafeInteger(frames) || frames <= 0) throw new Error('Invalid audio frame count');
    // Continuous compressor input + output; media is added a second at a time
    // in Node, after compression. Headroom covers graph and transfer buffers.
    return frames * 8 * 2 + 128 * 1024 * 1024;
}
module.exports = { profile, audioMemoryBytes };
