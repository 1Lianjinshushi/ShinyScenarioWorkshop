'use strict';
const fs = require('node:fs'), path = require('node:path');
// Only disposable outputs created by this runner, never source/cache/report files.
function cleanup(output, { success, managed = false } = {}) {
    if (fs.lstatSync(output).isSymbolicLink()) throw new Error('Cleanup refuses linked job directories');
    const root = fs.realpathSync(output), removed = [];
    function safe(file) {
        const resolved = path.resolve(file);
        if (!resolved.startsWith(root + path.sep)) throw new Error('Cleanup target outside job');
        let probe = resolved;
        while (probe !== root) {
            if (fs.lstatSync(probe).isSymbolicLink()) throw new Error('Cleanup refuses linked files');
            probe = path.dirname(probe);
        }
        return resolved;
    }
    const targets = ['picture.h264', 'picture.mp4', 'mix.f32', 'media-mix.f32', 'mastered.f32'];
    if (managed) targets.push('audio', 'movie-frames');
    targets.push(...fs.readdirSync(root).filter(n => /^\d+\.offline\.partial\.mp4$/.test(n)));
    const leaves = [];
    function collect(file, kind) {
        safe(file);
        const s = fs.lstatSync(file);
        if (s.isDirectory()) {
            if (!['audio', 'movie-frames'].includes(kind)) throw new Error('Cleanup expected an intermediate file, not a directory');
            for (const name of fs.readdirSync(file)) collect(path.join(file, name), kind);
        } else {
            const name = path.basename(file);
            if (kind === 'audio' && !/^[a-f0-9]{16}(\.browser)?\.f32(\.json|\.partial)?$/.test(name)) throw new Error('Unknown audio intermediate');
            if (kind === 'movie-frames' && !/^(\d{6}\.png|complete\.json)$/.test(name)) throw new Error('Unknown movie intermediate');
            leaves.push({ path: file, bytes: s.size });
        }
    }
    for (const name of targets) if (fs.existsSync(path.join(root, name))) collect(path.join(root, name), name);
    // Validate the entire set before removing anything. Recursive targets are
    // fixed leaf directories inside this exact job, never a workspace root.
    for (const name of targets) {
        const file = path.join(root, name);
        if (!fs.existsSync(file)) continue;
        safe(file);
        fs.rmSync(file, { recursive: fs.lstatSync(file).isDirectory() });
    }
    removed.push(...leaves.map(x => ({ file: path.relative(root, x.path), bytes: x.bytes })));
    const report = { success: !!success, removed, bytes: removed.reduce((s, x) => s + x.bytes, 0),
        note: 'Only reproducible intermediates deleted. Source snapshot, assets/cache, final video and reports retained.' };
    fs.writeFileSync(path.join(root, 'cleanup-report.json'), JSON.stringify(report, null, 2));
    return report;
}
module.exports = { cleanup };
