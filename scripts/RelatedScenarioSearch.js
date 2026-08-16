'use strict';

(function exposeRelatedScenarioSearch(root) {
    const MANIFEST_PREFIX = 'shinymaster.related-scenarios.v1';

    function manifestKey(eventType, eventId) {
        return `${MANIFEST_PREFIX}.${String(eventType || '')}.${String(eventId || '')}`;
    }

    function normalizeManifestHits(hits) {
        const seen = new Set();
        return (hits || []).map((hit) => ({
            eventType: String(hit && hit.eventType || '').trim(),
            eventId: String(hit && hit.eventId || '').trim(),
            trackCount: Number(hit && (hit.trackCount || (Array.isArray(hit.tracks) ? hit.tracks.length : 0))) || 0,
            source: String(hit && hit.source || 'remote'),
        })).filter((hit) => {
            const key = `${hit.eventType}/${hit.eventId}`;
            if (!/^[a-z0-9_-]+$/i.test(hit.eventType)
                || !/^[a-z0-9_-]+$/i.test(hit.eventId)
                || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function saveManifest(result, storage = root.localStorage) {
        if (!storage || typeof storage.setItem !== 'function') return null;
        const hits = normalizeManifestHits(result && result.hits);
        if (!hits.length) return null;
        const manifest = {
            version: 1,
            savedAt: Date.now(),
            hits,
        };
        const serialized = JSON.stringify(manifest);
        hits.forEach(hit => storage.setItem(manifestKey(hit.eventType, hit.eventId), serialized));
        return manifest;
    }

    function loadManifest(eventType, eventId, storage = root.localStorage) {
        if (!storage || typeof storage.getItem !== 'function') return null;
        let parsed;
        try {
            parsed = JSON.parse(storage.getItem(manifestKey(eventType, eventId)) || 'null');
        } catch (_) {
            return null;
        }
        if (!parsed || parsed.version !== 1) return null;
        const hits = normalizeManifestHits(parsed.hits);
        const containsCurrent = hits.some(hit => hit.eventType === eventType && hit.eventId === eventId);
        return containsCurrent ? Object.assign({}, parsed, { hits }) : null;
    }

    function buildGroups(seedId, tensCount = 2, unitsCount = 9) {
        const value = String(seedId || '').trim();
        if (!/^\d{3,}$/.test(value)) {
            throw new Error('关联检索只支持至少三位的数字序列号。');
        }
        const prefix = value.slice(0, -2);
        const startTens = Number(value.slice(-2, -1));
        const groups = [];
        for (let offset = 0; offset < tensCount; offset++) {
            const tens = startTens + offset;
            if (tens > 9) break;
            const ids = [];
            for (let unit = 1; unit <= unitsCount; unit++) {
                ids.push(`${prefix}${tens}${unit}`);
            }
            groups.push({ label: `${prefix}${tens}X`, ids });
        }
        return groups;
    }

    async function scan(options) {
        const {
            seedId,
            eventTypes,
            fetchOne,
            onProgress = () => {},
            tensCount = 2,
            unitsCount = 9,
            maxConsecutiveMisses = 2,
        } = options || {};
        if (typeof fetchOne !== 'function') throw new Error('缺少剧情抓取函数。');
        const types = Array.from(new Set((eventTypes || []).filter(Boolean)));
        if (types.length === 0) throw new Error('至少需要一个剧情分类。');

        const hits = [];
        const misses = [];
        const groups = buildGroups(seedId, tensCount, unitsCount);
        let tested = 0;

        for (const group of groups) {
            let consecutiveMisses = 0;
            for (const eventId of group.ids) {
                if (consecutiveMisses >= maxConsecutiveMisses) break;
                tested++;
                onProgress({ phase: 'testing', eventId, group: group.label, tested, hits: hits.length });
                let found = null;
                const errors = [];
                for (const eventType of types) {
                    try {
                        found = await fetchOne(eventType, eventId);
                        found.eventType = eventType;
                        found.eventId = eventId;
                        break;
                    } catch (error) {
                        errors.push(`${eventType}: ${error.message}`);
                    }
                }
                if (found) {
                    consecutiveMisses = 0;
                    hits.push(found);
                    onProgress({ phase: 'hit', eventId, group: group.label, tested, hits: hits.length, found });
                } else {
                    consecutiveMisses++;
                    misses.push({ eventId, group: group.label, errors });
                    onProgress({
                        phase: 'miss', eventId, group: group.label, tested, hits: hits.length,
                        consecutiveMisses, maxConsecutiveMisses,
                    });
                }
            }
        }
        return { hits, misses, groups, tested };
    }

    const api = { buildGroups, scan, manifestKey, saveManifest, loadManifest, normalizeManifestHits };
    root.RelatedScenarioSearch = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : window));
