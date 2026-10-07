'use strict';

// Export policy only. Never rewrites source tracks or production player code.
const OfflineFlow = {
    storyNodeIndices(tracks) {
        // A node is counted once even when returning to the choice screen.
        // This is story coverage, not an estimate of remaining render time.
        return tracks.flatMap((track, index) =>
            track.text || track.select || track.movie || track.gameEventCommunicationMovie ? [index] : []);
    },
    choiceOrder(items) {
        if (items.length === 1) return items.slice();
        if (items.length !== 3) throw new Error('This trial requires exactly one or three choices');
        const byX = items.slice().sort((a, b) => a.x - b.x);
        return [byX[1], byX[0], byX[2]];
    },
    previewStart(tracks) {
        const choice = tracks.findIndex(t => t.select);
        const texts = tracks.map((t, i) => t.text && i < choice ? i : -1).filter(i => i >= 0);
        if (choice < 0 || texts.length < 2) throw new Error('Preview needs a choice and two preceding lines');
        return texts.at(-2);
    },
    terminalOutro(tracks) {
        // Only the final, silent black tail. Intermediate/branch fades stay intact.
        const lastText = tracks.findLastIndex(t => t.text || t.select || t.movie || t.gameEventCommunicationMovie);
        for (let i = lastText + 1; i < tracks.length; i++) {
            const t = tracks[i];
            if (t.bg === '00000' && t.bgEffect === 'fade' && !t.voice && !t.se
                && tracks.slice(i + 1).every(n => Object.keys(n).every(k => ['label', 'textFrame'].includes(k)))) return i;
        }
        return -1;
    },
    terminalDialogue(tracks, index, nextLabel) {
        // Inspect the actual outgoing route, not the last text in file order:
        // the last visited choice may jump past other branches to `end`.
        if (!tracks[index]?.text) return false;
        const labelIndex = label => tracks.findIndex(t => t.label === label);
        let cursor = nextLabel ? labelIndex(nextLabel) : index + 1;
        if (cursor < 0) return false;
        const seen = new Set();
        while (cursor < tracks.length) {
            if (seen.has(cursor)) return false;
            seen.add(cursor);
            const t = tracks[cursor];
            // Only terminal frame hiding, character removal and black fade.
            // Preserve silent story actions, movies, new poses and sound cues.
            const keys = new Set(['id', 'label', 'nextLabel', 'textFrame']);
            if (t.textFrame !== undefined && t.textFrame !== 'off') return false;
            if (t.bg === '00000' && t.bgEffect === 'fade') {
                ['bg', 'bgEffect', 'bgEffectTime', 'waitType', 'waitTime', 'bgmFadeTime', 'se']
                    .forEach(k => keys.add(k));
                // A sound attached only to the omitted terminal fade is part
                // of that outro; do not start it over the retained dialogue.
            } else if (t.charEffect?.type === 'to' && t.charEffect.alpha === 0
                && Object.keys(t.charEffect).every(k => ['type', 'alpha', 'time'].includes(k))
                && (!t.charAnim1 || t.charAnim1 === 'wait')) {
                ['charEffect', 'charLabel', 'charAnim1', 'waitType', 'waitTime'].forEach(k => keys.add(k));
            }
            if (Object.keys(t).some(k => !keys.has(k))) return false;
            cursor = t.nextLabel ? labelIndex(t.nextLabel) : cursor + 1;
            if (cursor < 0) return false;
        }
        return true;
    },
    movieFrame(timestamps, seconds) {
        let low = 0, high = timestamps.length - 1;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (timestamps[mid] <= seconds + 1e-7) low = mid;
            else high = mid - 1;
        }
        return low;
    },
};
if (typeof module !== 'undefined') module.exports = OfflineFlow;
if (typeof window !== 'undefined') window.OfflineFlow = OfflineFlow;
