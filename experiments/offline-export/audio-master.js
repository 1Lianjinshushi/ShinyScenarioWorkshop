'use strict';
// This page never loads PIXI, fonts, models, video textures or the scenario.
// One continuous browser compressor preserves state across the entire story.
window.audioMaster = {
    buffer: null,
    async render(frames, parameters) {
        if (!Number.isSafeInteger(frames) || frames <= 0) throw new Error('Invalid audio frame count');
        const context = new OfflineAudioContext(2, frames, 48000);
        const input = context.createBuffer(2, frames, 48000);
        const left = input.getChannelData(0), right = input.getChannelData(1);
        for (let start = 0; start < frames; start += 48000) {
            const response = await fetch(`/proof-mix?start=${start}`);
            if (!response.ok) throw new Error('Unable to read mixed PCM');
            const values = new Float32Array(await response.arrayBuffer());
            const count = Math.min(48000, frames - start);
            if (values.length !== count * 2) throw new Error('Truncated mixed PCM');
            for (let i = 0; i < count; i++) { left[start + i] = values[i * 2]; right[start + i] = values[i * 2 + 1]; }
        }
        const compressor = context.createDynamicsCompressor();
        for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) {
            if (!Number.isFinite(parameters[key])) throw new Error(`Invalid compressor parameter: ${key}`);
            compressor[key].value = parameters[key];
        }
        const source = context.createBufferSource();
        source.buffer = input;
        source.connect(compressor); compressor.connect(context.destination); source.start(0);
        this.buffer = await context.startRendering();
        source.disconnect(); compressor.disconnect(); source.buffer = null;
        return { frames: this.buffer.length, sampleRate: 48000, parameters, continuousCompressor: true };
    },
    chunk(start) {
        const b = this.buffer, frames = Math.min(48000, b.length - start);
        const values = new Float32Array(frames * 2);
        const left = b.getChannelData(0), right = b.getChannelData(1);
        for (let i = 0; i < frames; i++) { values[i * 2] = left[start + i]; values[i * 2 + 1] = right[start + i]; }
        const bytes = new Uint8Array(values.buffer); let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(binary);
    },
};
