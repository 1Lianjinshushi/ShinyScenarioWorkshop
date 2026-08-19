'use strict';

const REMOTE_ROOT = 'https://service.sc-viewer.top/custom';
const REMOTE_JSON_FALLBACK = 'https://service.sc-viewer.top/convert/cache/json';
const PRESERVED_ASSET_VALUES = new Set(['', 'on', 'off', 'pause', 'resume', 'fade_out']);
const VIDEO_EXPORT_FROZEN = true;
const TRANSLATOR_STORAGE_KEY = 'ssv-workshop-translator';

const state = {
    eventType: 'produce_events',
    eventId: '202701011',
    tracks: null,
    rawJson: '',
    sourceUrl: '',
    speakerMap: new Map(),
    speakers: [],
    unknownSpeakers: [],
    csvText: '',
    csvName: '',
    csvEventType: '',
    csvEventId: '',
    csvWorkflow: 'translation',
    csvWorkflowByScenario: new Map(),
    translationAvailable: false,
    storyResources: new Set(),
    cachedLocally: false,
    supportStills: [],
    cardMovies: [],
    supportCheckToken: 0,
    videoExportJob: '',
    videoExportActive: false,
    videoExportPollTimer: 0,
    videoExportBackend: '',
};

const ui = Object.fromEntries([
    'event-type', 'event-id', 'fetch-scenario', 'source-badge', 'scenario-summary',
    'track-count', 'dialogue-count', 'speaker-count', 'story-resource-count',
    'download-japanese', 'play-japanese', 'cache-resources', 'play-local',
    'cache-progress', 'cache-progress-bar', 'cache-progress-text', 'speaker-badge',
    'speaker-empty', 'speaker-editor', 'save-speakers', 'speaker-archive-path',
    'translation-csv', 'translation-batch', 'translation-batch-report', 'translation-badge', 'file-name', 'translation-report',
    'translation-related-select', 'translation-related',
    'build-translation', 'play-chinese', 'play-edit', 'export-video', 'export-video-browser', 'global-status',
    'video-export-report', 'video-export-progress-bar', 'video-export-progress-text',
    'video-export-unlock', 'video-export-cancel', 'video-export-download', 'video-export-frame',
    'obs-port', 'obs-password', 'obs-test', 'obs-export-status', 'obs-export-note',
    'support-still-panel', 'support-still-badge', 'support-still-list',
    'card-movie-panel', 'card-movie-badge', 'card-movie-list',
    'translator-name', 'translator-note',
].map(id => [id, document.getElementById(id)]));

function currentTranslatorName() {
    return String(ui['translator-name'] && ui['translator-name'].value || '').trim();
}

function normalizeTranslationCsv(content, eventType, eventId) {
    return ScenarioCsvTranslation.ensureScenarioCsvMetadata(
        String(content || ''),
        eventType,
        eventId,
        currentTranslatorName(),
    );
}

function initializeTranslatorSetting() {
    if (!ui['translator-name']) return;
    try {
        ui['translator-name'].value = localStorage.getItem(TRANSLATOR_STORAGE_KEY) || '';
    } catch (_) {
        // Storage can be unavailable in private browsing. The current-session
        // input still remains usable in that case.
    }
    const update = () => {
        const translator = currentTranslatorName();
        try {
            if (translator) localStorage.setItem(TRANSLATOR_STORAGE_KEY, translator);
            else localStorage.removeItem(TRANSLATOR_STORAGE_KEY);
        } catch (_) {}
        if (state.csvText && state.csvEventType && state.csvEventId) {
            try {
                state.csvText = normalizeTranslationCsv(
                    state.csvText,
                    state.csvEventType,
                    state.csvEventId,
                );
            } catch (_) {}
        }
        if (ui['translator-note']) {
            ui['translator-note'].textContent = translator
                ? `已记住“${translator}”，导出时自动写入译者行`
                : '将自动写入【翻】和【校】CSV；留空时保留文件原署名';
        }
    };
    ui['translator-name'].addEventListener('input', update);
    update();
    window.SSVWorkshopSettings = Object.freeze({
        translatorName: currentTranslatorName,
        translatorStorageKey: TRANSLATOR_STORAGE_KEY,
    });
}

function setGlobalStatus(message, tone = '') {
    ui['global-status'].textContent = message;
    ui['global-status'].style.color = tone === 'error' ? 'var(--bad)' : tone === 'good' ? 'var(--good)' : '';
}

function setBadge(id, message, tone = '') {
    const badge = ui[id];
    badge.textContent = message;
    badge.className = `badge${tone ? ` ${tone}` : ''}`;
}

function validateScenarioInput() {
    const eventType = ui['event-type'].value.trim();
    const eventId = ui['event-id'].value.trim();
    if (!/^[a-z0-9_-]+$/i.test(eventType)) throw new Error('剧情分类格式不正确。');
    if (!/^[a-z0-9_-]+$/i.test(eventId)) throw new Error('剧情序列号格式不正确。');
    return { eventType, eventId };
}

async function apiPost(path, payload, contentType = 'application/json') {
    const body = contentType === 'application/json' ? JSON.stringify(payload) : payload;
    const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `本地接口返回 HTTP ${response.status}`);
    return data;
}

async function loadAppState() {
    try {
        const response = await fetch('./api/state', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        state.speakerMap = new Map((data.speakers || []).map(row => [row.name, row.trans]));
        ui['speaker-archive-path'].textContent = data.speakerArchive || '';
    } catch (error) {
        setGlobalStatus(`本地管理接口未启动：${error.message}。请关闭旧服务器后双击 start-viewer.cmd。`, 'error');
    }
}

async function fetchScenario() {
    let keys;
    try {
        keys = validateScenarioInput();
    } catch (error) {
        setGlobalStatus(error.message, 'error');
        return;
    }
    const pendingCsv = state.csvText
        && state.csvEventType === keys.eventType
        && state.csvEventId === keys.eventId
        ? {
            text: state.csvText,
            name: state.csvName,
            eventType: state.csvEventType,
            eventId: state.csvEventId,
            archived: state.translationAvailable,
            workflow: state.csvWorkflow,
        }
        : null;
    state.eventType = keys.eventType;
    state.eventId = keys.eventId;
    state.tracks = null;
    state.rawJson = '';
    state.sourceUrl = '';
    state.speakers = [];
    state.unknownSpeakers = [];
    state.storyResources = new Set();
    state.cachedLocally = false;
    state.csvText = '';
    state.csvName = '';
    state.csvEventType = '';
    state.csvEventId = '';
    state.csvWorkflow = state.csvWorkflowByScenario.get(`${keys.eventType}/${keys.eventId}`)
        || 'translation';
    state.translationAvailable = false;
    ui['file-name'].textContent = '未选择文件';
    setBadge('translation-badge', '正在检查本地 CSV…');
    state.supportStills = [];
    state.cardMovies = [];
    state.supportCheckToken++;
    renderSupportStillPanel();
    renderCardMoviePanel();
    ui['fetch-scenario'].disabled = true;
    setBadge('source-badge', '正在抓取…', 'warn');
    setGlobalStatus(`正在取得 ${state.eventType}/${state.eventId}.json…`);

    const candidates = [
        `${REMOTE_ROOT}/json/${state.eventType}/${state.eventId}.json`,
        `${REMOTE_JSON_FALLBACK}/${state.eventType}/${state.eventId}.json`,
    ];
    const errors = [];
    try {
        for (const url of candidates) {
            try {
                const response = await fetch(url, { cache: 'no-store', mode: 'cors' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const text = await response.text();
                const parsed = JSON.parse(text);
                if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('返回内容不是剧情轨道数组');
                state.tracks = parsed;
                state.rawJson = text;
                state.sourceUrl = url;
                break;
            } catch (error) {
                errors.push(`${url}: ${error.message}`);
            }
        }
        if (!state.tracks) throw new Error(errors.join('\n'));

        state.speakers = Array.from(new Set(state.tracks
            .map(track => track && typeof track.speaker === 'string' ? track.speaker.trim() : '')
            .filter(name => name && name !== 'off')));
        state.storyResources = deriveStoryResourcePaths(state.tracks, state.eventType, state.eventId);
        refreshUnknownSpeakers();
        renderScenarioSummary();
        renderSpeakerEditor();

        await apiPost('./api/save-export', {
            kind: 'japanese',
            eventType: state.eventType,
            eventId: state.eventId,
            content: state.rawJson,
        });

        const supportResult = await inspectSupportStillResources();
        await inspectCardMovieResources();
        await loadSavedTranslationForCurrentScenario();
        if (pendingCsv) {
            setCurrentTranslationCsv(
                pendingCsv.eventType,
                pendingCsv.eventId,
                pendingCsv.name,
                pendingCsv.text,
                pendingCsv.archived,
                pendingCsv.workflow,
            );
        }

        setBadge('source-badge', '日文 JSON 已留档', 'good');
        if (supportResult.missing) {
            setGlobalStatus(`已取得 ${state.eventId}；有 ${supportResult.missing} 张 Support 卡图尚未同步，请在卡图栏选择页游截图。`, 'error');
        } else {
            setGlobalStatus(`已取得 ${state.eventId}，原版 JSON 已保存。`, 'good');
        }
        refreshTranslationRelatedOptions();
        return true;
    } catch (error) {
        state.tracks = null;
        setBadge('source-badge', '抓取失败', 'warn');
        setGlobalStatus(`抓取失败：${error.message}`, 'error');
        return false;
    } finally {
        ui['fetch-scenario'].disabled = false;
        updateActionAvailability();
    }
}

function refreshTranslationRelatedOptions() {
    const select = ui['translation-related-select'];
    const button = ui['translation-related'];
    if (!select || !button) return;
    const manifest = RelatedScenarioSearch.loadManifest(state.eventType, state.eventId);
    const hits = manifest && Array.isArray(manifest.hits) ? manifest.hits : [];
    select.replaceChildren();
    if (!hits.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '尚未检索；点击右侧按钮开始检索';
        select.appendChild(option);
        select.disabled = true;
        button.disabled = false;
        button.textContent = '检索关联剧情';
        return;
    }
    hits.forEach(hit => {
        const option = document.createElement('option');
        option.value = `${hit.eventType}/${hit.eventId}`;
        option.textContent = `${hit.eventId}${hit.eventId === state.eventId ? '（当前）' : ''}`;
        option.selected = hit.eventType === state.eventType && hit.eventId === state.eventId;
        select.appendChild(option);
    });
    select.disabled = false;
    button.disabled = false;
    button.textContent = '切换关联剧情';
}

async function switchTranslationRelatedScenario() {
    const select = ui['translation-related-select'];
    if (!select || select.disabled || !select.value) {
        const search = document.getElementById('fetch-related');
        if (search) search.click();
        return;
    }
    const [eventType, eventId] = select.value.split('/');
    if (!eventType || !eventId) return;
    if (eventType === state.eventType && eventId === state.eventId) {
        setGlobalStatus('当前已经是所选关联剧情。');
        return;
    }
    ui['event-type'].value = eventType;
    ui['event-id'].value = eventId;
    await fetchScenario();
    const panel = ui['translation-related'].closest('.panel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderScenarioSummary() {
    const dialogueCount = state.tracks.filter(track => track && (typeof track.text === 'string' || typeof track.select === 'string')).length;
    ui['track-count'].textContent = String(state.tracks.length);
    ui['dialogue-count'].textContent = String(dialogueCount);
    ui['speaker-count'].textContent = String(state.speakers.length);
    ui['story-resource-count'].textContent = String(state.storyResources.size);
    ui['scenario-summary'].hidden = false;
}

function refreshUnknownSpeakers() {
    state.unknownSpeakers = state.speakers.filter(name => !state.speakerMap.has(name));
}

function renderSpeakerEditor() {
    refreshUnknownSpeakers();
    ui['speaker-editor'].replaceChildren();
    if (!state.tracks) {
        ui['speaker-empty'].hidden = false;
        ui['speaker-empty'].textContent = '载入剧情后会在这里列出缺失名称。';
        ui['speaker-editor'].hidden = true;
        setBadge('speaker-badge', '等待剧情');
        ui['save-speakers'].disabled = true;
        return;
    }
    if (state.unknownSpeakers.length === 0) {
        ui['speaker-empty'].hidden = false;
        ui['speaker-empty'].textContent = `本段的 ${state.speakers.length} 个发言人均已留档。`;
        ui['speaker-editor'].hidden = true;
        setBadge('speaker-badge', '没有缺失名称', 'good');
        ui['save-speakers'].disabled = true;
        return;
    }

    ui['speaker-empty'].hidden = true;
    ui['speaker-editor'].hidden = false;
    state.unknownSpeakers.forEach((name) => {
        const row = document.createElement('div');
        row.className = 'speaker-row';
        const original = document.createElement('div');
        original.className = 'speaker-jp';
        original.textContent = name;
        const arrow = document.createElement('div');
        arrow.className = 'arrow';
        arrow.textContent = '→';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '输入中文名称';
        input.dataset.speaker = name;
        input.autocomplete = 'off';
        row.append(original, arrow, input);
        ui['speaker-editor'].appendChild(row);
    });
    setBadge('speaker-badge', `缺少 ${state.unknownSpeakers.length} 个`, 'warn');
    ui['save-speakers'].disabled = false;
}

async function saveSpeakerTranslations() {
    const entries = Array.from(ui['speaker-editor'].querySelectorAll('input[data-speaker]'))
        .map(input => ({ name: input.dataset.speaker, trans: input.value.trim() }))
        .filter(row => row.trans);
    if (entries.length === 0) {
        setGlobalStatus('请至少填写一个发言人中文名称。', 'error');
        return;
    }
    ui['save-speakers'].disabled = true;
    try {
        const result = await apiPost('./api/speakers', { entries });
        state.speakerMap = new Map(result.speakers.map(row => [row.name, row.trans]));
        renderSpeakerEditor();
        setGlobalStatus(`已保存 ${entries.length} 条发言人译名。`, 'good');
    } catch (error) {
        setGlobalStatus(`发言人留档失败：${error.message}`, 'error');
    } finally {
        if (state.unknownSpeakers.length) ui['save-speakers'].disabled = false;
    }
}

function isAssetValue(value) {
    return typeof value === 'string' && value && !PRESERVED_ASSET_VALUES.has(value);
}

function deriveStoryResourcePaths(tracks, eventType, eventId) {
    const paths = new Set([`json/${eventType}/${eventId}.json`]);
    const add = path => path && paths.add(path.replace(/^\/+/, ''));
    const addTextFrame = (value) => {
        if (!isAssetValue(value)) return;
        add(`images/event/text_frame/${value}.png`);
        add(`images/event/log_text_frame/${value}.png`);
    };

    tracks.forEach((track) => {
        if (!track || typeof track !== 'object') return;
        if (isAssetValue(track.bg)) add(`images/event/bg/${track.bg}.jpg`);
        if (isAssetValue(track.fg)) add(`images/event/fg/${track.fg}.png`);
        if (isAssetValue(track.middleFg)) add(`images/event/fg/${track.middleFg}.png`);
        if (isAssetValue(track.bgm)) add(`sounds/bgm/${track.bgm}.m4a`);
        if (isAssetValue(track.se)) add(`sounds/se/event/${track.se}.m4a`);
        if (isAssetValue(track.voice)) add(`sounds/voice/events/${track.voice}.m4a`);
        if (isAssetValue(track.still)) add(`images/event/still/${track.still}.jpg`);
        if (isAssetValue(track.movie)) add(`movies/idols/card/${track.movie}.mp4`);
        addTextFrame(track.textFrame);

        if (track.stillType && track.stillId) {
            if (track.stillType === 'game_event_communications') {
                add(`movies/game_event_communications/${track.stillId}.mp4`);
                add(`sounds/se/game_event_communications/${track.stillId}.m4a`);
            } else {
                add(`images/content/${track.stillType}/card/${track.stillId}.jpg`);
            }
        }
        if (track.charType && track.charId) {
            const category = SPINE_ALIAS[track.charCategory] || track.charCategory || 'stand';
            const base = `spine/${track.charType}/${category}/${track.charId}`;
            add(`${base}/data.json`);
            add(`${base}/data.atlas`);
            add(`${base}/data.png`);
        }
        if (track.speaker && !PRODUCER_SPEAKERS.has(track.speaker) && track.speaker !== 'off') {
            if (SPEAKER_ICON_SUB[track.speaker]) {
                add(`images/content/sub_characters/icon_circle_l/${SPEAKER_ICON_SUB[track.speaker]}.png`);
            } else if (SPEAKER_ICON_MAIN[track.speaker]) {
                add(`images/content/characters/icon_circle_l/${SPEAKER_ICON_MAIN[track.speaker]}.png`);
            } else {
                add(`images/content/${DEFAULT_SPEAKER_ICON_TYPE}/icon_circle_l/${DEFAULT_SPEAKER_ICON_ID}.png`);
            }
        }
    });

    if (tracks.length && tracks[0].textFrame === undefined) addTextFrame(DEFAULT_TEXT_FRAME);
    return paths;
}

function encodeResourcePath(path) {
    return String(path).split('/').map(encodeURIComponent).join('/');
}

function localResourceUrl(path, cacheBust = false) {
    const url = `./assets/${encodeResourcePath(path)}`;
    return cacheBust ? `${url}?local=${Date.now()}` : url;
}

async function localResourceExists(path) {
    return SupportStillFallback.resourceExists(localResourceUrl(path));
}

function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function requestOfficialCardResource(kind, cardId, path) {
    const result = await apiPost(
        `./api/request-official-card-resource?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(cardId)}`,
        new Uint8Array(0),
        'application/octet-stream',
    );
    if (result.status === 'ready' || await localResourceExists(path)) return true;
    if (!result.listenerActive) return false;
    // The page-game userscript polls this local queue every 2.5 seconds. Keep
    // the wait bounded so a closed/sleeping game tab never blocks the workshop.
    for (let attempt = 0; attempt < 16; attempt++) {
        await wait(500);
        if (await localResourceExists(path)) return true;
    }
    return false;
}

function supportStillReady(status) {
    return ['ready-local', 'ready-official', 'ready-remote', 'ready-community'].includes(status);
}

function supportStillStatus(item) {
    const labels = {
        checking: ['正在检查本地与页游资源…', ''],
        'ready-local': ['已使用本地替代图', 'good'],
        'ready-official': ['已从当前页游会话按需取得', 'good'],
        'ready-remote': ['资源站已有，已自动缓存到本地', 'good'],
        'ready-community': ['已从 shinycolors.moe 补取并缓存', 'good'],
        missing: ['资源站尚无此图，请选择页游截图', 'bad'],
        uploading: ['正在处理并保存截图…', ''],
        error: [item.error || '卡图处理失败', 'bad'],
    };
    return labels[item.status] || ['等待检查', ''];
}

function renderSupportStillPanel() {
    const panel = ui['support-still-panel'];
    const list = ui['support-still-list'];
    if (!panel || !list) return;
    list.replaceChildren();
    if (!state.supportStills.length) {
        panel.hidden = true;
        return;
    }

    panel.hidden = false;
    const ready = state.supportStills.filter(item => supportStillReady(item.status)).length;
    const missing = state.supportStills.filter(item => item.status === 'missing' || item.status === 'error').length;
    const checking = state.supportStills.length - ready - missing;
    setBadge('support-still-badge', checking ? `检查中 ${checking}` : missing ? `缺少 ${missing} 张` : `已就绪 ${ready} 张`, missing ? 'warn' : ready === state.supportStills.length ? 'good' : '');

    state.supportStills.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'support-still-row';

        let preview;
        if (supportStillReady(item.status)) {
            preview = document.createElement('img');
            preview.alt = `Support 卡图 ${item.stillId}`;
            preview.src = localResourceUrl(item.path, true);
        } else {
            preview = document.createElement('div');
            preview.classList.add('empty');
            preview.textContent = '等待卡图';
        }
        preview.classList.add('support-still-preview');

        const info = document.createElement('div');
        info.className = 'support-still-info';
        const id = document.createElement('span');
        id.className = 'support-still-id';
        id.textContent = item.stillId;
        const path = document.createElement('span');
        path.className = 'support-still-path';
        path.textContent = `assets/${item.path}`;
        const status = document.createElement('span');
        const [statusText, statusTone] = supportStillStatus(item);
        status.className = `support-still-status${statusTone ? ` ${statusTone}` : ''}`;
        status.textContent = statusText;
        info.append(id, path, status);

        const upload = document.createElement('label');
        upload.className = 'support-still-upload';
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/jpeg,image/png,image/webp';
        input.disabled = item.status === 'uploading';
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            if (file) saveSupportStillScreenshot(item, file);
        });
        const buttonText = document.createElement('span');
        buttonText.textContent = supportStillReady(item.status) ? '替换截图' : '选择截图';
        upload.append(input, buttonText);
        row.append(preview, info, upload);
        list.appendChild(row);
    });
}

async function inspectSupportStillResources() {
    const token = ++state.supportCheckToken;
    state.supportStills = SupportStillFallback.collect(state.tracks).map(item => ({ ...item, status: 'checking', error: '' }));
    renderSupportStillPanel();
    if (!state.supportStills.length) return { total: 0, missing: 0 };

    await Promise.all(state.supportStills.map(async (item) => {
        if (await localResourceExists(item.path)) {
            item.status = 'ready-local';
            if (token === state.supportCheckToken) renderSupportStillPanel();
            return;
        }
        try {
            if (await requestOfficialCardResource('support-still', item.stillId, item.path)) {
                item.status = 'ready-official';
                if (token === state.supportCheckToken) renderSupportStillPanel();
                return;
            }
        } catch (error) {
            item.officialError = error.message;
        }
        try {
            const response = await fetch(`${REMOTE_ROOT}/${encodeResourcePath(item.path)}`, { cache: 'no-store', mode: 'cors' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const contentType = String(response.headers.get('content-type') || '').toLowerCase();
            if (contentType && !contentType.startsWith('image/')) throw new Error(`返回类型 ${contentType}`);
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.length < 512) throw new Error('返回的图片文件过小');
            await apiPost(`./api/cache-resource?path=${encodeURIComponent(item.path)}`, bytes, 'application/octet-stream');
            item.status = 'ready-remote';
        } catch (primaryError) {
            try {
                const result = await apiPost(
                    `./api/fetch-card-resource?kind=support-still&id=${encodeURIComponent(item.stillId)}`,
                    new Uint8Array(0),
                    'application/octet-stream',
                );
                item.status = 'ready-community';
                item.sourceUrl = result.source || '';
            } catch (communityError) {
                item.status = 'missing';
                item.error = `${item.officialError ? `页游：${item.officialError}；` : ''}${primaryError.message}；shinycolors.moe：${communityError.message}`;
            }
        }
        if (token === state.supportCheckToken) renderSupportStillPanel();
    }));

    if (token !== state.supportCheckToken) return { total: 0, missing: 0 };
    renderSupportStillPanel();
    return {
        total: state.supportStills.length,
        missing: state.supportStills.filter(item => item.status === 'missing' || item.status === 'error').length,
    };
}

async function decodeScreenshot(file) {
    if (!file.type.startsWith('image/')) throw new Error('请选择 JPG、PNG 或 WebP 图片。');
    if (file.size > 40 * 1024 * 1024) throw new Error('截图超过 40 MB。');
    if (typeof createImageBitmap === 'function') return createImageBitmap(file);
    const url = URL.createObjectURL(file);
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        return image;
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function normalizeSupportStillScreenshot(file) {
    const image = await decodeScreenshot(file);
    const sourceWidth = image.width || image.naturalWidth;
    const sourceHeight = image.height || image.naturalHeight;
    if (!sourceWidth || !sourceHeight) throw new Error('无法读取截图尺寸。');
    const canvas = document.createElement('canvas');
    canvas.width = 1136;
    canvas.height = 640;
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
    const width = Math.round(sourceWidth * scale);
    const height = Math.round(sourceHeight * scale);
    context.drawImage(image, Math.round((canvas.width - width) / 2), Math.round((canvas.height - height) / 2), width, height);
    if (typeof image.close === 'function') image.close();
    return new Promise((resolve, reject) => canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('截图转换为 JPEG 失败。')),
        'image/jpeg',
        0.95,
    ));
}

async function saveSupportStillScreenshot(item, file) {
    item.status = 'uploading';
    item.error = '';
    renderSupportStillPanel();
    try {
        const blob = await normalizeSupportStillScreenshot(file);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        await apiPost(`./api/cache-resource?path=${encodeURIComponent(item.path)}`, bytes, 'application/octet-stream');
        item.status = 'ready-local';
        setGlobalStatus(`已保存 Support 卡图 ${item.stillId}；在线播放也会优先使用这张本地图。`, 'good');
    } catch (error) {
        item.status = 'error';
        item.error = error.message;
        setGlobalStatus(`Support 卡图保存失败：${error.message}`, 'error');
    }
    renderSupportStillPanel();
}

function renderCardMoviePanel() {
    const panel = ui['card-movie-panel'];
    const list = ui['card-movie-list'];
    if (!panel || !list) return;
    list.replaceChildren();
    if (!state.cardMovies.length) {
        panel.hidden = true;
        return;
    }

    panel.hidden = false;
    const ready = state.cardMovies.filter(item => ['ready-local', 'ready-official'].includes(item.status)).length;
    const uploading = state.cardMovies.filter(item => item.status === 'uploading' || item.status === 'checking').length;
    setBadge('card-movie-badge', uploading ? `检查中 ${uploading}` : ready ? `已就绪 ${ready}/${state.cardMovies.length}` : `本地缺少 ${state.cardMovies.length} 个`, ready === state.cardMovies.length ? 'good' : 'warn');

    state.cardMovies.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'support-still-row';
        const preview = document.createElement('div');
        preview.className = 'support-still-preview movie';
        preview.textContent = 'MP4';

        const info = document.createElement('div');
        info.className = 'support-still-info';
        const id = document.createElement('span');
        id.className = 'support-still-id';
        id.textContent = item.movieId;
        const path = document.createElement('span');
        path.className = 'support-still-path';
        path.textContent = `assets/${item.path}`;
        const status = document.createElement('span');
        const statusMap = {
            checking: ['正在检查本地与页游视频…', ''],
            missing: ['本地未保存；在线播放失败时请选择 MP4', 'bad'],
            uploading: ['正在保存视频…', ''],
            'ready-local': ['已绑定本地动态卡图', 'good'],
            'ready-official': ['已从当前页游会话按需取得', 'good'],
            error: [item.error || '视频保存失败', 'bad'],
        };
        const [statusText, statusTone] = statusMap[item.status] || ['等待检查', ''];
        status.className = `support-still-status${statusTone ? ` ${statusTone}` : ''}`;
        status.textContent = statusText;
        const source = document.createElement('a');
        source.className = 'support-still-source';
        source.href = `https://cf-static.shinycolors.moe/movies/idols/card/${encodeURIComponent(item.movieId)}.mp4`;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        source.textContent = '在 shinycolors.moe 打开对应 MP4';
        info.append(id, path, status, source);

        const upload = document.createElement('label');
        upload.className = 'support-still-upload';
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.mp4,video/mp4';
        input.disabled = item.status === 'uploading';
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            if (file) saveCardMovieFile(item, file);
        });
        const buttonText = document.createElement('span');
        buttonText.textContent = ['ready-local', 'ready-official'].includes(item.status) ? '替换 MP4' : '选择 MP4';
        upload.append(input, buttonText);
        row.append(preview, info, upload);
        list.appendChild(row);
    });
}

async function inspectCardMovieResources() {
    state.cardMovies = SupportStillFallback.collectMovies(state.tracks).map(item => ({ ...item, status: 'checking', error: '' }));
    renderCardMoviePanel();
    await Promise.all(state.cardMovies.map(async (item) => {
        if (await localResourceExists(item.path)) {
            item.status = 'ready-local';
        } else {
            try {
                item.status = await requestOfficialCardResource('produce-movie', item.movieId, item.path)
                    ? 'ready-official'
                    : 'missing';
            } catch (error) {
                item.status = 'missing';
                item.error = error.message;
            }
        }
        renderCardMoviePanel();
    }));
    renderCardMoviePanel();
}

async function saveCardMovieFile(item, file) {
    item.status = 'uploading';
    item.error = '';
    renderCardMoviePanel();
    try {
        if (!/\.mp4$/i.test(file.name) && file.type !== 'video/mp4') throw new Error('请选择 MP4 视频文件。');
        if (!file.size) throw new Error('视频文件为空。');
        if (file.size > 120 * 1024 * 1024) throw new Error('视频超过 120 MB，无法通过本地接口保存。');
        await apiPost(`./api/cache-resource?path=${encodeURIComponent(item.path)}`, file, 'application/octet-stream');
        item.status = 'ready-local';
        setGlobalStatus(`已绑定动态卡图 ${item.movieId}；在线播放会优先使用本地 MP4。`, 'good');
    } catch (error) {
        item.status = 'error';
        item.error = error.message;
        setGlobalStatus(`动态卡图保存失败：${error.message}`, 'error');
    }
    renderCardMoviePanel();
}

function deriveCommonResourcePaths(tracks) {
    const paths = new Set([
        'images/ui/produce_event/parts_event.json',
        'images/ui/start_and_common/parts.json',
        'images/ui/common/parts.json',
        'images/ui/init/parts_pop.json',
        'sounds/se/002.m4a',
        'sounds/se/003.m4a',
        'sounds/se/004.m4a',
        'sounds/se/227.m4a',
        'particles/common/tap_effect/images.json',
        'particles/common/tap_effect/particle.json',
        'particles/common/tap_effect/feather.json',
    ]);
    let run = 0;
    let max = 0;
    tracks.forEach((track) => {
        if (track && track.select) {
            run += Array.isArray(track.select) ? track.select.length : 1;
            max = Math.max(max, run);
        } else {
            run = 0;
        }
    });
    for (let i = 1; i <= Math.min(max, 5); i++) {
        paths.add(`images/event/select_frame/${String(i).padStart(3, '0')}.png`);
    }
    return paths;
}

function resolveRelativeResource(basePath, child) {
    if (!child || /^(?:https?:|data:|\/)/i.test(child)) return null;
    const base = new URL(basePath, 'https://local.invalid/');
    const resolved = new URL(child, base);
    return resolved.pathname.replace(/^\//, '');
}

function discoverDependencies(path, bytes) {
    const dependencies = [];
    const decoder = new TextDecoder('utf-8');
    if (/\.json$/i.test(path)) {
        try {
            const data = JSON.parse(decoder.decode(bytes));
            if (data && data.meta) {
                if (typeof data.meta.image === 'string') {
                    dependencies.push(resolveRelativeResource(path, data.meta.image));
                }
                if (Array.isArray(data.meta.related_multi_packs)) {
                    data.meta.related_multi_packs.forEach(item => dependencies.push(resolveRelativeResource(path, item)));
                }
            }
        } catch (_) {}
    }
    if (/\.atlas$/i.test(path)) {
        decoder.decode(bytes).split(/\r?\n/).forEach((line) => {
            const value = line.trim();
            if (/^[^:]+\.(?:png|jpe?g|webp)$/i.test(value)) {
                dependencies.push(resolveRelativeResource(path, value));
            }
        });
    }
    return dependencies.filter(Boolean);
}

async function cacheCompleteResources() {
    if (!state.tracks) return;
    ui['cache-resources'].disabled = true;
    ui['cache-progress'].hidden = false;
    ui['cache-progress-bar'].style.width = '0%';
    setGlobalStatus('正在缓存完整资源；请保持页面打开。');

    const scenarioPath = `json/${state.eventType}/${state.eventId}.json`;
    const pending = Array.from(new Set([
        ...state.storyResources,
        ...deriveCommonResourcePaths(state.tracks),
    ])).filter(path => path !== scenarioPath);
    const seen = new Set(pending);
    const failures = [];
    let completed = 0;
    let cursor = 0;

    try {
        await apiPost(`./api/cache-resource?path=${encodeURIComponent(scenarioPath)}`,
            new TextEncoder().encode(state.rawJson), 'application/octet-stream');

        const updateProgress = () => {
            const total = Math.max(pending.length, 1);
            ui['cache-progress-bar'].style.width = `${Math.min(100, completed / total * 100)}%`;
            ui['cache-progress-text'].textContent = `已缓存 ${completed + 1}/${total + 1} 项；失败 ${failures.length} 项`;
        };

        const worker = async () => {
            while (true) {
                const index = cursor++;
                if (index >= pending.length) return;
                const path = pending[index];
                try {
                    if (await localResourceExists(path)) continue;
                    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
                    const response = await fetch(`${REMOTE_ROOT}/${encodedPath}`, { cache: 'no-store', mode: 'cors' });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const bytes = new Uint8Array(await response.arrayBuffer());
                    await apiPost(`./api/cache-resource?path=${encodeURIComponent(path)}`, bytes, 'application/octet-stream');
                    discoverDependencies(path, bytes).forEach((dependency) => {
                        if (!seen.has(dependency)) {
                            seen.add(dependency);
                            pending.push(dependency);
                        }
                    });
                } catch (error) {
                    failures.push(`${path}: ${error.message}`);
                } finally {
                    completed++;
                    updateProgress();
                }
            }
        };

        await Promise.all(Array.from({ length: 6 }, () => worker()));
        state.cachedLocally = failures.length === 0;
        ui['play-local'].disabled = !state.cachedLocally;
        if (failures.length) {
            ui['cache-progress-text'].textContent = `完成：成功 ${completed - failures.length + 1} 项，失败 ${failures.length} 项。${failures.slice(0, 3).join('；')}`;
            setGlobalStatus('资源缓存完成，但有文件下载失败；仍建议使用在线播放。', 'error');
        } else {
            ui['cache-progress-bar'].style.width = '100%';
            ui['cache-progress-text'].textContent = `完整缓存 ${completed + 1} 项，可离线播放。`;
            setGlobalStatus(`完整资源已缓存，共 ${completed + 1} 项。`, 'good');
        }
    } catch (error) {
        setGlobalStatus(`资源缓存失败：${error.message}`, 'error');
    } finally {
        ui['cache-resources'].disabled = false;
    }
}

function translatedRowCount(rows) {
    return rows.filter(row => row.id && row.id !== 'info' && row.id !== '译者' && row.trans.trim()).length;
}

function showDetectedCsvId(fileName, eventId) {
    ui['event-id'].value = eventId;
}

function inferredScenarioTypeCandidates(eventId) {
    const value = String(eventId || '').trim();
    if (/^\d{12}$/.test(value)) {
        return {
            '1': ['produce_communications'],
            '2': ['produce_communication_promise_results'],
            '3': ['produce_communication_judges'],
            '4': ['produce_communication_cheers'],
            '5': ['produce_communication_auditions'],
            '6': ['produce_communication_televisions'],
        }[value[0]] || [];
    }
    if (/^2\d{10}$/.test(value)) return ['produce_communications_promises'];
    if (/^99\d{6}$/.test(value)) return ['business_unit_communication'];
    if (/^4001\d{5}$/.test(value)) return ['game_event_communications'];
    if (/^[123567]\d{8,9}$/.test(value)) return ['produce_events'];
    if (/^49\d{6,16}$/.test(value)) return ['special_communications', 'mypage_communications'];
    return [];
}

async function resolveScenarioEventType(fileName, eventId, fallbackEventType = '') {
    const base = String(fileName || '').replace(/\.csv$/i, '');
    const explicit = /^([A-Za-z0-9_-]+)__([A-Za-z0-9_-]+)$/.exec(base);
    if (explicit) {
        if (explicit[2] !== eventId) {
            throw new Error(`文件名编号 ${explicit[2]} 与 CSV id 列识别结果 ${eventId} 不一致`);
        }
        return explicit[1];
    }

    let knownTypes = [];
    try {
        const response = await fetch(`./api/scenario-types?eventId=${encodeURIComponent(eventId)}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && Array.isArray(payload.eventTypes)) {
            knownTypes = payload.eventTypes.filter(item => /^[a-z0-9_-]+$/i.test(item));
        }
    } catch (_) {
        // Older portable servers do not expose the catalogue lookup.  The
        // deterministic ID rules below still cover cards, events and training.
    }
    const candidates = knownTypes.length ? knownTypes : inferredScenarioTypeCandidates(eventId);
    if (fallbackEventType && candidates.includes(fallbackEventType)) return fallbackEventType;
    if (candidates.length === 1) return candidates[0];
    const priority = [
        'produce_events', 'game_event_communications', 'special_communications',
        'mypage_communications', 'business_unit_communication',
    ];
    const preferred = priority.find(item => candidates.includes(item));
    if (preferred) return preferred;
    if (fallbackEventType && /^[a-z0-9_-]+$/i.test(fallbackEventType)) return fallbackEventType;
    throw new Error(`无法根据剧情编号 ${eventId} 判断剧情分类`);
}

async function handleCsvSelection(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
        const importedText = await file.text();
        const rows = ScenarioCsvTranslation.parseScenarioCsv(importedText);
        const eventId = ScenarioCsvTranslation.inferScenarioEventId(rows);
        const eventType = await resolveScenarioEventType(file.name, eventId, ui['event-type'].value.trim());
        const text = normalizeTranslationCsv(importedText, eventType, eventId);
        const translated = translatedRowCount(rows);
        const workflow = translated > 0 ? 'correction' : 'translation';
        state.csvWorkflowByScenario.set(`${eventType}/${eventId}`, workflow);
        showDetectedCsvId(file.name, eventId);
        ui['event-type'].value = eventType;
        state.csvText = text;
        state.csvName = file.name;
        state.csvEventType = eventType;
        state.csvEventId = eventId;
        state.csvWorkflow = workflow;
        state.translationAvailable = false;
        ui['file-name'].textContent = `${file.name} · 剧情 ${eventId} · ${translated} 条译文`;
        const matchesLoadedScenario = state.tracks
            && state.eventType === eventType
            && state.eventId === eventId;
        if (matchesLoadedScenario) {
            setCurrentTranslationCsv(eventType, eventId, file.name, text, false, workflow);
            updateActionAvailability();
            setGlobalStatus(`已载入 ${eventType}/${eventId} 的翻译 CSV，可以直接播放或进入编辑模式。`, 'good');
        } else {
            setBadge('translation-badge', `正在载入 ${eventId}…`, 'warn');
            updateActionAvailability();
            setGlobalStatus(`已识别 ${eventType}/${eventId}，正在自动抓取日文原版并载入翻译…`);
            const loaded = await fetchScenario();
            if (!loaded) {
                state.csvText = text;
                state.csvName = file.name;
                state.csvEventType = eventType;
                state.csvEventId = eventId;
                state.translationAvailable = false;
                setBadge('translation-badge', 'CSV 已读取，日文原版抓取失败', 'warn');
                ui['file-name'].textContent = `${file.name} · 剧情 ${eventId} · ${translated} 条译文`;
            }
        }
    } catch (error) {
        state.csvText = '';
        state.csvName = '';
        state.csvEventType = '';
        state.csvEventId = '';
        setBadge('translation-badge', 'CSV 格式或编号错误', 'warn');
        ui['file-name'].textContent = file.name;
        updateActionAvailability();
        setGlobalStatus(`CSV 读取失败：${error.message}`, 'error');
    } finally {
        event.target.value = '';
    }
}

async function batchCsvTarget(fileName, fallbackEventType, inferredEventId) {
    const base = String(fileName || '').replace(/\.csv$/i, '');
    const explicit = /^([A-Za-z0-9_-]+)__([A-Za-z0-9_-]+)$/.exec(base);
    const declaredEventId = explicit
        ? explicit[2]
        : (!inferredEventId && /^[A-Za-z0-9_-]+$/.test(base) ? base : '');
    if (inferredEventId && explicit && inferredEventId !== declaredEventId) {
        throw new Error(`文件名编号 ${declaredEventId} 与 CSV id 列识别结果 ${inferredEventId} 不一致`);
    }
    const eventId = inferredEventId || declaredEventId;
    const eventType = explicit
        ? explicit[1]
        : await resolveScenarioEventType(fileName, eventId, fallbackEventType);
    if (!/^[A-Za-z0-9_-]+$/.test(eventType) || !/^[A-Za-z0-9_-]+$/.test(eventId)) {
        throw new Error(`无法从 CSV 内容或文件名识别剧情编号：${fileName}`);
    }
    return { eventType, eventId };
}

function setCurrentTranslationCsv(eventType, eventId, fileName, text, archived = true, workflow = '') {
    if (!state.tracks || state.eventType !== eventType || state.eventId !== eventId) return false;
    const normalizedText = normalizeTranslationCsv(text, eventType, eventId);
    state.csvText = normalizedText;
    state.csvName = fileName;
    state.csvEventType = eventType;
    state.csvEventId = eventId;
    state.translationAvailable = archived;
    const rows = ScenarioCsvTranslation.parseScenarioCsv(normalizedText);
    const translated = translatedRowCount(rows);
    const normalizedWorkflow = workflow === 'correction' || workflow === 'translation'
        ? workflow
        : state.csvWorkflow === 'correction' ? 'correction' : 'translation';
    state.csvWorkflow = normalizedWorkflow;
    state.csvWorkflowByScenario.set(`${eventType}/${eventId}`, normalizedWorkflow);
    ui['file-name'].textContent = `${fileName} · 剧情 ${eventId} · ${translated} 条译文${archived ? ' · 已留档' : ''}`;
    setBadge('translation-badge', archived ? '本地 CSV 可播放' : 'CSV 已读取', 'good');
    return true;
}

async function handleBatchCsvSelection(event) {
    const files = Array.from(event.target.files || []).filter(file => /\.csv$/i.test(file.name));
    const report = ui['translation-batch-report'];
    report.hidden = false;
    report.replaceChildren();
    if (!files.length) {
        report.textContent = '没有选择 CSV 文件。';
        return;
    }

    const fallbackEventType = ui['event-type'].value.trim();
    const usedTargets = new Set();
    const successes = [];
    const failures = [];
    setGlobalStatus(`正在导入 ${files.length} 份翻译 CSV…`);
    ui['translation-batch'].disabled = true;
    try {
        for (const file of files) {
            try {
                const importedText = await file.text();
                const rows = ScenarioCsvTranslation.parseScenarioCsv(importedText);
                let inferredEventId = '';
                try {
                    inferredEventId = ScenarioCsvTranslation.inferScenarioEventId(rows);
                } catch (error) {
                    const base = String(file.name || '').replace(/\.csv$/i, '');
                    if (!/^([A-Za-z0-9_-]+__)?[A-Za-z0-9_-]+$/.test(base)) throw error;
                }
                const target = await batchCsvTarget(file.name, fallbackEventType, inferredEventId);
                const text = normalizeTranslationCsv(importedText, target.eventType, target.eventId);
                const key = `${target.eventType}/${target.eventId}`;
                if (usedTargets.has(key)) throw new Error(`批次中剧情编号重复：${key}`);
                usedTargets.add(key);
                const translated = translatedRowCount(rows);
                const workflow = translated > 0 ? 'correction' : 'translation';
                state.csvWorkflowByScenario.set(key, workflow);
                await apiPost('./api/save-translation', {
                    eventType: target.eventType,
                    eventId: target.eventId,
                    content: text,
                    translator: currentTranslatorName(),
                });
                successes.push({
                    fileName: file.name,
                    eventType: target.eventType,
                    eventId: target.eventId,
                    text,
                    translated,
                    workflow,
                    line: `${file.name} → ${key}（${translated} 条）`,
                });
                setCurrentTranslationCsv(target.eventType, target.eventId, file.name, text, true, workflow);
            } catch (error) {
                failures.push(`${file.name}：${error.message}`);
            }
        }
    } finally {
        ui['translation-batch'].disabled = false;
        event.target.value = '';
    }

    const summary = document.createElement('div');
    summary.innerHTML = `<strong>已导入 ${successes.length}/${files.length}</strong> · 失败 ${failures.length}`;
    report.appendChild(summary);
    if (successes.length) {
        const line = document.createElement('div');
        line.textContent = successes.slice(0, 8).map(item => item.line).join('；');
        report.appendChild(line);
    }
    failures.slice(0, 8).forEach((failure) => {
        const line = document.createElement('div');
        line.className = 'bad';
        line.textContent = failure;
        report.appendChild(line);
    });
    if (successes.length) {
        const manifest = RelatedScenarioSearch.saveManifest({
            hits: successes.map(item => ({
                eventType: item.eventType,
                eventId: item.eventId,
                source: 'translation-import',
            })),
        });
        if (manifest) {
            window.dispatchEvent(new CustomEvent('ssv-related-manifest-updated', { detail: manifest }));
        }
        const first = successes[0];
        ui['event-type'].value = first.eventType;
        ui['event-id'].value = first.eventId;
        state.csvText = first.text;
        state.csvName = first.fileName;
        state.csvEventType = first.eventType;
        state.csvEventId = first.eventId;
        state.csvWorkflow = first.workflow;
        state.translationAvailable = true;
        await fetchScenario();
    }
    setGlobalStatus(
        failures.length
            ? `批量导入完成：成功 ${successes.length}，失败 ${failures.length}；已载入首篇可用剧情。`
            : `已批量留档 ${successes.length} 份翻译 CSV，并载入首篇剧情；可从“关联剧情”切换其余篇章。`,
        failures.length ? 'error' : 'good',
    );
    updateActionAvailability();
}

async function loadSavedTranslationForCurrentScenario() {
    const loaded = await ScenarioCsvTranslation.loadTranslation(state.eventType, state.eventId);
    if (loaded.text == null) {
        state.translationAvailable = false;
        setBadge('translation-badge', '可直接新建编辑稿');
        ui['file-name'].textContent = '尚无译文；进入编辑模式时会自动建立空白 CSV';
        return;
    }
    try {
        ScenarioCsvTranslation.parseScenarioCsv(loaded.text);
        setCurrentTranslationCsv(
            state.eventType,
            state.eventId,
            `${state.eventId}.csv`,
            loaded.text,
            true,
            state.csvWorkflowByScenario.get(`${state.eventType}/${state.eventId}`) || 'translation',
        );
    } catch (error) {
        state.translationAvailable = false;
        setBadge('translation-badge', '本地 CSV 格式错误', 'warn');
        setGlobalStatus(`已找到本地 CSV，但无法读取：${error.message}`, 'error');
    }
}

async function ensureEditableTranslationCsv() {
    if (!state.tracks) throw new Error('请先载入剧情。');
    const matchesCurrent = !!state.csvText
        && state.csvEventType === state.eventType
        && state.csvEventId === state.eventId;
    if (matchesCurrent) return saveTranslationForPlayback();

    const content = ScenarioCsvTranslation.createEditableScenarioCsv(state.tracks, {
        eventType: state.eventType,
        eventId: state.eventId,
        translator: currentTranslatorName(),
    });
    const merged = ScenarioCsvTranslation.mergeScenarioTranslation(state.tracks, content);
    const result = await apiPost('./api/save-translation', {
        eventType: state.eventType,
        eventId: state.eventId,
        content,
        translator: currentTranslatorName(),
    });
    setCurrentTranslationCsv(state.eventType, state.eventId, `${state.eventId}.csv`, content, true, 'translation');
    setGlobalStatus(`已为 ${state.eventId} 建立空白编辑稿，可直接结合画面开始翻译。`, 'good');
    return { merged, result };
}

async function buildTranslatedJson() {
    if (!state.tracks
        || !state.csvText
        || state.csvEventType !== state.eventType
        || state.csvEventId !== state.eventId) return;
    ui['build-translation'].disabled = true;
    try {
        state.csvText = normalizeTranslationCsv(state.csvText, state.eventType, state.eventId);
        const merged = ScenarioCsvTranslation.mergeScenarioTranslation(state.tracks, state.csvText);
        let speakerChanges = 0;
        const localized = merged.tracks.map((track) => {
            if (!track || typeof track !== 'object' || Array.isArray(track)) return track;
            const next = Object.assign({}, track);
            if (typeof next.text_cn === 'string' && next.text_cn.trim()) {
                next.text_ja = next.text;
                next.text = next.text_cn;
            }
            if (typeof next.select_cn === 'string' && next.select_cn.trim()) {
                next.select_ja = next.select;
                next.select = next.select_cn;
            }
            if (typeof next.speaker === 'string') {
                const translated = state.speakerMap.get(next.speaker);
                if (translated && translated !== next.speaker) {
                    next.speaker_ja = next.speaker;
                    next.speaker_cn = translated;
                    next.speaker = translated;
                    speakerChanges++;
                }
            }
            return next;
        });
        const output = `${JSON.stringify(localized, null, 2)}\n`;

        const [exportResult, csvResult] = await Promise.all([
            apiPost('./api/save-export', {
                kind: 'translated',
                eventType: state.eventType,
                eventId: state.eventId,
                content: output,
            }),
            apiPost('./api/save-translation', {
                eventType: state.eventType,
                eventId: state.eventId,
                content: state.csvText,
                translator: currentTranslatorName(),
            }),
        ]);

        downloadText(`${state.eventId}.zh-cn.json`, output, 'application/json');
        renderTranslationReport(merged.report, speakerChanges, exportResult.saved, csvResult.saved);
        setBadge('translation-badge', `已合成 ${merged.report.applied}/${merged.report.total}`, merged.report.missing ? 'warn' : 'good');
        ui['play-chinese'].disabled = false;
        state.translationAvailable = true;
        setGlobalStatus(`汉化 JSON 已合成并留档：${exportResult.saved}`, merged.report.missing ? 'error' : 'good');
    } catch (error) {
        setGlobalStatus(`合成失败：${error.message}`, 'error');
    } finally {
        ui['build-translation'].disabled = false;
    }
}

async function saveTranslationForPlayback() {
    if (!state.tracks
        || !state.csvText
        || state.csvEventType !== state.eventType
        || state.csvEventId !== state.eventId) {
        throw new Error('当前 CSV 与已载入剧情编号不一致，请重新选择或抓取对应剧情。');
    }
    state.csvText = normalizeTranslationCsv(state.csvText, state.eventType, state.eventId);
    const merged = ScenarioCsvTranslation.mergeScenarioTranslation(state.tracks, state.csvText);
    const result = await apiPost('./api/save-translation', {
        eventType: state.eventType,
        eventId: state.eventId,
        content: state.csvText,
        translator: currentTranslatorName(),
    });
    state.translationAvailable = true;
    setBadge(
        'translation-badge',
        `最新 CSV 已保存 ${merged.report.applied}/${merged.report.total}`,
        merged.report.missing ? 'warn' : 'good',
    );
    return { merged, result };
}

async function playChineseScenario() {
    const playbackWindow = openPlaybackWindow();
    ui['play-chinese'].disabled = true;
    try {
        await saveTranslationForPlayback();
        sendPlaybackWindow(playbackWindow, playerUrl('cn', 'remote'));
        updateActionAvailability();
    } catch (error) {
        if (playbackWindow && !playbackWindow.closed) playbackWindow.close();
        setGlobalStatus(`汉化播放准备失败：${error.message}`, 'error');
        updateActionAvailability();
    }
}

async function playEditScenario() {
    const playbackWindow = openPlaybackWindow();
    ui['play-edit'].disabled = true;
    try {
        await ensureEditableTranslationCsv();
        sendPlaybackWindow(playbackWindow, playerUrl('cn', 'remote', 'edit'));
        updateActionAvailability();
    } catch (error) {
        if (playbackWindow && !playbackWindow.closed) playbackWindow.close();
        setGlobalStatus(`编辑模式准备失败：${error.message}`, 'error');
        updateActionAvailability();
    }
}

function formatVideoExportTime(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function showVideoExportProgress(message, options = {}) {
    const report = ui['video-export-report'];
    const bar = ui['video-export-progress-bar'];
    report.hidden = false;
    ui['video-export-progress-text'].textContent = message;
    if (options.indeterminate) {
        bar.classList.add('indeterminate');
        bar.style.width = '32%';
    } else {
        bar.classList.remove('indeterminate');
        bar.style.width = `${Math.max(0, Math.min(100, Number(options.progress || 0)))}%`;
    }
}

function stopVideoExportPolling() {
    if (state.videoExportPollTimer) clearInterval(state.videoExportPollTimer);
    state.videoExportPollTimer = 0;
}

function finishVideoExportUi(job, error = null) {
    stopVideoExportPolling();
    state.videoExportActive = false;
    ui['video-export-unlock'].hidden = true;
    ui['video-export-cancel'].hidden = true;
    if (error) {
        showVideoExportProgress(`视频直出失败：${error}`, { progress: 0 });
        setGlobalStatus(`视频直出失败：${error}`, 'error');
    } else {
        const quality = job.qualityWarning ? `；${job.qualityWarning}` : '';
        showVideoExportProgress(`视频已导出：${job.outputPath || job.outputUrl}${quality}`, { progress: 100 });
        const link = ui['video-export-download'];
        link.href = job.outputUrl;
        link.download = `${job.eventId || state.eventId}.mp4`;
        link.hidden = false;
        setGlobalStatus(
            `1080p60 MP4 已导出：${job.outputPath || job.outputUrl}${quality}`,
            job.qualityWarning ? 'error' : 'good',
        );
    }
    ui['video-export-frame'].src = 'about:blank';
    state.videoExportJob = '';
    state.videoExportBackend = '';
    updateActionAvailability();
}

async function pollVideoExportStatus() {
    if (!state.videoExportJob) return;
    try {
        const statusApi = state.videoExportBackend === 'obs'
            ? './api/obs-export/status'
            : './api/video-export/status';
        const response = await fetch(`${statusApi}?job=${encodeURIComponent(state.videoExportJob)}`, {
            cache: 'no-store',
        });
        const job = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(job.error || `HTTP ${response.status}`);
        if (job.state === 'ready') {
            finishVideoExportUi(job);
            return;
        }
        if (job.state === 'error') {
            finishVideoExportUi(job, job.error || job.stage || '未知错误');
            return;
        }
        if (job.state === 'transcoding') {
            ui['video-export-frame'].src = 'about:blank';
            showVideoExportProgress(`${job.stage || '正在封装 MP4'} · ${job.progress || 0}%`, {
                progress: job.progress || 0,
            });
        } else if (job.backend === 'obs' && ['preparing', 'loading', 'recording', 'finalizing'].includes(job.state)) {
            const started = job.startedAt ? Date.parse(job.startedAt) : 0;
            const elapsed = started ? ` · ${formatVideoExportTime(Date.now() - started)}` : '';
            showVideoExportProgress(`${job.stage || 'OBS 正在处理'}${elapsed}`, {
                progress: job.progress || 0,
                indeterminate: job.state === 'loading' || job.state === 'recording',
            });
        } else if (job.state === 'receiving' && !ui['video-export-progress-text'].textContent.includes('渲染')) {
            showVideoExportProgress(job.stage || '等待播放器开始录制', { indeterminate: true });
        }
    } catch (error) {
        finishVideoExportUi({}, error.message);
    }
}

function beginVideoExportPolling() {
    stopVideoExportPolling();
    state.videoExportPollTimer = setInterval(pollVideoExportStatus, 1000);
    pollVideoExportStatus();
}

function videoExportPlayerUrl(jobId) {
    const params = new URLSearchParams({
        eventType: state.eventType,
        eventId: state.eventId,
        source: 'remote',
        language: 'cn',
        mode: 'export',
        exportJob: jobId,
        translationRevision: String(Date.now()),
    });
    return `./?${params.toString()}`;
}

function obsConnectionPayload() {
    const port = Number(ui['obs-port'].value || 4455);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('OBS WebSocket 端口格式不正确。');
    }
    return { port, password: ui['obs-password'].value || '' };
}

async function testObsConnection() {
    ui['obs-test'].disabled = true;
    setBadge('obs-export-status', '正在检测');
    try {
        const result = await apiPost('./api/obs/probe', obsConnectionPayload());
        const resolution = result.video
            ? `${result.video.outputWidth}×${result.video.outputHeight} ${Math.round(result.video.fpsNumerator / result.video.fpsDenominator)}fps`
            : '视频设置未知';
        const encoder = result.recordEncoder || '编码器未知';
        const notes = [`OBS ${result.obsVersion || ''}`, result.profile ? `配置 ${result.profile}` : '', resolution, encoder]
            .filter(Boolean).join(' · ');
        if (!result.audioSafe) {
            setBadge('obs-export-status', '音频设置不安全', 'warn');
            ui['obs-export-note'].textContent = `${notes}。请先禁用 OBS 的桌面音频和全部麦克风/Aux，否则会录入系统声音并可能触发蓝牙通话模式。`;
            setGlobalStatus('OBS 已连接，但全局音频设备仍未禁用。', 'error');
        } else {
            setBadge('obs-export-status', result.encoderIsNvenc ? 'OBS / NVENC 就绪' : 'OBS 已连接', result.encoderIsNvenc ? 'good' : 'warn');
            ui['obs-export-note'].textContent = `${notes}。${result.encoderIsNvenc ? '将使用 NVIDIA 硬件编码。' : '当前不是 NVENC；可用，但建议在 OBS 输出设置中改成 NVIDIA NVENC。'} OBS 只录画面，剧情混音由播放器内部独立录制后合并；你可以在 Edge 中正常看视频。`;
            setGlobalStatus('OBS WebSocket 连接正常。', 'good');
        }
    } catch (error) {
        setBadge('obs-export-status', '连接失败', 'warn');
        ui['obs-export-note'].textContent = `OBS 检测失败：${error.message}`;
        setGlobalStatus(`OBS 检测失败：${error.message}`, 'error');
    } finally {
        ui['obs-test'].disabled = false;
    }
}

function ensureVideoExportable() {
    if ((state.tracks || []).some(track => track && typeof track === 'object' && track.select)) {
        throw new Error('当前剧情含有选择支；直出第一版暂不自动替你选择，请先使用普通播放。');
    }
}

async function exportChineseVideoObs() {
    if (state.videoExportActive) return;
    ui['video-export-download'].hidden = true;
    ui['video-export-unlock'].hidden = true;
    ui['video-export-cancel'].hidden = false;
    state.videoExportActive = true;
    state.videoExportBackend = 'obs';
    updateActionAvailability();
    showVideoExportProgress('正在保存最新 CSV 并连接 OBS……', { indeterminate: true });
    try {
        ensureVideoExportable();
        await saveTranslationForPlayback();
        const job = await apiPost('./api/obs-export/create', Object.assign({
            eventType: state.eventType,
            eventId: state.eventId,
        }, obsConnectionPayload()));
        state.videoExportJob = job.jobId;
        showVideoExportProgress(job.stage || 'OBS 正在后台预载剧情资源……', { indeterminate: true });
        beginVideoExportPolling();
    } catch (error) {
        state.videoExportJob = '';
        finishVideoExportUi({}, error.message);
    }
}

async function exportChineseVideoBrowser() {
    if (state.videoExportActive) return;
    ui['video-export-download'].hidden = true;
    ui['video-export-unlock'].hidden = true;
    ui['video-export-cancel'].hidden = false;
    state.videoExportActive = true;
    state.videoExportBackend = 'browser';
    updateActionAvailability();
    showVideoExportProgress('正在保存最新 CSV 并建立视频任务……', { indeterminate: true });
    try {
        ensureVideoExportable();
        await saveTranslationForPlayback();
        const job = await apiPost('./api/video-export/create', {
            eventType: state.eventType,
            eventId: state.eventId,
        });
        state.videoExportJob = job.jobId;
        showVideoExportProgress('正在后台加载剧情和资源……', { indeterminate: true });
        beginVideoExportPolling();
        ui['video-export-frame'].src = videoExportPlayerUrl(job.jobId);
    } catch (error) {
        state.videoExportJob = '';
        finishVideoExportUi({}, error.message);
    }
}

function handleVideoExportMessage(payload) {
    if (!state.videoExportActive || payload.jobId !== state.videoExportJob) return;
    if (payload.stage === 'needs-gesture') {
        showVideoExportProgress(payload.message || '浏览器需要一次声音授权。', { indeterminate: true });
        ui['video-export-unlock'].hidden = false;
        return;
    }
    if (payload.stage === 'ready') {
        showVideoExportProgress('资源加载完成，正在启动 AUTO 实时渲染……', { indeterminate: true });
        return;
    }
    if (payload.stage === 'warming') {
        showVideoExportProgress(payload.message || '正在预热纹理与渲染器……', { indeterminate: true });
        return;
    }
    if (payload.stage === 'preroll') {
        showVideoExportProgress(payload.message || '正在预录并稳定编码器；这段不会出现在成片中……', { indeterminate: true });
        return;
    }
    if (payload.stage === 'scenario-start') {
        showVideoExportProgress('预卷完成，正在按 AUTO 实时渲染……', { indeterminate: true });
        return;
    }
    if (payload.stage === 'capturing' || payload.stage === 'upload') {
        ui['video-export-unlock'].hidden = true;
        const size = payload.uploadedBytes
            ? ` · 已写入 ${(payload.uploadedBytes / 1024 / 1024).toFixed(1)} MiB`
            : '';
        showVideoExportProgress(`正在按 AUTO 实时渲染 ${formatVideoExportTime(payload.elapsedMs)}${size}`, {
            indeterminate: true,
        });
        return;
    }
    if (payload.stage === 'tail') {
        showVideoExportProgress(payload.message || '正在保留剧情收尾……', { indeterminate: true });
        return;
    }
    if (payload.stage === 'transcoding') {
        ui['video-export-frame'].src = 'about:blank';
        showVideoExportProgress('实时渲染完成，正在封装 1080p60 MP4……', { progress: 0 });
        return;
    }
    if (payload.stage === 'error') {
        finishVideoExportUi({}, payload.message || '播放器报告了未知错误');
    }
}

function renderTranslationReport(report, speakerChanges, jsonPath, csvPath) {
    const panel = ui['translation-report'];
    panel.replaceChildren();
    const summary = document.createElement('div');
    summary.innerHTML = `<strong>正文 ${report.applied}/${report.total}</strong> · ID 匹配 ${report.explicitId} · 顺序匹配 ${report.sequential} · 发言人替换 ${speakerChanges}`;
    panel.appendChild(summary);
    const details = document.createElement('div');
    details.textContent = `原文不一致 ${report.sourceMismatches} · 未匹配 ${report.missing} · JSON ${jsonPath} · CSV ${csvPath}`;
    if (report.missing || report.sourceMismatches) details.className = 'bad';
    panel.appendChild(details);
    report.problems.slice(0, 6).forEach((problem) => {
        const line = document.createElement('div');
        line.className = 'bad';
        line.textContent = problem;
        panel.appendChild(line);
    });
    panel.hidden = false;
}

function downloadText(filename, content, type) {
    const blob = new Blob([content], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function playerUrl(language, source, mode = '') {
    const params = new URLSearchParams({ eventType: state.eventType, eventId: state.eventId, source });
    params.set('returnMode', 'close');
    if (mode) params.set('mode', mode);
    if (mode === 'edit') params.set('editWorkflow', state.csvWorkflow);
    if (language) {
        params.set('language', language);
        params.set('translationRevision', String(Date.now()));
    }
    return `./?${params.toString()}`;
}

function openPlaybackWindow() {
    const playbackWindow = window.open('about:blank', '_blank');
    if (!playbackWindow) return null;
    playbackWindow.document.title = '正在准备剧情播放…';
    playbackWindow.document.body.style.cssText = 'margin:0;background:#000;color:#ddd;font:16px sans-serif;display:grid;place-items:center;height:100vh';
    playbackWindow.document.body.textContent = '正在保存并准备剧情资源…';
    return playbackWindow;
}

function sendPlaybackWindow(playbackWindow, url) {
    if (playbackWindow && !playbackWindow.closed) {
        playbackWindow.location.replace(url);
        return;
    }
    // Popup blocking is uncommon for a direct button click, but keep playback
    // usable when the browser is configured to reject new tabs.
    window.location.href = url;
}

function playScenarioInNewTab(language, source) {
    const playbackWindow = openPlaybackWindow();
    sendPlaybackWindow(playbackWindow, playerUrl(language, source));
}

function updateActionAvailability() {
    const loaded = !!state.tracks;
    const csvMatchesCurrent = loaded
        && !!state.csvText
        && state.csvEventType === state.eventType
        && state.csvEventId === state.eventId;
    ui['download-japanese'].disabled = !loaded;
    ui['play-japanese'].disabled = !loaded;
    ui['cache-resources'].disabled = !loaded;
    ui['play-local'].disabled = !state.cachedLocally;
    ui['build-translation'].disabled = !csvMatchesCurrent;
    ui['play-chinese'].disabled = !csvMatchesCurrent;
    // Editing can start from the loaded Japanese JSON. If no translation CSV
    // exists yet, playEditScenario creates and archives a blank working copy.
    ui['play-edit'].disabled = !loaded;
    ui['export-video'].disabled = VIDEO_EXPORT_FROZEN || !csvMatchesCurrent || state.videoExportActive;
    ui['export-video-browser'].disabled = VIDEO_EXPORT_FROZEN || !csvMatchesCurrent || state.videoExportActive;
    ui['obs-test'].disabled = VIDEO_EXPORT_FROZEN;
}

ui['fetch-scenario'].addEventListener('click', fetchScenario);
ui['download-japanese'].addEventListener('click', () => downloadText(`${state.eventId}.json`, state.rawJson, 'application/json'));
ui['play-japanese'].addEventListener('click', () => playScenarioInNewTab('', 'remote'));
ui['cache-resources'].addEventListener('click', cacheCompleteResources);
ui['play-local'].addEventListener('click', () => playScenarioInNewTab('', 'local'));
ui['save-speakers'].addEventListener('click', saveSpeakerTranslations);
ui['translation-csv'].addEventListener('change', handleCsvSelection);
ui['translation-batch'].addEventListener('change', handleBatchCsvSelection);
ui['translation-related'].addEventListener('click', switchTranslationRelatedScenario);
ui['build-translation'].addEventListener('click', buildTranslatedJson);
ui['play-chinese'].addEventListener('click', playChineseScenario);
ui['play-edit'].addEventListener('click', playEditScenario);
ui['export-video'].addEventListener('click', exportChineseVideoObs);
ui['export-video-browser'].addEventListener('click', exportChineseVideoBrowser);
ui['obs-test'].addEventListener('click', testObsConnection);
ui['video-export-cancel'].addEventListener('click', async () => {
    if (!state.videoExportJob) return;
    ui['video-export-cancel'].disabled = true;
    try {
        const endpoint = state.videoExportBackend === 'obs'
            ? './api/obs-export/cancel'
            : './api/video-export/cancel';
        await apiPost(endpoint, { jobId: state.videoExportJob, error: '用户取消了视频直出' });
        finishVideoExportUi({}, '用户取消了视频直出');
    } catch (error) {
        setGlobalStatus(`取消直出失败：${error.message}`, 'error');
    } finally {
        ui['video-export-cancel'].disabled = false;
    }
});
ui['video-export-unlock'].addEventListener('click', () => {
    const frameWindow = ui['video-export-frame'].contentWindow;
    if (frameWindow && typeof frameWindow.__startScenarioExportFromWorkshop === 'function') {
        frameWindow.__startScenarioExportFromWorkshop();
    } else {
        setGlobalStatus('后台播放器还没有准备好，请稍等一秒再点。', 'error');
    }
});

window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    const payload = event.data;
    if (payload && payload.type === 'ssv-video-export') {
        handleVideoExportMessage(payload);
        return;
    }
    if (!payload || payload.type !== 'ssv-translation-saved') return;
    if (payload.eventType !== state.eventType || payload.eventId !== state.eventId) return;
    try {
        if (setCurrentTranslationCsv(
            payload.eventType,
            payload.eventId,
            `${payload.eventId}.csv`,
            String(payload.content || ''),
            true,
        )) {
            updateActionAvailability();
            setGlobalStatus('编辑模式中的修改已同步回工坊。', 'good');
        }
    } catch (error) {
        setGlobalStatus(`编辑修改已保存，但工坊同步失败：${error.message}`, 'error');
    }
});

window.addEventListener('ssv-related-manifest-updated', refreshTranslationRelatedOptions);

initializeTranslatorSetting();
loadAppState();
refreshTranslationRelatedOptions();
