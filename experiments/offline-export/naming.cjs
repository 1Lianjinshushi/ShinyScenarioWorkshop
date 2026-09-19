'use strict';
const fs = require('node:fs'), path = require('node:path');
const core = require('../../scripts/GameUpdateMonitorCore.js');
const { safeFilenamePart } = require('../../scripts/ScenarioStoryMetadata.js');
const videoRoot = root => path.join(root, 'exports/offline-videos');
function safePart(value, fallback, limit) {
    let result = safeFilenamePart(value, fallback);
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) result = '_' + result;
    result = Array.from(result).slice(0, limit).join('').replace(/[ .]+$/g, '');
    return result || fallback;
}
function read(root, relative) {
    const file = path.join(root, relative);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : {};
}
function resolveNames(root, job) {
    const state = read(root, 'monitor/game-update-state.json');
    const titles = read(root, 'metadata/scenario-titles.json').entries || {};
    const groups = read(root, 'metadata/scenario-library-groups.json');
    const key = `${job.eventType}/${job.eventId}`;
    // Same source priority as the resource library: game-observed titles win;
    // cached catalogue titles fill blanks only. Do not fetch or mutate metadata.
    const rows = Object.values(state.entries || {}).map(e => ({ ...e,
        storyTitle: e.storyTitle || titles[`${e.eventType}/${e.eventId}`]?.storyTitle || '' }));
    if (!rows.some(e => e.eventType === job.eventType && e.eventId === job.eventId))
        rows.push({ eventType: job.eventType, eventId: job.eventId, ...(titles[key] || {}) });
    const row = core.decorateSpecialEntries(rows).find(e => e.eventType === job.eventType && e.eventId === job.eventId);
    const c = core.classifyScenario(job.eventType, job.eventId);
    let folder = c.groupLabel || job.eventType;
    if (/-card$/.test(c.category)) {
        const card = groups.cards?.[job.eventId.slice(0, 7)] || {};
        const rawName = String(row.cardName || card.cardName || titles[key]?.cardName || '').trim();
        const cardName = rawName.match(/【[^】]+】/)?.[0] || rawName;
        const shortName = core.CHARACTER_SHORT_NAMES[c.characterId] || c.characterName;
        folder = `${shortName}${c.cardType === 'Produce' ? 'P卡' : 'S卡'}・${cardName || `第${Number(c.cardSequence)}张（${job.eventId.slice(0, 7)}）`}`;
    } else if (c.category === 'game-event') {
        folder = row.activityLabel || groups.activities?.[job.eventId.slice(4, 7)]?.label || folder;
    } else if (c.category === 'unit-produce') folder = `${c.unitLabel}-A.X.E.8.`;
    const display = core.childDisplayLine(row);
    let title = display.startsWith(job.eventId + ' · ') ? display.slice(job.eventId.length + 3) : display;
    if (!row.storyTitle && !row.stableStoryLabel && title !== job.eventId) title += `・${job.eventId}`;
    if (job.language === 'ja') title += '【日文】';
    if (job.mode === 'branch-preview') title += '【选择支样片】';
    return { folder: safePart(folder, job.eventType, 70), title: safePart(title, job.eventId, 110),
        libraryTitle: display, missingTitle: !row.storyTitle && !row.stableStoryLabel };
}
function checkedDirectory(root, directory) {
    const base = path.resolve(root), target = path.resolve(directory);
    if (!target.startsWith(base + path.sep)) throw new Error('Video directory outside export root');
    let current = target;
    while (current !== base) {
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Linked output directory refused');
        current = path.dirname(current);
    }
    if (fs.existsSync(base) && fs.lstatSync(base).isSymbolicLink()) throw new Error('Linked output root refused');
    return target;
}
function publishVideo(root, job, source) {
    if (!fs.lstatSync(source).isFile()) throw new Error('Final video must be a regular file');
    const names = resolveNames(root, job), base = videoRoot(root);
    const directory = checkedDirectory(base, path.join(base, names.folder));
    fs.mkdirSync(directory, { recursive: true });
    // Leave room for a collision suffix under the traditional Windows limit.
    const title = safePart(names.title, job.eventId, Math.max(16, 240 - directory.length - 20));
    for (let index = 1; index < 10000; index++) {
        const suffix = index === 1 ? '' : ` (${index})`;
        const destination = path.join(directory, `${title}${suffix}.mp4`);
        try {
            // Exclusive publication, never overwrite an earlier recording.
            try { fs.linkSync(source, destination); }
            catch (error) {
                if (error.code === 'EEXIST') throw error;
                fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
            }
            return { outputPath: destination, outputUrl: '/' + path.relative(root, destination).split(path.sep).map(encodeURIComponent).join('/'),
                outputName: path.basename(destination), outputGroup: names.folder, libraryTitle: names.libraryTitle,
                namingWarning: names.missingTitle ? '资源库尚无该话标题，暂保留剧情编号。' : '' };
        } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    throw new Error('同名视频过多，请整理输出目录');
}
module.exports = { resolveNames, publishVideo, checkedDirectory, safePart };
