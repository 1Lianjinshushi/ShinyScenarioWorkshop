'use strict';

(function exposeScenarioStoryMetadata(root) {
    const cache = new Map();

    function storyPrefix(eventType, eventId) {
        const type = String(eventType || '');
        const id = String(eventId || '');
        const sequence = id.slice(-2);
        if (type === 'produce_events' && /^[23]\d{8}$/.test(id)) {
            return sequence === '11' ? 'TE' : sequence;
        }
        if (type === 'game_event_communications' && /^4001\d{5}$/.test(id)) {
            if (sequence === '01') return '序章';
            if (sequence === '08') return '终章';
            const value = Number(sequence);
            if (value >= 2 && value <= 7) return String(value - 1).padStart(2, '0');
        }
        const training = type === 'produce_events' && id.match(/^1\d{3}(\d{3})(\d{2,3})$/);
        if (training) {
            const rules = {
                '000': new Set(['01', '02']),
                '001': new Set(['01', '02', '03', '04', '05', '11']),
                '002': new Set(['01', '02', '11']),
                '003': new Set(['01', '02', '03', '04', '05', '09']),
                '004': new Set(['01', '02', '03', '04', '05', '06']),
                '005': new Set(['01', '02', '03', '04', '05', '06']),
            };
            if (rules[training[1]] && rules[training[1]].has(training[2])) {
                return training[2] === '11' ? 'TE' : training[2];
            }
        }
        return '';
    }

    function safeFilenamePart(value, fallback) {
        const cleaned = String(value == null ? '' : value)
            .trim()
            .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '＿')
            .replace(/[ .]+$/g, '');
        return (cleaned || String(fallback || 'scenario')).slice(0, 160);
    }

    function csvFilename(metadata, options = {}) {
        const eventType = String(metadata && metadata.eventType || options.eventType || '');
        const eventId = String(metadata && metadata.eventId || options.eventId || 'scenario');
        const prefix = storyPrefix(eventType, eventId);
        const title = safeFilenamePart(metadata && metadata.storyTitle, eventId);
        const workflowPrefix = options.workflow === 'translation'
            ? '【翻】'
            : options.workflow === 'correction'
                ? '【校】'
                : options.corrected ? '【校】' : '';
        return `${workflowPrefix}${prefix ? `${safeFilenamePart(prefix, eventId)}.` : ''}${title}.csv`;
    }

    async function resolve(eventType, eventId, options = {}) {
        const type = String(eventType || '').trim();
        const id = String(eventId || '').trim();
        const key = `${type}/${id}`;
        if (!options.refresh && cache.has(key)) return cache.get(key);
        let metadata = { eventType: type, eventId: id, storyTitle: '', source: 'fallback' };
        try {
            const query = new URLSearchParams({ eventType: type, eventId: id });
            const response = await fetch(`./api/scenario-metadata?${query}`, { cache: 'no-store' });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
            metadata = Object.assign(metadata, body);
        } catch (_) {
            // Export remains available when the metadata site is offline. The
            // event id is deliberately kept in the fallback filename.
        }
        cache.set(key, metadata);
        return metadata;
    }

    async function resolveCsvFilename(eventType, eventId, options = {}) {
        return csvFilename(await resolve(eventType, eventId, options), options);
    }

    const api = { storyPrefix, safeFilenamePart, csvFilename, resolve, resolveCsvFilename };
    root.ScenarioStoryMetadata = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : window));
