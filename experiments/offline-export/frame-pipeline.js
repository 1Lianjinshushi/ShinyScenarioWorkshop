'use strict';
// Keep the deterministic 60 Hz clock. Only overlap an immutable VideoFrame's
// encoder ACK with the next render; never keep more than two frames in flight.
(() => {
    const originalPrepare = proof.prepareEncoder;
    const originalEncode = proof.encodeFrame;
    const originalFinish = proof.finishEncoder;
    proof.prepareEncoder = async () => {
        if (!proof.options.framePipeline) return originalPrepare();
        const config = await proof.checkEncoder();
        const pending = proof.pipelinePending = new Map();
        proof.encodedCount = 0;
        proof.pipelineHighWater = 0;
        proof.encoderError = null;
        proof.failPipeline = error => {
            proof.encoderError ||= error;
            for (const item of pending.values()) item.reject(proof.encoderError);
            pending.clear();
        };
        proof.encoder = new VideoEncoder({
            output(chunk, metadata) {
                if (proof.encoderError) return;
                const item = pending.get(chunk.timestamp);
                if (!item || chunk.timestamp !== Math.round(proof.encodedCount * 1000000 / 60))
                    return proof.failPipeline(new Error('Missing, duplicate or reordered video frame'));
                try {
                    const bytes = new Uint8Array(chunk.byteLength);
                    chunk.copyTo(bytes);
                    let binary = '';
                    for (let i = 0; i < bytes.length; i += 8192)
                        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
                    proof.decoderConfig = metadata?.decoderConfig || proof.decoderConfig;
                    const packet = { timestamp: chunk.timestamp, type: chunk.type, data: btoa(binary) };
                    pending.delete(chunk.timestamp);
                    proof.encodedCount++;
                    item.resolve(packet);
                } catch (error) { proof.failPipeline(error); }
            },
            error: error => proof.failPipeline(error),
        });
        proof.encoder.configure(config);
        return config;
    };
    proof.encodeFrame = frame => {
        if (!proof.options.framePipeline) return originalEncode(frame);
        if (proof.encoderError) throw proof.encoderError;
        const pending = proof.pipelinePending;
        if (!Number.isSafeInteger(frame) || frame !== proof.encodedCount + pending.size || pending.size >= 2)
            throw new Error('Invalid frame or encoder bounded queue exceeded');
        const timestamp = Math.round(frame * 1000000 / 60);
        let timer;
        const complete = new Promise((resolve, reject) => {
            pending.set(timestamp, { resolve, reject });
            proof.pipelineHighWater = Math.max(proof.pipelineHighWater, pending.size);
            timer = exportNative.timeout(() => proof.failPipeline(new Error('Encoder ACK timeout')), 15000);
        });
        // Attach rejection handling before encode(), which can fail synchronously.
        const result = complete.finally(() => exportNative.clearTimeout(timer));
        result.catch(() => {});
        let videoFrame;
        try {
            videoFrame = new VideoFrame(proof.app.view, { timestamp, duration: Math.round(1000000 / 60), alpha: 'discard' });
            proof.encoder.encode(videoFrame, { keyFrame: frame % 120 === 0 });
        } catch (error) { proof.failPipeline(error); }
        finally { videoFrame?.close(); }
        return result;
    };
    proof.finishEncoder = async () => {
        if (!proof.options.framePipeline) return originalFinish();
        try {
            if (proof.encoderError) throw proof.encoderError;
            if (proof.pipelinePending.size) throw new Error('Encoder still has unacknowledged frames');
            await proof.encoder.flush();
            if (proof.encoderError) throw proof.encoderError;
            return proof.encodedCount;
        } finally { if (proof.encoder.state !== 'closed') proof.encoder.close(); }
    };
    proof.renderBatch = async ({ frame, count, prepared, end, captures }) => {
        if (!Number.isSafeInteger(frame) || !Number.isSafeInteger(end) || end <= frame || end - frame > 8)
            throw new Error('Invalid bounded render batch');
        const start = exportNative.now(), results = [], pending = [];
        const drain = async () => { const item = pending.shift(); item.state.packet = await item.promise; };
        for (; frame < end; frame++) {
            const capture = captures.includes(frame), state = prepared || await proof.step(frame, capture);
            if (prepared && capture) state.png = proof.app.view.toDataURL('image/png').split(',')[1];
            prepared = null;
            state.frame = frame;
            results.push(state);
            if (!state.done && state.captureStartFrame != null) {
                const promise = proof.encodeFrame(count++);
                promise.catch(() => {});
                pending.push({ state, promise });
                if (pending.length >= (proof.options.framePipeline ? 2 : 1)) await drain();
            }
            // Yield to Node's memory/pause/cancel checks at most every 8 frames
            // or 100 ms of normal work. Encoder failure has its own ACK timeout.
            if (state.done || exportNative.now() - start >= 100) break;
        }
        while (pending.length) await drain();
        return results;
    };
})();
