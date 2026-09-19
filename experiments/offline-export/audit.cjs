'use strict';
// Read generated evidence, never mutate source scenarios or translations.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const id = process.argv[2];
if (!/^\d+$/.test(id)) throw new Error('Expected numeric scenario ID');
const dir = path.resolve(__dirname, '../../exports/offline-proof', id);
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const source = read('source.json');
const manifest = read('source-manifest.json');
const offline = read('offline-report.json');
const reference = read('realtime-reference.json');
const repeat = read('determinism-report.json');
const tracks = offline.events.filter(e => e.kind === 'track');
const nativeTracks = reference.events.filter(e => e.kind === 'track');
const sequence = tracks.map(e => e.index);
const voices = offline.sounds.filter(s => s.url.includes('/sounds/voice/'));
const voiceChecks = voices.map(s => ({
    url: s.url, start: s.start, duration: s.duration, stop: s.stop,
    truncatedSeconds: s.stop == null ? null : Math.max(0, s.duration - (s.stop - s.start)),
}));
const timeline = tracks.map((e, i) => ({ index: e.index, offline: e.time,
    realtime: nativeTracks[i]?.time, deltaSeconds: nativeTracks[i] ? e.time - nativeTracks[i].time : null }));
const ffprobe = process.env.SSV_FFPROBE || 'D:/ffmpeg/bin/ffprobe.exe';
const video = JSON.parse(cp.execFileSync(ffprobe, ['-v', 'error', '-threads', '2', '-count_frames', '-show_streams',
    '-show_format', '-of', 'json', path.join(dir, `${id}.offline.mp4`)], { encoding: 'utf8', windowsHide: true }));
const videoStream = video.streams.find(s => s.codec_type === 'video');
const audioStream = video.streams.find(s => s.codec_type === 'audio');
const sourceNow = fs.readFileSync(manifest.sourcePath || path.join(dir, 'source.json'));
const audit = {
    sourceUnchanged: crypto.createHash('sha256').update(sourceNow).digest('hex') === manifest.sha256,
    sourceNodes: source.length, visitedNodes: tracks.length,
    everyNodeInOrder: JSON.stringify(sequence) === JSON.stringify(source.map((_, i) => i)),
    realtimeSameTrackOrder: JSON.stringify(sequence) === JSON.stringify(nativeTracks.map(e => e.index)),
    spokenLines: source.filter(t => t.voice && !['off', 'fade_out', 'pause', 'resume'].includes(t.voice)).length,
    voiceInstances: voices.length, voiceChecks,
    unexplainedVoiceCuts: voiceChecks.filter(s => s.truncatedSeconds > 1 / 60 + 1e-6),
    bgmInstances: offline.sounds.filter(s => s.url.includes('/bgm/')).map(s => ({
        url: s.url, start: s.start, stop: s.stop, looping: s.loop,
        finalGain: s.gains.at(-1)?.[1],
    })),
    encodedFrames: offline.encodedFrames, decodedFrames: Number(videoStream.nb_read_frames),
    noDroppedEncodedFrames: offline.encodedFrames === Number(videoStream.nb_read_frames),
    width: videoStream.width, height: videoStream.height, fps: videoStream.avg_frame_rate,
    videoSeconds: Number(videoStream.duration), audioSeconds: Number(audioStream.duration),
    audioCodec: audioStream.codec_name, audioSampleRate: Number(audioStream.sample_rate),
    outputBytes: Number(video.format.size), endSeconds: offline.endedAt,
    realtimeEndSeconds: reference.endedAt, renderWallSeconds: offline.wallSeconds,
    stoppedWallClockDidNotAdvanceScenario: offline.stall.unchanged,
    deterministicSampleFrames: repeat.comparisons.filter(c => c.identical).length,
    totalSampleFrames: repeat.comparisons.length,
    deterministicTimeline: repeat.identicalTimeline,
    runtimeErrors: read('browser-errors.json'), timeline,
    outputCompressor: read('audio-mastering.json'),
    limitations: [
        'Self-consistency and a native-clock timeline comparison are not a pixel-for-pixel comparison with a desktop recording.',
        'Encoder requests hardware acceleration; browser implementation chooses the actual codec device.',
        '1704x960 balanced canvas is scaled to 1920x1080 by WebCodecs; H.264 is lossy.',
        'Current experiment rejects choices and card movies; no production export feature is enabled.',
    ],
};
fs.writeFileSync(path.join(dir, 'validation.json'), JSON.stringify(audit, null, 2));
console.log(JSON.stringify({ ...audit, voiceChecks: undefined, timeline: undefined }, null, 2));
if (!audit.sourceUnchanged || !audit.everyNodeInOrder || !audit.realtimeSameTrackOrder
    || !audit.noDroppedEncodedFrames || !audit.stoppedWallClockDidNotAdvanceScenario
    || !audit.deterministicTimeline || audit.deterministicSampleFrames !== audit.totalSampleFrames
    || audit.runtimeErrors.length || audit.spokenLines !== audit.voiceInstances || audit.unexplainedVoiceCuts.length) process.exitCode = 1;
