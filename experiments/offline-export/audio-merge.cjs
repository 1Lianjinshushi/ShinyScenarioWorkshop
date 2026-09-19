'use strict';
// Float32 destination mixing, matching two WebAudio inputs at unity gain.
// Do not clip, normalise, reset the compressor or move media into its input.
function addMedia(compressed, media) {
    if (compressed.length !== media.length || compressed.length % 8) throw new Error('Invalid stereo PCM chunk');
    for (let i = 0; i < compressed.length; i += 4)
        compressed.writeFloatLE(compressed.readFloatLE(i) + media.readFloatLE(i), i);
    return compressed;
}
module.exports = { addMedia };
