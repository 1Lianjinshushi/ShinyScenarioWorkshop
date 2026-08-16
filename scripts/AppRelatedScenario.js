'use strict';

(function wireRelatedScenarioSearch() {
    const remoteRoot = 'https://service.sc-viewer.top/custom';
    const remoteJsonFallback = 'https://service.sc-viewer.top/convert/cache/json';
    const standardTypes = [
        'produce_events',
        'special_communications',
        'game_event_communications',
    ];
    const button = document.getElementById('fetch-related');
    const panel = document.getElementById('related-results');
    const badge = document.getElementById('related-badge');
    const list = document.getElementById('related-list');

    async function requestScenario(eventType, eventId) {
        const candidates = [
            `${remoteRoot}/json/${eventType}/${eventId}.json`,
            `${remoteJsonFallback}/${eventType}/${eventId}.json`,
        ];
        const errors = [];
        for (const url of candidates) {
            try {
                const response = await fetch(url, { cache: 'no-store', mode: 'cors' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const rawJson = await response.text();
                const tracks = JSON.parse(rawJson);
                if (!Array.isArray(tracks) || tracks.length === 0) {
                    throw new Error('返回内容不是非空剧情轨道数组');
                }
                return { tracks, rawJson, sourceUrl: url };
            } catch (error) {
                errors.push(`${url}: ${error.message}`);
            }
        }
        throw new Error(errors.join(' | '));
    }

    function summarize(hit) {
        const speakers = Array.from(new Set(hit.tracks
            .map(track => track && typeof track.speaker === 'string' ? track.speaker.trim() : '')
            .filter(name => name && name !== 'off')));
        const unknown = speakers.filter(name => !state.speakerMap.has(name));
        const dialogueCount = hit.tracks.filter(track => track && (
            typeof track.text === 'string' || typeof track.select === 'string'
        )).length;
        return { speakers, unknown, dialogueCount };
    }

    function renderResult(result) {
        list.replaceChildren();
        if (result.hits.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = `共探测 ${result.tested} 个编号，没有取得可用剧情。`;
            list.appendChild(empty);
            badge.textContent = '没有命中';
            badge.className = 'badge warn';
            return;
        }

        result.hits.forEach((hit) => {
            const summary = summarize(hit);
            const row = document.createElement('div');
            row.className = 'related-row';

            const id = document.createElement('div');
            id.className = 'related-id';
            id.textContent = hit.eventId;

            const meta = document.createElement('div');
            meta.className = 'related-meta';
            const unknownText = summary.unknown.length
                ? ` · 缺失发言人 ${summary.unknown.join('、')}`
                : ' · 发言人均已留档';
            meta.textContent = `${hit.eventType} · ${hit.tracks.length} 轨道 · ${summary.dialogueCount} 对白${unknownText}`;

            const load = document.createElement('button');
            load.type = 'button';
            load.textContent = '载入此段';
            load.addEventListener('click', () => {
                document.getElementById('event-type').value = hit.eventType;
                document.getElementById('event-id').value = hit.eventId;
                fetchScenario();
            });
            row.append(id, meta, load);
            list.appendChild(row);
        });
        badge.textContent = `命中 ${result.hits.length} 段`;
        badge.className = 'badge good';
    }

    async function fetchRelatedScenarios() {
        let keys;
        try {
            keys = validateScenarioInput();
            RelatedScenarioSearch.buildGroups(keys.eventId);
        } catch (error) {
            setGlobalStatus(error.message, 'error');
            return;
        }

        button.disabled = true;
        panel.hidden = false;
        list.replaceChildren();
        badge.textContent = '正在检索…';
        badge.className = 'badge warn';
        setGlobalStatus(`正在从 ${keys.eventId} 起检索两个关联号段…`);

        const eventTypes = [keys.eventType, ...standardTypes];
        try {
            const result = await RelatedScenarioSearch.scan({
                seedId: keys.eventId,
                eventTypes,
                tensCount: 2,
                unitsCount: 9,
                maxConsecutiveMisses: 2,
                fetchOne: async (eventType, eventId) => {
                    const hit = await requestScenario(eventType, eventId);
                    await apiPost('./api/save-export', {
                        kind: 'japanese',
                        eventType,
                        eventId,
                        content: hit.rawJson,
                    });
                    return hit;
                },
                onProgress: (progress) => {
                    if (progress.phase === 'testing') {
                        badge.textContent = `探测 ${progress.eventId}`;
                        setGlobalStatus(`关联检索：${progress.group} · 正在探测 ${progress.eventId} · 已命中 ${progress.hits} 段`);
                    }
                },
            });
            RelatedScenarioSearch.saveManifest(result);
            renderResult(result);
            window.dispatchEvent(new CustomEvent('ssv-related-manifest-updated', { detail: result }));
            setGlobalStatus(
                `关联检索完成：探测 ${result.tested} 个编号，命中并留档 ${result.hits.length} 段日文 JSON。`,
                result.hits.length ? 'good' : 'error',
            );
        } catch (error) {
            badge.textContent = '检索失败';
            badge.className = 'badge warn';
            setGlobalStatus(`关联检索失败：${error.message}`, 'error');
        } finally {
            button.disabled = false;
        }
    }

    button.addEventListener('click', fetchRelatedScenarios);
    window.fetchRelatedScenarios = fetchRelatedScenarios;
}());
