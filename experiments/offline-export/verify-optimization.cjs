'use strict';
// Compare ordinary export to the retained pre-optimization diagnostic sample.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const id = process.argv[2] || '4902005026', oldTag = process.argv[3] || 'contention-20260917-v3', newTag = process.argv[4] || 'lean-20260917';
if (!/^\d+$/.test(id) || [oldTag, newTag].some(s => !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(s))) throw new Error('Invalid comparison path');
const root = path.resolve(__dirname, '../../exports/offline-proof', id);
const oldDir = path.join(root, oldTag), newDir = path.join(root, newTag);
const read = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const ffmpeg = process.env.SSV_FFMPEG || 'D:/ffmpeg/bin/ffmpeg.exe';
function run(executable, args) {
    const result = cp.spawnSync(executable, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw result.error || new Error(result.stderr);
    return result.stdout;
}
const oldReport = read(oldDir, 'offline-report.json'), current = read(newDir, 'offline-report.json');
const videoHashes = dir => run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-threads', '1',
    '-i', path.join(dir, `${id}.offline.mp4`), '-map', '0:v', '-an', '-threads', '1', '-f', 'framemd5', '-'])
    .split(/\r?\n/).filter(line => line && !line.startsWith('#'));
const a = videoHashes(oldDir), b = videoHashes(newDir);
const load = read(newDir, 'load-report.json');
const output = {
    scope: 'Same scenario before/after optimization, not an original-game comparison. Wall-time runs were not under identical system load.',
    oldDir, newDir, encodedFrames: current.encodedFrames, seconds: current.encodedFrames / 60,
    decodedFrames: b.length, identicalDecodedVideo: JSON.stringify(a) === JSON.stringify(b),
    identicalMp4: hash(path.join(oldDir, `${id}.offline.mp4`)) === hash(path.join(newDir, `${id}.offline.mp4`)),
    identicalEvents: JSON.stringify(oldReport.events) === JSON.stringify(current.events),
    identicalSource: hash(path.join(oldDir, 'source.json')) === hash(path.join(newDir, 'source.json')),
    oldAudioSha256: hash(path.join(oldDir, 'mastered.f32')), newAudioSha256: hash(path.join(newDir, 'mastered.f32')),
    ordinaryMode: { diagnostics: current.diagnostics, pngHashes: Object.keys(current.hashes).length,
        stall: current.stall, snapshots: current.snapshots?.length || 0 },
    renderWallSeconds: current.wallSeconds, peakPrivateMiB: load.peakPrivateMiB,
    audioHandoff: load.samples.filter(s => ['before-visual-release', 'after-visual-release', 'audio-mastering'].includes(s.phase)),
    media: JSON.parse(run(process.env.SSV_FFPROBE || 'D:/ffmpeg/bin/ffprobe.exe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path.join(newDir, `${id}.offline.mp4`)])),
};
output.passed = output.identicalDecodedVideo && b.length === current.encodedFrames && output.identicalEvents && output.identicalSource
    && output.oldAudioSha256 === output.newAudioSha256 && !current.diagnostics && !Object.keys(current.hashes).length && current.stall === null;
fs.writeFileSync(path.join(newDir, 'optimization-validation.json'), JSON.stringify(output, null, 2));
console.log(JSON.stringify({ ...output, media: undefined }, null, 2));
if (!output.passed) process.exitCode = 1;
