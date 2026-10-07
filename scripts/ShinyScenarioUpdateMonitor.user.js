// ==UserScript==
// @name         Shiny Colors 剧情更新监听器
// @namespace    shiny-scenario-workshop
// @version      0.9.2
// @description  轻量监听剧情清单、公开主数据与按需卡资源；不主动调用页游认证接口。
// @match        https://shinycolors.enza.fun/*
// @run-at       document-start
// @sandbox      raw
// @inject-into  page
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      127.0.0.1
// @connect      api.shinycolors.moe
// ==/UserScript==

(function () {
    'use strict';

    const LOCAL_OBSERVATION_URL = 'http://127.0.0.1:8000/api/game-update-observation';
    const LOCAL_STATUS_URL = 'http://127.0.0.1:8000/api/game-update-status';
    const LOCAL_OFFICIAL_RESOURCE_URL = 'http://127.0.0.1:8000/api/import-official-card-resource';
    const LOCAL_OFFICIAL_REQUESTS_URL = 'http://127.0.0.1:8000/api/official-card-resource-requests';
    const LOCAL_WORKSHOP_URL = 'http://127.0.0.1:8000/app.html#game-update-monitor';
    const KNOWN_KEY = 'shiny-scenario-monitor-known-v1';
    const DATASITE_CHECK_KEY = 'shiny-scenario-monitor-datasite-check-v1';
    const METADATA_CACHE_KEY = 'shiny-scenario-monitor-metadata-v1';
    const PENDING_CARD_COUNT_KEY = 'shiny-scenario-monitor-pending-card-count-v1';
    const NIGHTLY_CHECK_KEY = 'shiny-scenario-monitor-nightly-check-v1';
    const DATASITE_API_ROOT = 'https://api.shinycolors.moe';
    const CHECK_INTERVAL = 10 * 60 * 1000;
    const RETRY_INTERVAL = 15 * 1000;
    const MAX_RETRIES = 20;
    const SCRIPT_VERSION = '0.9.2';
    const ASSET_MODULE_HINT = 5431;
    const SCENARIO_TYPES = new Set([
        'business_unit_communication',
        'produce_communication_auditions',
        'produce_communication_promise_results',
        'produce_communication_televisions',
        'support_skills',
        'game_event_communications',
        'produce_communication_cheers',
        'produce_communications',
        'produce_events',
        'mypage_communications',
        'produce_communication_judges',
        'produce_communications_promises',
        'special_communications',
    ]);
    const CHARACTER_NAMES = Object.freeze({
        '001': ['樱木真乃', '櫻木真乃'], '002': ['风野灯织', '風野灯織'],
        '003': ['八宫巡', '八宮めぐる'], '004': ['月冈恋钟', '月岡恋鐘'],
        '005': ['田中摩美美', '田中摩美々'], '006': ['白濑咲耶', '白瀬咲耶'],
        '007': ['三峰结华', '三峰結華'], '008': ['幽谷雾子', '幽谷霧子'],
        '009': ['小宫果穗', '小宮果穂'], '010': ['园田智代子', '園田智代子'],
        '011': ['西城树里', '西城樹里'], '012': ['杜野凛世', '杜野凛世'],
        '013': ['有栖川夏叶', '有栖川夏葉'], '014': ['大崎甘奈', '大崎甘奈'],
        '015': ['大崎甜花', '大崎甜花'], '016': ['桑山千雪', '桑山千雪'],
        '017': ['芹泽朝日', '芹沢あさひ'], '018': ['黛冬优子', '黛冬優子'],
        '019': ['和泉爱依', '和泉愛依'], '020': ['浅仓透', '浅倉透'],
        '021': ['樋口圆香', '樋口円香'], '022': ['福丸小糸', '福丸小糸'],
        '023': ['市川雏菜', '市川雛菜'], '024': ['七草日花', '七草にちか'],
        '025': ['绯田美琴', '緋田美琴'], '026': ['斑鸠路加', '斑鳩ルカ'],
        '027': ['铃木羽那', '鈴木羽那'], '028': ['郁田阳希', '郁田はるき'],
    });

    let webpackRequire = null;
    const webpackRequires = [];
    let assetMap = null;
    const unavailableAssetMaps = new WeakMap();
    let retryCount = 0;
    let syncTimer = 0;
    let discoveryTimer = 0;
    let nightlyTimer = 0;
    let restoreModuleCallHook = null;
    let assetUrlTransformer = null;
    let assetUrlTransformerSearched = false;
    const metadata = new Map();
    let lastStatusStage = '';

    const cachedMetadataRows = GM_getValue(METADATA_CACHE_KEY, []);
    for (const row of Array.isArray(cachedMetadataRows) ? cachedMetadataRows : []) {
        if (row && row.eventType && row.eventId) metadata.set(`${row.eventType}/${row.eventId}`, row);
    }

    function sendLocal(url, payload, callbacks = {}) {
        try {
            GM_xmlhttpRequest({
                method: 'POST',
                url,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify(payload),
                timeout: 10000,
                onload: callbacks.onload || (() => {}),
                onerror: callbacks.onerror || (() => {}),
                ontimeout: callbacks.ontimeout || callbacks.onerror || (() => {}),
            });
        } catch (error) {
            console.warn('[ShinyScenarioMonitor] local request failed', error);
        }
    }

    function requestJson(url, options = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url,
                headers: options.headers || { Accept: 'application/json' },
                data: options.data,
                timeout: options.timeout || 30000,
                onload: response => {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`HTTP ${response.status}`));
                        return;
                    }
                    try { resolve(JSON.parse(response.responseText || '{}')); }
                    catch (error) { reject(error); }
                },
                onerror: () => reject(new Error('network error')),
                ontimeout: () => reject(new Error('request timeout')),
            });
        });
    }

    async function syncCommunityResource(kind, cardId) {
        return requestJson(
            `http://127.0.0.1:8000/api/fetch-card-resource?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(cardId)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                data: '{}',
                timeout: 120000,
            },
        );
    }

    function uploadOfficialResource(kind, cardId, buffer, contentType) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${LOCAL_OFFICIAL_RESOURCE_URL}?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(cardId)}`,
                headers: { 'Content-Type': contentType || 'application/octet-stream' },
                data: buffer,
                timeout: 120000,
                onload: response => {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`local HTTP ${response.status}`));
                        return;
                    }
                    try { resolve(JSON.parse(response.responseText || '{}')); }
                    catch (error) { reject(error); }
                },
                onerror: () => reject(new Error('local upload failed')),
                ontimeout: () => reject(new Error('local upload timeout')),
            });
        });
    }

    function rememberMetadata(rows) {
        let changed = false;
        for (const row of Array.isArray(rows) ? rows : []) {
            if (!row || !row.eventType || !row.eventId) continue;
            const key = `${row.eventType}/${row.eventId}`;
            const old = metadata.get(key) || {};
            const merged = Object.assign({}, old, row);
            if (old.metadataSource === 'official-game-api' && row.metadataSource !== 'official-game-api') {
                merged.metadataSource = 'official-game-api';
                for (const field of ['cardName', 'storyTitle', 'cardId', 'cardType', 'cardRarity']) {
                    if (old[field]) merged[field] = old[field];
                }
            }
            if (JSON.stringify(old) !== JSON.stringify(merged)) {
                metadata.set(key, merged);
                changed = true;
            }
        }
        if (changed) {
            const cached = Array.from(metadata.values())
                .sort((a, b) => String(b.eventId || '').localeCompare(String(a.eventId || '')))
                .slice(0, 800);
            GM_setValue(METADATA_CACHE_KEY, cached);
        }
        return changed;
    }

    function reportStatus(stage, message, details = {}) {
        if (stage === lastStatusStage && !details.force) return;
        lastStatusStage = stage;
        console.info(`[ShinyScenarioMonitor] ${stage}: ${message}`);
        sendLocal(LOCAL_STATUS_URL, {
            stage,
            message,
            scriptVersion: SCRIPT_VERSION,
            pageUrl: location.href,
            details,
        });
    }

    function parseScenarioPath(value) {
        const path = String(value || '').replace(/\\/g, '/').replace(/[?#].*$/, '').replace(/^\/+/, '');
        const match = path.match(/(?:^|\/)json\/([a-z0-9_-]+)\/([a-z0-9_-]+)\.json$/i);
        if (!match || !SCENARIO_TYPES.has(match[1].toLowerCase())) return null;
        const eventType = match[1].toLowerCase();
        const eventId = match[2];
        const entry = {
            key: `${eventType}/${eventId}`,
            eventType,
            eventId,
            path: `json/${eventType}/${eventId}.json`,
        };
        if (eventType === 'produce_events' && /^[23]\d{8}$/.test(eventId)) {
            const characterId = eventId.slice(1, 4);
            const names = CHARACTER_NAMES[characterId] || [];
            Object.assign(entry, {
                characterId,
                characterName: names[0] || '',
                characterNameJp: names[1] || '',
                cardType: eventId[0] === '2' ? 'Produce' : 'Support',
                cardSequence: eventId.slice(4, 7),
                storySequence: eventId.slice(7, 9),
            });
        }
        return entry;
    }

    function entriesFromUrls(urls) {
        const found = new Map();
        for (const url of Array.isArray(urls) ? urls : []) {
            const entry = parseScenarioPath(url);
            if (entry && !found.has(entry.key)) found.set(entry.key, entry);
        }
        return Array.from(found.values()).sort((a, b) => a.key.localeCompare(b.key));
    }

    function normalizeAssetPath(value) {
        const clean = String(value || '').replace(/\\/g, '/').replace(/[?#].*$/, '').replace(/^\/+/, '');
        const marker = clean.match(/(?:^|\/)((?:images|movies)\/content\/.*)$/i);
        return marker ? marker[1] : clean;
    }

    function cardResourcePaths(cardType, cardId) {
        const safeId = String(cardId || '').trim();
        if (!safeId) return { staticPath: '', dynamicPath: '' };
        if (cardType === 'Produce') {
            return {
                staticPath: `images/content/idols/card/${safeId}.jpg`,
                dynamicPath: `movies/idols/card/${safeId}.mp4`,
            };
        }
        if (cardType === 'Support') {
            return {
                staticPath: `images/content/support_idols/card/${safeId}.jpg`,
                dynamicPath: '',
            };
        }
        return { staticPath: '', dynamicPath: '' };
    }

    function extractCardResources(urls) {
        const found = new Map();
        const ensure = (cardType, cardId) => {
            const key = `${cardType}/${cardId}`;
            if (!found.has(key)) {
                found.set(key, {
                    key, cardType, cardId,
                    staticCardStatus: 'missing',
                    dynamicCardStatus: cardType === 'Produce' ? 'missing' : 'not-applicable',
                    implementationSource: 'official-game-asset-map',
                });
            }
            return found.get(key);
        };
        for (const value of Array.isArray(urls) ? urls : []) {
            const path = normalizeAssetPath(value);
            let match = path.match(/^images\/content\/idols\/card\/([A-Za-z0-9_-]+)\.jpg$/i);
            if (match) {
                const row = ensure('Produce', match[1]);
                row.staticCardStatus = 'available';
                row.staticCardPath = path;
                continue;
            }
            match = path.match(/^images\/content\/support_idols\/card\/([A-Za-z0-9_-]+)\.jpg$/i);
            if (match) {
                const row = ensure('Support', match[1]);
                row.staticCardStatus = 'available';
                row.staticCardPath = path;
                continue;
            }
            match = path.match(/^movies\/idols\/card\/([A-Za-z0-9_-]+)\.mp4$/i);
            if (match) {
                const row = ensure('Produce', match[1]);
                row.dynamicCardStatus = 'available';
                row.dynamicCardPath = path;
            }
        }
        return Array.from(found.values()).sort((a, b) => a.key.localeCompare(b.key));
    }

    function applyImplementationStatus(entries, urls) {
        const assetPaths = new Set((Array.isArray(urls) ? urls : []).map(normalizeAssetPath));
        return entries.map(value => {
            const row = Object.assign({}, value, metadata.get(value.key) || {});
            row.scenarioStatus = 'available';
            const isCard = row.eventType === 'produce_events' && /^[23]\d{8}$/.test(String(row.eventId || ''));
            if (!isCard) {
                row.metadataStatus = 'not-applicable';
                row.staticCardStatus = 'not-applicable';
                row.dynamicCardStatus = 'not-applicable';
                return row;
            }
            row.metadataStatus = row.cardName && row.storyTitle
                ? 'available'
                : row.cardId ? 'partial' : 'pending';
            const paths = cardResourcePaths(row.cardType, row.cardId);
            row.staticCardPath = paths.staticPath;
            row.dynamicCardPath = paths.dynamicPath;
            row.staticCardStatus = paths.staticPath
                ? (assetPaths.has(paths.staticPath) ? 'available' : 'missing')
                : 'pending';
            row.dynamicCardStatus = row.cardType === 'Support'
                ? 'not-applicable'
                : paths.dynamicPath
                    ? (assetPaths.has(paths.dynamicPath) ? 'available' : 'missing')
                    : 'pending';
            row.implementationSource = 'official-game-asset-map';
            row.pageImplementationStatus = row.staticCardStatus === 'available'
                ? 'available'
                : row.staticCardStatus === 'missing' ? 'missing' : 'pending';
            return row;
        });
    }

    function stopModuleCallHook() {
        if (typeof restoreModuleCallHook !== 'function') return;
        const restore = restoreModuleCallHook;
        restoreModuleCallHook = null;
        restore();
    }

    function scheduleDiscoveryCheck() {
        clearTimeout(discoveryTimer);
        discoveryTimer = setTimeout(() => {
            discoveryTimer = 0;
            checkForUpdates();
        }, 0);
    }

    function managerFromExport(exported) {
        const queue = [exported];
        const seen = new Set();
        while (queue.length && seen.size < 24) {
            const candidate = queue.shift();
            if (!candidate || (typeof candidate !== 'object' && typeof candidate !== 'function') || seen.has(candidate)) continue;
            seen.add(candidate);
            if (typeof candidate.fetchHashMap === 'function' && typeof candidate.getUrls === 'function') {
                const unavailableUntil = Number(unavailableAssetMaps.get(candidate) || 0);
                if (unavailableUntil <= Date.now()) return candidate;
            }
            for (const key of ['A', 'default']) {
                try {
                    if (candidate[key]) queue.push(candidate[key]);
                } catch (_) {}
            }
        }
        return null;
    }

    function rememberAssetMap(exported, moduleId, discovery) {
        const manager = managerFromExport(exported);
        if (!manager) return null;
        assetMap = manager;
        // The loader probe temporarily wraps Function.prototype.call.  The
        // resource manager is all the periodic scanner needs, so restore the
        // page's native function immediately instead of keeping the wrapper
        // alive while optional metadata modules load.
        stopModuleCallHook();
        reportStatus('asset-map-found', '已找到页游资源清单模块，准备读取资源。', {
            moduleId: String(moduleId == null ? '' : moduleId),
            discovery,
        });
        scheduleDiscoveryCheck();
        return assetMap;
    }

    function factorySource(factory) {
        try { return typeof factory === 'function' ? String(factory) : ''; } catch (_) { return ''; }
    }

    function exportedFunction(value) {
        const queue = [value];
        const seen = new Set();
        while (queue.length && seen.size < 12) {
            const candidate = queue.shift();
            if (!candidate || seen.has(candidate)) continue;
            seen.add(candidate);
            if (typeof candidate === 'function') return candidate;
            if (typeof candidate !== 'object') continue;
            for (const key of ['A', 'default']) {
                try { if (candidate[key]) queue.push(candidate[key]); } catch (_) {}
            }
        }
        return null;
    }

    function findAssetUrlTransformer() {
        if (assetUrlTransformerSearched) return assetUrlTransformer;
        assetUrlTransformerSearched = true;
        for (let loaderIndex = webpackRequires.length - 1; loaderIndex >= 0; loaderIndex--) {
            const loader = webpackRequires[loaderIndex];
            let ids = [];
            try { ids = loader && loader.m ? Reflect.ownKeys(loader.m) : []; } catch (_) {}
            for (const id of ids) {
                const source = factorySource(loader.m[id]);
                if (!source.includes('invalid path') || !source.includes('encryptPath')
                    || !source.includes('ENABLE_CRYPTO')) continue;
                try {
                    const resolver = exportedFunction(loader(id));
                    if (resolver) {
                        assetUrlTransformer = resolver;
                        return assetUrlTransformer;
                    }
                } catch (_) {}
            }
        }
        return null;
    }

    function officialAssetUrl(manager, relativePath) {
        const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const root = String(targetWindow.primEnv && targetWindow.primEnv.ASSET_ROOT || '').replace(/\/+$/, '');
        if (!root) throw new Error('页游资源根地址尚未就绪');
        const path = normalizeAssetPath(relativePath);
        const plainUrl = `${root}/${path}`;
        const resolver = findAssetUrlTransformer();
        let resolvedUrl = plainUrl;
        if (resolver) resolvedUrl = String(resolver(plainUrl));
        else if (targetWindow.primEnv && targetWindow.primEnv.ENABLE_CRYPTO) {
            throw new Error('页游加密资源地址解析器尚未就绪');
        }
        if (resolvedUrl.startsWith('//')) resolvedUrl = `${location.protocol}${resolvedUrl}`;
        const query = typeof manager.getQueryString === 'function'
            ? manager.getQueryString(plainUrl) || manager.getQueryString(path) || ''
            : '';
        if (query && !resolvedUrl.includes('?')) resolvedUrl += query;
        return { url: resolvedUrl, signature: `${path}${query}` };
    }

    function resourceJobs(row) {
        const jobs = [];
        if (row.staticCardStatus === 'available' && row.staticCardPath) {
            jobs.push({
                kind: row.cardType === 'Produce' ? 'produce-still' : 'support-still',
                path: row.staticCardPath,
                syncField: 'staticCardSyncStatus',
                savedField: 'staticCardSaved',
            });
        }
        if (row.cardType === 'Produce' && row.dynamicCardStatus === 'available' && row.dynamicCardPath) {
            jobs.push({
                kind: 'produce-movie', path: row.dynamicCardPath,
                syncField: 'dynamicCardSyncStatus', savedField: 'dynamicCardSaved',
            });
        }
        return jobs;
    }

    async function fetchOfficialResource(manager, row, job) {
        const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const resolved = officialAssetUrl(manager, job.path);
        const response = await targetWindow.fetch(resolved.url, {
            method: 'GET', credentials: 'include', cache: 'no-store',
        });
        if (!response.ok) throw new Error(`official HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength < 512 || buffer.byteLength > 128 * 1024 * 1024) {
            throw new Error('official resource size is invalid');
        }
        const saved = await uploadOfficialResource(
            job.kind,
            row.cardId,
            buffer,
            response.headers.get('Content-Type') || 'application/octet-stream',
        );
        return { ...saved, signature: resolved.signature };
    }

    async function syncRequestedOfficialCardResources(resources, manager, requests) {
        const pending = Array.isArray(requests) ? requests : [];
        for (const request of pending) {
            const row = resources.find(item => String(item.cardId || '') === String(request.cardId || ''));
            const job = row && resourceJobs(row).find(item => item.kind === request.kind);
            if (!row || !job) continue;
            try {
                const saved = await fetchOfficialResource(manager, row, job);
                row[job.syncField] = 'synced';
                row[job.savedField] = String(saved.saved || `assets/${job.path}`);
                row.implementationSource = 'official-game-direct-on-demand';
            } catch (error) {
                console.warn(`[ShinyScenarioMonitor] on-demand ${request.kind}/${request.cardId} sync failed`, error);
            }
        }
        return resources;
    }

    async function processPendingOfficialResourceRequests(managerHint, resourceHint) {
        let payload;
        try {
            payload = await requestJson(LOCAL_OFFICIAL_REQUESTS_URL, { timeout: 5000 });
        } catch (_) {
            return resourceHint || [];
        }
        const requests = payload && Array.isArray(payload.items) ? payload.items : [];
        if (!requests.length) return resourceHint || [];
        const manager = managerHint || findAssetMap();
        if (!manager) return resourceHint || [];
        try {
            await manager.fetchHashMap();
            const resources = resourceHint || extractCardResources(manager.getUrls());
            return await syncRequestedOfficialCardResources(resources, manager, requests);
        } catch (error) {
            console.warn('[ShinyScenarioMonitor] on-demand resource queue failed', error);
            return resourceHint || [];
        }
    }

    function loaderDiagnostics(loader, index) {
        let ids = [];
        try { ids = loader && loader.m ? Reflect.ownKeys(loader.m) : []; } catch (_) {}
        let requireKeys = [];
        try { requireKeys = loader ? Reflect.ownKeys(loader).map(String).slice(0, 30) : []; } catch (_) {}
        return {
            index,
            hasRegistry: Boolean(loader && loader.m),
            moduleCount: ids.length,
            hintPresent: ids.some(id => String(id) === String(ASSET_MODULE_HINT)),
            requireKeys,
        };
    }

    function moduleRegistryDiagnostics() {
        return {
            loaderCount: webpackRequires.length,
            loaders: webpackRequires.map((loader, index) => loaderDiagnostics(loader, index + 1)),
        };
    }

    function registerWebpackRequire(candidate) {
        if (webpackRequires.includes(candidate)) return false;
        webpackRequires.push(candidate);
        webpackRequire = candidate;
        const details = loaderDiagnostics(candidate, webpackRequires.length);
        details.loaderCount = webpackRequires.length;
        details.force = true;
        reportStatus('webpack-captured', `已捕获第 ${webpackRequires.length} 个页面模块加载器，正在查找资源清单。`, details);
        scheduleDiscoveryCheck();
        return true;
    }

    function findAssetMap() {
        if (assetMap && typeof assetMap.getUrls === 'function') return assetMap;
        if (!webpackRequires.length) return null;
        for (let loaderIndex = webpackRequires.length - 1; loaderIndex >= 0; loaderIndex--) {
            const loader = webpackRequires[loaderIndex];
            const registry = loader.m;
            const ids = [];
            try {
                if (registry) {
                    const allIds = Reflect.ownKeys(registry);
                    const hinted = allIds.find(id => String(id) === String(ASSET_MODULE_HINT));
                    if (hinted != null) ids.push(hinted);
                    for (const id of allIds) {
                        if (ids.some(existing => String(existing) === String(id))) continue;
                        const source = factorySource(registry[id]);
                        if (source.includes('asset-map.json') && source.includes('fetchHashMap')) ids.push(id);
                    }
                }
            } catch (_) {}
            for (const id of ids) {
                try {
                    const manager = rememberAssetMap(loader(id), id, `module-registry-${loaderIndex + 1}`);
                    if (manager) return manager;
                } catch (_) {}
            }
        }
        return null;
    }

    function captureWebpackRequire() {
        const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const previousCall = targetWindow.Function.prototype.call;
        const requirePattern = /^function\s\w\((\w)\)\{var\s(\w)=(\w)\[\1\];if\(void\s0!==\2\)return\s\2\.exports;var\s(\w)=\3\[\1\]=\{id:\1,loaded:!1,exports:\{\}\};return\s\w\[\1\]\.call\(\4\.exports,\4,\4\.exports,\w\),\4\.loaded=!0,\4\.exports\}$/;
        const callProxy = new Proxy(previousCall, {
            apply(target, self, args) {
                let moduleRecord = null;
                let moduleId = null;
                let source = '';
                let possibleAssetFactory = false;
                let possibleAssetTransformer = false;
                try {
                    const candidate = args && args[3];
                    if (typeof candidate === 'function' && !webpackRequires.includes(candidate)) {
                        let candidateSource = '';
                        try { candidateSource = candidate.toString(); } catch (_) {}
                        if (requirePattern.test(candidateSource) || candidate.m || candidate.c) {
                            registerWebpackRequire(candidate);
                        }
                    }
                    moduleRecord = args && args[1];
                    moduleId = moduleRecord && moduleRecord.id;
                    possibleAssetFactory = String(moduleId) === String(ASSET_MODULE_HINT);
                    if (moduleRecord && typeof self === 'function') {
                        source = factorySource(self);
                        if (!possibleAssetFactory) {
                            possibleAssetFactory = source.includes('asset-map.json')
                                && (source.includes('fetchHashMap') || source.includes('getUrls'));
                        }
                        possibleAssetTransformer = source.includes('invalid path')
                            && source.includes('encryptPath') && source.includes('ENABLE_CRYPTO');
                    }
                } catch (_) {}

                const result = targetWindow.Reflect.apply(target, self, args);
                try {
                    if (possibleAssetTransformer && moduleRecord) {
                        const resolver = exportedFunction(moduleRecord.exports);
                        if (resolver) {
                            assetUrlTransformer = resolver;
                            assetUrlTransformerSearched = true;
                        }
                    }
                    if (possibleAssetFactory && moduleRecord) {
                        rememberAssetMap(moduleRecord.exports, moduleId, source ? 'factory-signature' : 'module-hint');
                    }
                } catch (_) {}
                return result;
            },
        });
        targetWindow.Function.prototype.call = callProxy;
        restoreModuleCallHook = () => {
            if (targetWindow.Function.prototype.call === callProxy) targetWindow.Function.prototype.call = previousCall;
        };
        setTimeout(() => {
            if (!webpackRequires.length) {
                stopModuleCallHook();
                reportStatus('webpack-missed', '没有捕获到页游模块加载器；请确认脚本在页游刷新前已经启用。');
            } else {
                stopModuleCallHook();
            }
        }, 60000);
    }

    async function datasiteCardRows(card, knownScenarioKeys) {
        const rawType = String(card && card.cardType || '');
        const produce = rawType.startsWith('P_');
        if (!produce && !rawType.startsWith('S_')) return [];
        const cardId = String(card.enzaId || '');
        const cardUuid = String(card.cardUuid || '');
        if (!cardId || !cardUuid) return [];
        const endpoint = produce ? 'pCardInfo' : 'sCardInfo';
        const eventField = produce ? 'cardIdolEvents' : 'cardSupportEvents';
        const detail = await requestJson(`${DATASITE_API_ROOT}/info/${endpoint}?cardId=${encodeURIComponent(cardUuid)}`);
        const events = Array.isArray(detail[eventField]) ? detail[eventField] : [];
        const relevant = events.filter(item => item && item.eventId
            && knownScenarioKeys.has(`produce_events/${String(item.eventId)}`));
        if (!relevant.length) return [];

        const cardType = produce ? 'Produce' : 'Support';
        const staticKind = produce ? 'produce-still' : 'support-still';
        const resource = {
            staticCardMirrorStatus: 'missing', staticCardSyncStatus: 'failed',
            dynamicCardMirrorStatus: produce ? 'missing' : 'not-applicable',
            dynamicCardSyncStatus: produce ? 'failed' : 'not-applicable',
        };
        try {
            const saved = await syncCommunityResource(staticKind, cardId);
            resource.staticCardMirrorStatus = 'available';
            resource.staticCardSyncStatus = 'synced';
            resource.staticCardSaved = String(saved.saved || '');
        } catch (_) {}
        // Dynamic card movies are large and must never be pulled by the
        // periodic metadata listener. The workshop exposes them separately
        // when the user opens/exports a story and may bind a local MP4 then.

        const characterId = String(card.idolId || '').padStart(3, '0');
        const names = CHARACTER_NAMES[characterId] || [];
        const cardName = String(detail.cardName || card.cardName || '');
        return relevant.map(item => {
            const storyTitle = String(item.eventTitle || '');
            const row = {
                eventType: 'produce_events', eventId: String(item.eventId),
                characterId, characterName: names[0] || '', characterNameJp: names[1] || '',
                cardType, cardId, cardName, cardRarity: rawType,
                metadataStatus: cardName && storyTitle ? 'available' : 'partial',
                cardNameStatus: cardName ? 'available' : 'pending',
                storyTitleStatus: storyTitle ? 'available' : 'pending',
                metadataSource: 'shinycolors.moe', implementationSource: 'shinycolors.moe',
                ...resource,
            };
            if (storyTitle) row.storyTitle = storyTitle;
            return row;
        });
    }

    async function checkDatasiteUpdates(knownScenarioKeys, force = false) {
        const lastCheck = Number(GM_getValue(DATASITE_CHECK_KEY, 0) || 0);
        if (!force && Date.now() - lastCheck < CHECK_INTERVAL) return;
        GM_setValue(DATASITE_CHECK_KEY, Date.now());
        try {
            const recent = await requestJson(`${DATASITE_API_ROOT}/info/recentUpdate`);
            const results = await Promise.allSettled(
                (Array.isArray(recent) ? recent : []).map(card => datasiteCardRows(card, knownScenarioKeys)),
            );
            const rows = [];
            for (const result of results) {
                if (result.status !== 'fulfilled') continue;
                rows.push(...result.value);
            }
            if (rememberMetadata(rows)) scheduleSync();
        } catch (error) {
            console.warn('[ShinyScenarioMonitor] shinycolors.moe metadata check failed', error);
        }
    }

    function pendingImplementationCount(state) {
        return (state && Array.isArray(state.items) ? state.items : []).filter(row => {
            if (!row || row.eventType !== 'produce_events' || !/^[23]\d{8}$/.test(String(row.eventId || ''))
                || !row.updateDetectedAt) return false;
            if (!row.cardName || !row.storyTitle) return true;
            if (row.staticCardStatus !== 'available') return true;
            return row.cardType === 'Produce'
                && row.dynamicCardStatus !== 'available'
                && row.dynamicCardStatus !== 'not-applicable';
        }).length;
    }

    function localDateKey(date = new Date()) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function scheduleNightlyImplementationCheck() {
        clearTimeout(nightlyTimer);
        nightlyTimer = 0;
        if (Number(GM_getValue(PENDING_CARD_COUNT_KEY, 0) || 0) < 1) return;
        const now = new Date();
        const todayKey = localDateKey(now);
        const lastCheck = String(GM_getValue(NIGHTLY_CHECK_KEY, '') || '');
        let target = new Date(now);
        target.setHours(23, 2, 0, 0);
        if (now >= target) {
            if (lastCheck !== todayKey) target = new Date(now.getTime() + 5000);
            else target.setDate(target.getDate() + 1);
        }
        nightlyTimer = setTimeout(async () => {
            GM_setValue(NIGHTLY_CHECK_KEY, localDateKey());
            await checkForUpdates(true);
            scheduleNightlyImplementationCheck();
        }, Math.max(1000, target.getTime() - Date.now()));
    }

    function updatePendingSchedule(response) {
        try {
            const state = JSON.parse(response.responseText || '{}');
            GM_setValue(PENDING_CARD_COUNT_KEY, pendingImplementationCount(state));
            scheduleNightlyImplementationCheck();
            if (Number(state.implementationChangeCount || 0) > 0) {
                const changed = new Set(Array.isArray(state.implementationChangeKeys)
                    ? state.implementationChangeKeys : []);
                const rows = (Array.isArray(state.items) ? state.items : [])
                    .filter(row => changed.has(row.key)).slice(0, 4);
                const text = rows.map(row => {
                    const card = row.cardName || `${row.characterName || '角色待确认'}-${row.cardType || '卡片'}`;
                    return `${card}：${row.implementationChanges || '卡片资料已更新'}`;
                }).join('\n');
                GM_notification({
                    title: `闪耀色彩有 ${state.implementationChangeCount} 项卡片资料实装`,
                    text: text || '卡名、单话名或卡图资源已经补齐。',
                    timeout: 0,
                    onclick: () => window.open(LOCAL_WORKSHOP_URL, '_blank'),
                });
            }
        } catch (_) {}
    }

    function postObservation(payload) {
        const body = Object.assign({
            scriptVersion: SCRIPT_VERSION,
            pageUrl: location.href,
        }, payload);
        sendLocal(LOCAL_OBSERVATION_URL, body, {
            onload: response => {
                if (response.status >= 200 && response.status < 300) {
                    updatePendingSchedule(response);
                    reportStatus(payload.metadataOnly ? 'metadata-sent' : 'baseline-sent', payload.metadataOnly
                        ? '官方全卡名称已经送达本地工坊。'
                        : `资源清单已送达本地工坊，共 ${payload.entries.length} 段剧情。`, {
                        count: payload.entries.length,
                        assetVersion: payload.assetVersion,
                        force: true,
                    });
                } else {
                    reportStatus('local-http-error', `本地工坊拒绝了资源清单：HTTP ${response.status}。`, { force: true });
                }
            },
            onerror: () => console.warn('[ShinyScenarioMonitor] 无法连接本地工坊。'),
        });
    }

    function notifyNewEntries(rows) {
        if (!rows.length) return;
        const preview = rows.slice(0, 3).map(row => {
            const name = row.characterName || '角色待确认';
            const card = row.cardName || `${row.cardType || '卡片'} #${row.cardSequence || '?'}`;
            const title = row.storyTitle || `剧情 #${row.storySequence || '?'}（待主数据）`;
            return `${name} - ${card} - ${row.eventId} - ${title}`;
        }).join('\n');
        GM_notification({
            title: `闪耀色彩发现 ${rows.length} 段新剧情`,
            text: preview + (rows.length > 3 ? `\n……另有 ${rows.length - 3} 段` : ''),
            timeout: 0,
            onclick: () => window.open(LOCAL_WORKSHOP_URL, '_blank'),
        });
    }

    async function checkForUpdates(forceDatasite = false) {
        const manager = findAssetMap();
        if (!manager) {
            retryCount++;
            if (webpackRequire && retryCount === 1) {
                reportStatus('asset-map-missing', '已捕获页游模块，但暂时没有找到资源清单模块。', moduleRegistryDiagnostics());
            }
            if (retryCount <= MAX_RETRIES) setTimeout(checkForUpdates, RETRY_INTERVAL);
            return;
        }
        retryCount = 0;
        try {
            await manager.fetchHashMap();
            const assetUrls = manager.getUrls();
            const entries = applyImplementationStatus(entriesFromUrls(assetUrls), assetUrls);
            if (!entries.length) {
                unavailableAssetMaps.set(manager, Date.now() + 30000);
                if (assetMap === manager) assetMap = null;
                retryCount++;
                reportStatus('empty-asset-map', '当前候选资源模块为空，继续查找实际剧情资源清单。', {
                    retryCount, force: true,
                });
                if (retryCount <= MAX_RETRIES) setTimeout(checkForUpdates, RETRY_INTERVAL);
                return;
            }
            const currentKeys = entries.map(entry => entry.key);
            const oldKeys = GM_getValue(KNOWN_KEY, null);
            const oldSet = new Set(Array.isArray(oldKeys) ? oldKeys : []);
            const newEntries = Array.isArray(oldKeys) ? entries.filter(entry => !oldSet.has(entry.key)) : [];
            GM_setValue(KNOWN_KEY, currentKeys);
            const resources = await processPendingOfficialResourceRequests(
                manager,
                extractCardResources(assetUrls),
            );
            postObservation({
                observedAt: new Date().toISOString(),
                assetVersion: typeof manager.getLatestVersion === 'function' ? manager.getLatestVersion() : '',
                entries,
                metadata: Array.from(metadata.values()),
                resources,
            });
            notifyNewEntries(newEntries);
            checkDatasiteUpdates(new Set(currentKeys), forceDatasite);
        } catch (error) {
            reportStatus('scan-error', `读取页游资源清单失败：${error && error.message || error}`, { force: true });
        }
    }

    function scheduleSync() {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(checkForUpdates, 1500);
    }

    function forceImplementationCheck() {
        GM_setValue(DATASITE_CHECK_KEY, 0);
        checkForUpdates(true);
    }

    reportStatus('script-started', '监听脚本已经在页游中启动。', { force: true });
    captureWebpackRequire();
    scheduleNightlyImplementationCheck();
    setInterval(checkForUpdates, CHECK_INTERVAL);
    setInterval(() => processPendingOfficialResourceRequests(), 2500);
    GM_registerMenuCommand('立即检查剧情与页游实装状态', forceImplementationCheck);
    GM_registerMenuCommand('打开剧情整理工坊', () => window.open(LOCAL_WORKSHOP_URL, '_blank'));
})();
