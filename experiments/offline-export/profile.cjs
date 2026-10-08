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
const AUDIO_PCM_FORMAT = Object.freeze({ decoder: 'webaudio-48k-v1', sampleRate: 48000, channels: 2 });
function validAudioCache(cached, sourceHash, bytes) {
    return !!cached && Object.entries(AUDIO_PCM_FORMAT).every(([key, value]) => cached[key] === value)
        && cached.sourceHash === sourceHash && Number.isSafeInteger(cached.samples) && cached.samples > 0
        && bytes === cached.samples * AUDIO_PCM_FORMAT.channels * 4;
}
function validateDecodedAudio(metadata) {
    if (!metadata || metadata.sampleRate !== AUDIO_PCM_FORMAT.sampleRate
        || !Number.isSafeInteger(metadata.samples) || metadata.samples <= 0
        || !Number.isInteger(metadata.channels) || metadata.channels < 1
        || !Number.isFinite(metadata.duration) || metadata.duration <= 0
        || Math.abs(metadata.duration - metadata.samples / AUDIO_PCM_FORMAT.sampleRate) > 1 / AUDIO_PCM_FORMAT.sampleRate)
        throw new Error('Invalid 48 kHz decoded audio metadata; refusing a speed/pitch-changing PCM interpretation');
}
module.exports = { profile, audioMemoryBytes, AUDIO_PCM_FORMAT, validAudioCache, validateDecodedAudio };
