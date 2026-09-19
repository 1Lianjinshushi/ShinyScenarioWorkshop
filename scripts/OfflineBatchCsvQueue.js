'use strict';

(function exposeOfflineBatchCsvQueue(root) {
    function missingSpeakers(tracks, speakerMap) {
        const names = new Set((tracks || []).map(track =>
            track && typeof track.speaker === 'string' ? track.speaker.trim() : ''
        ).filter(name => name && name !== 'off'));
        return [...names].filter(name => !String(speakerMap?.get(name) || '').trim());
    }

    function translatedItem(tracks, csvText, eventType, eventId, speakerMap, translation) {
        if (!Array.isArray(tracks) || !tracks.length) throw new Error('缺少完整日文剧情 JSON');
        const merged = translation.mergeScenarioTranslation(tracks, csvText);
        const localized = merged.tracks.map(track => {
            if (!track || typeof track !== 'object' || Array.isArray(track)) return track;
            const next = { ...track };
            if (typeof track.text_cn === 'string' && track.text_cn.trim()) {
                next.text_ja = track.text; next.text = track.text_cn;
            }
            if (typeof track.select_cn === 'string' && track.select_cn.trim()) {
                next.select_ja = track.select; next.select = track.select_cn;
            }
            const name = speakerMap?.get(track.speaker);
            if (name) { next.speaker_ja = track.speaker; next.speaker_cn = name; next.speaker = name; }
            return next;
        });
        return {
            item: { eventId, eventType, language: 'zh-cn', mode: 'offline', content: JSON.stringify(localized) },
            report: merged.report,
            missingSpeakers: missingSpeakers(tracks, speakerMap),
        };
    }

    async function fetchTracks(eventType, eventId, fetcher, roots) {
        const errors = [];
        for (const base of roots) {
            const url = `${base}/json/${eventType}/${eventId}.json`;
            try {
                const response = await fetcher(url, {
                    cache: 'no-store', mode: 'cors', signal: AbortSignal.timeout(20000),
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const tracks = await response.json();
                if (!Array.isArray(tracks) || !tracks.length) throw new Error('返回内容不是剧情轨道数组');
                return tracks;
            } catch (error) { errors.push(`${url}: ${error.message}`); }
        }
        throw new Error(errors.join('；'));
    }

    const api = { missingSpeakers, translatedItem, fetchTracks };
    root.OfflineBatchCsvQueue = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : window));
