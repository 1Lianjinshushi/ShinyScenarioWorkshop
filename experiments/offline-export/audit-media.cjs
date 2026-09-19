'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const id = process.argv[2];
if (!/^\d+$/.test(id)) throw new Error('Numeric ID required');
const runTag = process.argv[3] || process.env.SSV_PROOF_RUN_TAG || '';
if (runTag && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(runTag)) throw new Error('Invalid proof run tag');
const dir = path.resolve(__dirname, '../../exports/offline-proof', id, runTag);
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const r = read('offline-report.json');
const source = read('source-manifest.json');
const raw = read('source.json');
const sourceNow = fs.readFileSync(source.sourcePath);
const video = JSON.parse(cp.execFileSync(process.env.SSV_FFPROBE || 'D:/ffmpeg/bin/ffprobe.exe',
    ['-v', 'error', '-threads', '2', '-count_frames', '-show_streams', '-show_format', '-of', 'json', path.join(dir, `${id}.offline.mp4`)],
    { encoding: 'utf8', windowsHide: true }));
const v = video.streams.find(s => s.codec_type === 'video');
const a = video.streams.find(s => s.codec_type === 'audio');
const offset = r.captureStartFrame / 60;
const choices = r.events.filter(e => e.kind === 'choice-click');
const transitions = r.events.filter(e => e.kind === 'transition-end');
const repeatPath = path.join(dir, 'determinism-report.json');
const repeat = fs.existsSync(repeatPath) ? read('determinism-report.json') : null;
const coverage = r.movies || repeat?.movies || [];
const cutVoices = r.sounds.filter(s => s.url.includes('/sounds/voice/') && s.stop != null && s.duration - (s.stop - s.start) > 1 / 60 + 1e-6);
const report = {
    sourceUnchanged: crypto.createHash('sha256').update(sourceNow).digest('hex') === source.sha256,
    runtimeErrors: read('browser-errors.json'),
    encodedFrames: r.encodedFrames, decodedFrames: Number(v.nb_read_frames),
    noDroppedEncodedFrames: r.encodedFrames === Number(v.nb_read_frames),
    dimensions: [v.width, v.height], fps: v.avg_frame_rate, seconds: Number(v.duration),
    audioSeconds: Number(a.duration), outputBytes: Number(video.format.size),
    completeReason: r.completeReason, captureStartSeconds: offset,
    noEndPage: ['terminal-black-outro-omitted', 'scenario-end', 'two-lines-after-second-choice', 'final-dialogue-complete'].includes(r.completeReason),
    voicesUnexpectedlyCut: cutVoices,
    stallTestRequired: r.diagnostics ?? Boolean(r.stall), stallUnchanged: r.stall?.unchanged ?? null,
    choices: choices.map(e => ({ ...e, outputSeconds: e.time - offset })),
    threeSecondWaits: choices.every(e => Math.abs(e.wait - 3) < 1e-6),
    orderCorrect: JSON.stringify(choices.map(e => e.position)) === JSON.stringify(['middle', 'left', 'right'].slice(0, choices.length)),
    transitions: transitions.map(e => ({ ...e, outputSeconds: e.time - offset })),
    autoPreserved: transitions.every(e => e.auto),
    mediaEvents: r.events.filter(e => e.kind.startsWith('movie-') || e.kind.startsWith('transition-')).map(e => ({ ...e, outputSeconds: e.time - offset })),
    movies: coverage,
    allMovieFramesSeen: coverage.length === r.events.filter(e => e.kind === 'movie-start').length
        && coverage.every(m => m.sourceFrames === m.decodedFrames && m.firstFrame === 0 && m.lastFrame === m.sourceFrames - 1 && m.end != null),
    renderWallSeconds: r.wallSeconds,
    limitations: ['Experimental offline pipeline; not released.', 'No pixel-perfect claim against a live desktop recording.'],
};
if (!raw.some(t => t.select)) {
    const expected = raw.map((t, index) => ({ ...t, index })).filter(t => t.text).map(t => t.index);
    const observed = r.events.filter(e => e.kind === 'track' && e.text).map(e => e.index);
    report.allDialogueNodesInOrder = JSON.stringify(expected) === JSON.stringify(observed);
    report.dialogueNodes = observed.length;
}
if (r.options.branchPreview) {
    const clicks = choices.at(-1)?.time || 0;
    report.previewBoundaryValid = choices.length === 2 && transitions.length === 1 && r.completeReason === 'two-lines-after-second-choice'
        && r.events.filter(e => e.kind === 'track' && e.time >= clicks && e.text).length === 2;
}
if (repeat) report.determinism = repeat;
fs.writeFileSync(path.join(dir, 'media-validation.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.sourceUnchanged || report.runtimeErrors.length || !report.noDroppedEncodedFrames || !report.noEndPage
    || (report.stallTestRequired && !report.stallUnchanged) || report.voicesUnexpectedlyCut.length || !report.threeSecondWaits || !report.orderCorrect
    || !report.autoPreserved || !report.allMovieFramesSeen || report.previewBoundaryValid === false
    || report.allDialogueNodesInOrder === false) process.exitCode = 1;
