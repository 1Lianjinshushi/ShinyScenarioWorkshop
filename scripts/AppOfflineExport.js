'use strict';
(function () {
    const el = id => document.getElementById('offline-export-' + id);
    const terminal = new Set(['complete', 'failed', 'cancelled', 'interrupted']);
    const stages = { pending: '待导出', queued: '等待导出', paused: '等待手动继续', preflight: '准备资源', preroll: '准备画面', render: '生成画面',
        audio: '处理音频', mux: '封装视频', verify: '检查成片', cleanup: '整理成片', cancelling: '正在停止' };
    const settingsKey = 'ssv.offlineExport.memorySettings.v1';
    const speedKey = 'ssv.offlineExport.speedMode.v1';
    let speedMode = 'low-load', speedModes = ['low-load'];
    try { if (localStorage.getItem(speedKey) === 'high-speed') speedMode = 'high-speed'; } catch (_) {}
    el('speed-mode').value = speedMode;
    const concurrencyKey = 'ssv.offlineExport.concurrency.v1';
    let concurrency = 2, concurrencyModes = [1];
    try { if (localStorage.getItem(concurrencyKey) === '1') concurrency = 1; } catch (_) {}
    el('concurrency').value = String(concurrency);
    const verificationKey = 'ssv.offlineExport.verificationMode.v2';
    let verificationMode = 'auto', verificationModes = [];
    try {
        const saved = localStorage.getItem(verificationKey);
        if (['auto', 'quick', 'full'].includes(saved)) verificationMode = saved;
        else if (localStorage.getItem('ssv.offlineExport.verificationMode.v1') === 'full') verificationMode = 'full';
    } catch (_) {}
    el('verification-mode').value = verificationMode;
    const fallbackBounds = { memoryMiB: { min: 512, max: 8192 }, reserveMiB: { min: 1024, max: 8192 } };
    const fields = { memoryMiB: 'memory-limit', reserveMiB: 'memory-reserve' };
    let available = false, manualStart = false, busy = false, polling = false, serviceError = false, completed = 0;
    let jobs = [], revision = 0;
    let policyDefaults = null, policyBounds = fallbackBounds;
    let batchVersion = 0, batchQueue = Promise.resolve();
    const settingsOverrides = loadSettingsOverrides();
    const rows = new Map(), selected = new Set(), seen = new Map();
    const batchRows = new Map();
    const pending = () => jobs.filter(j => j.state === 'pending');
    function message(text, error = false) { el('message').textContent = text; el('message').dataset.tone = error ? 'error' : 'normal'; }
    function loadSettingsOverrides() {
        try {
            const stored = JSON.parse(localStorage.getItem(settingsKey) || '{}');
            return {
                memoryMiB: Number.isInteger(stored.memoryMiB) && stored.memoryMiB >= 512 && stored.memoryMiB <= 8192 ? stored.memoryMiB : null,
                reserveMiB: Number.isInteger(stored.reserveMiB) && stored.reserveMiB >= 1024 ? stored.reserveMiB : null,
            };
        } catch (_) { return { memoryMiB: null, reserveMiB: null }; }
    }
    function saveSettingsOverrides() {
        try {
            if (Object.values(settingsOverrides).every(value => value === null)) localStorage.removeItem(settingsKey);
            else localStorage.setItem(settingsKey, JSON.stringify(settingsOverrides));
        } catch (_) { /* Browser storage may be unavailable; the values still work for this page. */ }
    }
    function commitSettings(values) {
        for (const key of Object.keys(fields)) settingsOverrides[key] = values[key] === policyDefaults[key] ? null : values[key];
        saveSettingsOverrides();
    }
    function settingValues() {
        if (!policyDefaults) return null;
        const values = {};
        for (const [key, id] of Object.entries(fields)) {
            const input = el(id), value = Number(input.value), bounds = policyBounds[key];
            if (!input.value.trim() || !Number.isInteger(value) || value < bounds.min || value > bounds.max) return null;
            values[key] = value;
        }
        return values;
    }
    function updateSettingsLabels() {
        if (!policyDefaults) return;
        el('memory-default').textContent = '默认：' + policyDefaults.memoryMiB + ' MiB';
        el('reserve-default').textContent = '默认：' + policyDefaults.reserveMiB + ' MiB';
    }
    function updatePolicy(data) {
        const defaults = data.policyDefaults;
        if (!defaults || !Number.isInteger(defaults.memoryMiB) || !Number.isInteger(defaults.reserveMiB)) {
            policyDefaults = null;
            return;
        }
        const bounds = data.policyBounds || fallbackBounds;
        const nextBounds = {};
        for (const key of Object.keys(fields)) {
            const candidate = bounds[key] || fallbackBounds[key];
            nextBounds[key] = Number.isInteger(candidate.min) && Number.isInteger(candidate.max) && candidate.min <= candidate.max
                ? { min: candidate.min, max: candidate.max } : fallbackBounds[key];
        }
        const changed = !policyDefaults || Object.keys(fields).some(key => policyDefaults[key] !== defaults[key]);
        policyDefaults = defaults; policyBounds = nextBounds;
        for (const [key, id] of Object.entries(fields)) {
            const input = el(id), limits = nextBounds[key];
            input.min = limits.min; input.max = limits.max;
            if (settingsOverrides[key] !== null && (settingsOverrides[key] < limits.min || settingsOverrides[key] > limits.max)) settingsOverrides[key] = null;
            if (changed) input.value = settingsOverrides[key] ?? defaults[key];
        }
        if (changed) saveSettingsOverrides();
        updateSettingsLabels();
    }
    function refreshAvailability() {
        const loaded = !!state.tracks;
        el('ja').disabled = !available || busy || !loaded;
        el('zh').disabled = !available || busy || !loaded || !state.csvText
            || state.csvEventId !== state.eventId || state.csvEventType !== state.eventType;
        el('files').disabled = el('import').disabled = !available || busy;
        el('open-root').disabled = !manualStart || busy;
        const waiting = pending(), count = waiting.filter(j => selected.has(j.id)).length;
        el('all').disabled = !available || busy || !waiting.length;
        el('all').checked = waiting.length > 0 && count === waiting.length;
        el('all').indeterminate = count > 0 && count < waiting.length;
        el('start').disabled = !available || busy || !count || !settingValues();
        el('speed-mode').disabled = !available || busy;
        el('concurrency').disabled = !available || busy;
        el('verification-mode').disabled = !available || busy;
        if (!verificationModes.includes(verificationMode)) el('start').disabled = true;
        if (!concurrencyModes.includes(concurrency)) el('start').disabled = true;
        if (!speedModes.includes(speedMode)) el('start').disabled = true;
        el('start').textContent = count ? '开始导出（' + count + '）' : '开始导出';
        for (const id of Object.values(fields)) el(id).disabled = !policyDefaults || busy;
        el('memory-reset').disabled = !policyDefaults || busy || Object.entries(fields).every(([key, id]) => Number(el(id).value) === policyDefaults[key]);
        for (const [id, entry] of rows) {
            const j = jobs.find(j => j.id === id);
            entry.check.disabled = busy || !available || j.state !== 'pending';
            entry.cancel.disabled = busy || j.state === 'cancelling';
            entry.resume.disabled = busy || !available || j.state !== 'paused';
        }
        window.SSVWorkspace?.syncMirrors();
    }
    window.SSVOfflineExport = { refreshAvailability };
    function showBatch(items) {
        const version = ++batchVersion;
        batchRows.clear();
        const container = el('related-list');
        container.replaceChildren();
        container.hidden = false;
        el('related-summary').textContent = '正在为 ' + items.length + ' 份 CSV 拉取日文剧情并合成汉化快照…';
        for (const imported of items) {
            const row = document.createElement('div');
            row.className = 'offline-export-related-row';
            const name = document.createElement('strong');
            name.textContent = imported.eventId;
            const source = document.createElement('span');
            source.textContent = imported.fileName + ' · 汉化版';
            const status = document.createElement('p');
            status.textContent = '正在拉取对应日文 JSON…';
            const resources = document.createElement('p');
            row.append(name, source, status, resources);
            container.append(row);
            batchRows.set(imported.eventType + '/' + imported.eventId, { status, resources });
        }
        return version;
    }
    async function checkBatchResources(tracks, eventType, eventId, version) {
        const label = batchRows.get(eventType + '/' + eventId)?.resources;
        if (!label) return;
        try {
            const paths = new Set([
                ...deriveStoryResourcePaths(tracks, eventType, eventId),
                ...deriveCommonResourcePaths(tracks),
            ]);
            paths.delete(`json/${eventType}/${eventId}.json`);
            const status = await resourceCacheStatus([...paths]);
            if (version !== batchVersion) return;
            const count = status.missing.size;
            label.textContent = count
                ? '已知资源本地尚缺 ' + count + ' 项；直出前尝试补齐，补不齐则拦截'
                : '已知资源本地已缓存；直出时仍会完整预检';
            label.dataset.tone = count ? 'warn' : 'normal';
        } catch (_) {
            if (version !== batchVersion) return;
            label.textContent = '暂无法检查资源缓存；直出前仍会严格预检';
            label.dataset.tone = 'warn';
        }
    }
    async function importBatch(items) {
        if (!items.length) return;
        while (busy) await new Promise(resolve => setTimeout(resolve, 100));
        revision++;
        busy = true; refreshAvailability();
        const version = showBatch(items);
        const results = [], failures = [];
        try {
            const readiness = await request('jobs');
            render(readiness);
            if (!available) throw new Error('直出服务尚未就绪，请重启工坊后台服务后重新导入 CSV');
            // Bound parallel network activity; one unavailable scenario must not
            // prevent the other imported translations from being queued.
            for (let offset = 0; offset < items.length; offset += 4) {
                const group = items.slice(offset, offset + 4);
                const built = await Promise.all(group.map(async imported => {
                    const key = imported.eventType + '/' + imported.eventId;
                    const row = batchRows.get(key);
                    try {
                        const tracks = state.eventType === imported.eventType && state.eventId === imported.eventId
                            && Array.isArray(state.tracks) && state.tracks.length ? state.tracks
                            : await OfflineBatchCsvQueue.fetchTracks(imported.eventType, imported.eventId, fetch,
                                [REMOTE_ROOT, REMOTE_JSON_FALLBACK]);
                        const built = OfflineBatchCsvQueue.translatedItem(tracks, imported.text,
                            imported.eventType, imported.eventId, state.speakerMap, ScenarioCsvTranslation);
                        if (!built.report.applied) throw new Error('CSV 译文未能匹配任何剧情节点');
                        row.status.textContent = '汉化已合成：匹配 ' + built.report.applied + '/' + built.report.total + ' 条'
                            + (built.missingSpeakers.length ? ' · 发言人未补齐：' + built.missingSpeakers.join('、') : '');
                        row.status.dataset.tone = built.report.applied < built.report.total || built.missingSpeakers.length
                            ? 'warn' : 'normal';
                        void checkBatchResources(tracks, imported.eventType, imported.eventId, version);
                        return { imported, item: built.item, row };
                    } catch (error) {
                        row.status.textContent = '未加入：' + error.message;
                        row.status.dataset.tone = 'warn';
                        failures.push(imported.eventId + '：' + error.message);
                        return null;
                    }
                }));
                results.push(...built.filter(Boolean));
            }
            let queued = 0;
            for (let offset = 0; offset < results.length; offset += 20) {
                const group = results.slice(offset, offset + 20);
                try {
                    const data = await request('jobs', { items: group.map(result => result.item) });
                    for (const id of data.ids || []) selected.add(id);
                    render(data);
                    group.forEach(result => { result.row.status.textContent += ' · 已勾选待导出'; });
                    queued += group.length;
                } catch (error) {
                    group.forEach(result => {
                        result.row.status.textContent = '未加入：' + error.message;
                        result.row.status.dataset.tone = 'warn';
                        failures.push(result.imported.eventId + '：' + error.message);
                    });
                }
            }
            el('related-summary').textContent = '本批 CSV 已加入并勾选 ' + queued + '/' + items.length
                + ' 篇汉化剧情' + (failures.length ? '；' + failures.length + ' 篇未加入，请查看下方原因' : '；可直接选择开始导出。');
            message(queued ? '已自动勾选 ' + queued + ' 篇汉化剧情；不会自动开始直出。' : '本批 CSV 未能加入直出列表。', !queued || !!failures.length);
        } catch (error) {
            el('related-summary').textContent = '批量汉化直出未完成：' + error.message;
            message(error.message, true);
            for (const row of batchRows.values()) if (row.status.textContent.startsWith('正在')) row.status.textContent = '未加入：' + error.message;
        } finally { busy = false; refreshAvailability(); }
    }
    window.addEventListener('ssv-translation-batch-imported', event => {
        const items = Array.isArray(event.detail?.items) ? event.detail.items : [];
        if (!items.length) return;
        batchQueue = batchQueue.then(() => importBatch(items)).catch(error => message(error.message, true));
    });
    async function request(route, payload) {
        const response = await fetch('./api/offline-export/' + route, {
            method: payload === undefined ? 'GET' : 'POST',
            headers: { 'Content-Type': 'application/json', 'X-SSV-Offline': '1' },
            body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(route === 'resume' ? 45000 : 20000),
        });
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('请重启本地工坊服务以载入新的直出接口');
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error || 'HTTP ' + response.status);
        return data;
    }
    function makeRow(job) {
        const row = document.createElement('article'); row.className = 'offline-export-job'; row.dataset.jobId = job.id;
        const check = document.createElement('input'); check.type = 'checkbox'; check.className = 'offline-export-check';
        check.onchange = () => { if (check.checked) selected.add(job.id); else selected.delete(job.id); refreshAvailability(); };
        const content = document.createElement('div'); content.className = 'offline-export-job-content';
        const heading = document.createElement('strong'), group = document.createElement('span'), detail = document.createElement('p');
        group.className = 'offline-export-job-group';
        const status = document.createElement('span'); status.className = 'offline-export-job-status';
        const progress = document.createElement('progress'); progress.max = 1; progress.setAttribute('aria-label', '当前阶段进度');
        const actions = document.createElement('div'); actions.className = 'offline-export-job-actions';
        const resume = document.createElement('button'); resume.type = 'button'; resume.textContent = '继续任务';
        resume.onclick = () => action('resume', { id: job.id });
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.onclick = () => action('cancel', { id: job.id });
        actions.append(resume, cancel);
        content.append(heading, group, detail, progress); row.append(check, content, status, actions);
        const entry = { row, heading, group, status, detail, progress, check, resume, cancel }; rows.set(job.id, entry); return entry;
    }
    function render(data) {
        if (serviceError) { message(''); serviceError = false; }
        updatePolicy(data);
        speedModes = Array.isArray(data.speedModes) ? data.speedModes : ['low-load'];
        concurrencyModes = Array.isArray(data.concurrencyModes) ? data.concurrencyModes : [1];
        verificationModes = Array.isArray(data.verificationModes) ? data.verificationModes : [];
        manualStart = data.manualStart === true;
        available = data.available === true && manualStart && !!policyDefaults;
        if (!manualStart) { serviceError = true; message('直出服务仍是旧版本，请重启工坊及后台服务；为避免意外启动，暂不允许加入。', true); }
        else if (!policyDefaults) { serviceError = true; message('直出服务尚未提供内存设置，请重启工坊及后台服务。', true); }
        else if (!available) { serviceError = true; message('缺少：' + (data.missing || []).join('、') + '。普通播放与编辑不受影响。', true); }
        else if (!concurrencyModes.includes(concurrency)) { serviceError = true; message('后台服务尚未支持双线；请在全部任务结束后重启工坊，或先选择单线。', true); }
        else if (!verificationModes.includes(verificationMode)) { serviceError = true; message('后台服务尚未支持所选成片检查模式；请在全部任务结束后重启直出服务。', true); }
        const all = data.jobs || [];
        for (const job of all) {
            const previous = seen.get(job.id);
            if (previous && !terminal.has(previous) && terminal.has(job.state)) {
                if (job.state === 'complete') { completed++; message('已完成 ' + completed + ' 项，可在保存目录中查看成片。'
                    + (job.verification?.upgraded ? '本篇因过程中的内存暂停，已自动追加并通过完整检查。' : '') + (job.namingWarning || '')); }
                else if (job.state === 'failed' || job.state === 'interrupted') message((job.displayTitle || job.eventId) + '：' + (job.error || '导出未完成，请重新加入。'), true);
            }
            seen.set(job.id, job.state);
        }
        jobs = all.filter(j => !terminal.has(j.state));
        const active = jobs.filter(j => j.state !== 'pending').length;
        const paused = jobs.some(j => j.state === 'paused');
        el('badge').textContent = !available ? '服务未就绪' : paused ? '等待手动继续' : active ? '后台导出中' : '准备就绪';
        el('count').textContent = pending().length + ' 项待导出' + (active && !el('active-jobs') ? ' · '
            + jobs.filter(j => j.state === 'running').length + ' 项运行 · '
            + jobs.filter(j => j.state === 'queued').length + ' 项排队'
            + (paused ? ' · ' + jobs.filter(j => j.state === 'paused').length + ' 项暂停' : '') : '');
        window.SSVWorkspace?.setExportSummary(jobs, available);
        const container = el('jobs'), activeContainer = el('active-jobs') || container;
        const ids = new Set(jobs.map(j => j.id));
        for (const [id, entry] of rows) if (!ids.has(id)) { entry.row.remove(); rows.delete(id); selected.delete(id); }
        container.querySelector('.empty-state')?.remove();
        activeContainer.querySelector('.empty-state')?.remove();
        let pendingIndex = 0, activeIndex = 0;
        jobs.forEach(job => {
            const entry = rows.get(job.id) || makeRow(job), p = job.progress || {};
            entry.heading.textContent = job.displayTitle || job.eventId;
            entry.group.textContent = [job.displayGroup, job.eventId, job.language === 'zh-cn' ? '汉化版' : '日文版',
                job.state === 'pending' ? '' : job.speedMode === 'high-speed' ? '高速模式' : '低负载模式',
                job.state === 'pending' ? '' : job.concurrency === 2 ? '双线批次' : '单线批次',
                job.state === 'pending' ? '' : p.stability?.upgraded ? '自动检查 → 完整'
                    : job.verificationMode === 'auto' ? '自动检查（正常时快速）'
                    : job.verificationMode === 'quick' ? '仅快速检查' : '完整检查'].filter(Boolean).join(' · ');
            entry.check.setAttribute('aria-label', '选择 ' + entry.heading.textContent);
            entry.check.hidden = job.state !== 'pending';
            if (job.state !== 'pending') selected.delete(job.id);
            entry.check.checked = selected.has(job.id);
            entry.status.textContent = stages[job.stage] || stages[job.state] || job.stage;
            entry.row.dataset.state = job.state;
            const storyRatio = p.stage === 'render' && p.storyTotal > 0
                ? Math.min(0.99, Math.max(0, (p.storyCompleted || 0) / p.storyTotal)) : null;
            const audioRatio = p.stage === 'audio' && p.total > 0
                ? Math.min(1, Math.max(0, (p.completed || 0) / p.total)) : null;
            entry.detail.textContent = job.state === 'paused' ? (job.pause?.reason || '内存安全预算不足，请清理内存后点击继续任务。')
                : p.waiting ? (p.waitReason || '等待共享处理通道') + ' · 已等待 ' + Math.floor(p.waitSeconds || 0) + ' 秒'
                : p.stage === 'verify' ? (p.verifyPart || '正在检查成片')
                : p.stage === 'render' ? (storyRatio == null ? '' : '剧情节点 ' + Math.floor(storyRatio * 100) + '%（按内容估算） · ')
                    + '已生成 ' + (p.videoSeconds || 0).toFixed(1) + ' 秒 · ' + (p.encodedFrames || 0) + ' 帧'
                : p.stage === 'audio' ? (p.audioPart || '正在处理整段声音') + (audioRatio == null ? '' : ' ' + Math.floor(audioRatio * 100) + '%')
                : p.stage === 'preflight' ? '已检查 ' + (p.resources || 0) + ' 项资源' : '';
            if (p.pressure === 'system-memory-pressure') entry.detail.textContent += ' · 内存紧张，等待余量';
            else if (['busy', 'moderate', 'memory-caution'].includes(p.pressure)) entry.detail.textContent += ' · 当前负载偏高，已保护性降速';
            if (p.stability?.upgraded) entry.detail.textContent += ' · 已升级完整检查：' + (p.stability.reasons?.[0]?.message || '生成期间触发过内存暂停');
            entry.detail.hidden = !entry.detail.textContent;
            entry.progress.hidden = ['pending', 'queued', 'paused'].includes(job.state);
            if (p.waiting) entry.progress.removeAttribute('value');
            else if (storyRatio != null) entry.progress.value = storyRatio;
            else if (audioRatio != null) entry.progress.value = audioRatio;
            else entry.progress.removeAttribute('value');
            entry.progress.setAttribute('aria-label', p.stage === 'render' ? '剧情节点进度'
                : p.stage === 'audio' ? '音频处理进度' : '当前阶段正在进行');
            entry.cancel.textContent = job.state === 'pending' ? '移除' : '取消';
            entry.resume.hidden = job.state !== 'paused';
            const target = job.state === 'pending' ? container : activeContainer;
            const index = activeContainer === container ? pendingIndex++ : job.state === 'pending' ? pendingIndex++ : activeIndex++;
            if (target.children[index] !== entry.row) target.insertBefore(entry.row, target.children[index] || null);
        });
        if (!(activeContainer === container ? jobs.length : pending().length)) {
            const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = '没有待导出的剧情，可继续加入新任务。'; container.append(empty);
        }
        if (el('active-section')) el('active-section').hidden = !active;
        if (el('active-count')) el('active-count').textContent = jobs.filter(j => j.state === 'running').length + ' 运行 · '
            + jobs.filter(j => j.state === 'queued').length + ' 排队'
            + (paused ? ' · ' + jobs.filter(j => j.state === 'paused').length + ' 暂停' : '');
        refreshAvailability();
    }
    async function action(route, payload = {}) {
        if (busy) return false;
        revision++;
        busy = true; refreshAvailability();
        try {
            const data = await request(route, payload); if (data.jobs) render(data);
            if (data.opened) message(data.foreground === true
                ? '已在前台打开统一保存目录。'
                : '保存目录已打开；若窗口未置前，可从任务栏切换到资源管理器。', data.foreground === false);
            if (route === 'start') message('已开始 ' + payload.ids.length + ' 项，最多同时导出 ' + payload.concurrency + ' 篇；未勾选的剧情留在列表中。');
            if (route === 'resume') message(data.resumed ? '内存复检已通过，正在继续当前任务。'
                : '内存复检仍未通过，当前任务保持暂停：' + (data.reason || '请清理内存或调整预算后再试。'), !data.resumed);
            return true;
        } catch (error) { message(error.message, true); return false; }
        finally { busy = false; refreshAvailability(); }
    }
    function currentItem(language) {
        if (!state.tracks) throw new Error('请先载入剧情');
        let tracks = state.tracks;
        if (language === 'zh-cn') {
            if (state.csvEventId !== state.eventId || state.csvEventType !== state.eventType) throw new Error('CSV 与当前剧情不匹配');
            return OfflineBatchCsvQueue.translatedItem(tracks, state.csvText,
                state.eventType, state.eventId, state.speakerMap, ScenarioCsvTranslation).item;
        }
        return { eventId: state.eventId, eventType: state.eventType, language, mode: 'offline', content: JSON.stringify(tracks) };
    }
    async function submit(build, successMessage = '已加入待导出列表。勾选后点击“开始导出”；后续编辑不会改变已加入的快照。') {
        if (busy) return;
        revision++;
        busy = true; refreshAvailability();
        try {
            const items = await build(); render(await request('jobs', { items }));
            message(successMessage);
        } catch (error) { message(error.message, true); }
        finally { busy = false; refreshAvailability(); }
    }
    el('ja').onclick = () => submit(() => [currentItem('ja')]);
    el('zh').onclick = () => submit(() => [currentItem('zh-cn')]);
    el('import').onclick = () => el('files').click();
    el('all').onchange = () => { for (const job of pending()) { if (el('all').checked) selected.add(job.id); else selected.delete(job.id); } refreshAvailability();
        for (const [id, row] of rows) row.check.checked = selected.has(id); };
    for (const id of Object.values(fields)) {
        const input = el(id);
        input.oninput = refreshAvailability;
        input.onchange = () => {
            const values = settingValues();
            if (!values) { message('请输入有效的整数 MiB，且不要超出输入框允许的范围。', true); refreshAvailability(); return; }
            commitSettings(values);
            message('内存设置已保存，将在开始新导出任务时生效。');
            refreshAvailability();
        };
    }
    el('memory-reset').onclick = () => {
        if (!policyDefaults) return;
        for (const [key, id] of Object.entries(fields)) { settingsOverrides[key] = null; el(id).value = policyDefaults[key]; }
        saveSettingsOverrides(); message('已恢复默认内存设置，将在开始新导出任务时生效。'); refreshAvailability();
    };
    el('speed-mode').onchange = () => {
        const chosen = el('speed-mode').value;
        if (!speedModes.includes(chosen)) { el('speed-mode').value = speedMode; return; }
        speedMode = chosen;
        try { localStorage.setItem(speedKey, speedMode); } catch (_) {}
        message((speedMode === 'high-speed' ? '高速模式' : '低负载模式') + '将在之后开始的任务生效，不改变画质或剧情时序。');
        refreshAvailability();
    };
    el('concurrency').onchange = () => {
        const chosen = Number(el('concurrency').value);
        if (![1, 2].includes(chosen)) return;
        concurrency = chosen;
        try { localStorage.setItem(concurrencyKey, String(concurrency)); } catch (_) {}
        message((concurrency === 2 ? '双线' : '单线') + '将在之后开始的批次生效；每篇成片规格不变。');
        refreshAvailability();
    };
    el('verification-mode').onchange = () => {
        const chosen = el('verification-mode').value;
        if (!['auto', 'quick', 'full'].includes(chosen)) return;
        verificationMode = chosen;
        try { localStorage.setItem(verificationKey, chosen); } catch (_) {}
        message((chosen === 'auto' ? '自动检查（正常时快速，生成期间内存暂停后升级完整）' : chosen === 'quick' ? '仅快速检查（不自动升级）' : '完整检查')
            + '将在之后开始的任务生效，只改变检查力度，不改写画面或声音。');
        refreshAvailability();
    };
    el('start').onclick = async () => {
        if (!verificationModes.includes(verificationMode)) { message('后台服务尚未支持所选检查模式，请等待任务结束后重启服务。', true); return; }
        if (!speedModes.includes(speedMode)) { message('后台服务尚未支持所选速度模式，请在队列空闲后重启直出服务。', true); return; }
        if (!concurrencyModes.includes(concurrency)) { message('后台服务尚未支持所选并行数，请等待任务结束后重启服务。', true); return; }
        const settings = settingValues();
        if (!settings) { message('请先检查导出内存设置。', true); return; }
        commitSettings(settings);
        const ids = pending().filter(j => selected.has(j.id)).map(j => j.id);
        // Track progress in the existing workshop. Do not open, close, focus,
        // minimize or navigate any window as a side effect of starting a job.
        const started = await action('start', { ids, settings, speedMode, concurrency, verificationMode });
        if (!started) return;
        message('已开始后台导出，进度显示在下方任务列表；不自动弹出小窗，可按需手动最小化工坊。');
    };
    el('open-root').onclick = () => action('open-root');
    el('files').onchange = event => {
        const files = [...event.target.files]; event.target.value = '';
        if (!files.length) return;
        submit(async () => {
            if (files.length > 20) throw new Error('一次最多提交 20 份 JSON');
            const items = [];
            for (const file of files) {
                const match = /^(\d{6,14})(\.zh-cn)?\.json$/i.exec(file.name);
                if (!match) throw new Error('文件名须为 剧情编号.json 或 剧情编号.zh-cn.json：' + file.name);
                if (file.size > 12 * 1024 * 1024) throw new Error('剧情 JSON 过大');
                items.push({ eventId: match[1], eventType: state.eventType, language: match[2] ? 'zh-cn' : 'ja',
                    mode: 'offline', content: await file.text() });
            }
            return items;
        });
    };
    async function poll() {
        if (polling || busy) { setTimeout(poll, 2500); return; }
        polling = true;
        const atRevision = revision;
        try { const data = await request('jobs'); if (atRevision === revision) render(data); }
        catch (error) { available = manualStart = false; serviceError = true; el('badge').textContent = '服务未就绪'; message(error.message, true); window.SSVWorkspace?.setExportSummary(jobs, false); refreshAvailability(); }
        finally { polling = false; setTimeout(poll, document.hidden ? 10000 : 2500); }
    }
    poll();
})();
