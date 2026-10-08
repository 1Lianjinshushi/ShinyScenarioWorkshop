'use strict';
(function () {
    const views = new Map(Array.from(document.querySelectorAll('[data-workspace-view]'), node => [node.dataset.workspaceView, node]));
    if (!views.size) return;
    const viewKey = 'ssv.workspace.view.v1', tabKey = 'ssv.workspace.libraryTab.v1';
    const scrolls = new Map();
    let current = '', libraryTab = 'updates', storyKey = '', storyRevision = 0;
    const get = id => document.getElementById(id);
    const read = key => { try { return localStorage.getItem(key); } catch (_) { return null; } };
    const save = (key, value) => { try { localStorage.setItem(key, value); } catch (_) {} };
    function hashView() {
        return ({ 'game-update-monitor': 'library', 'offline-export-panel': 'export' })[location.hash.slice(1)] || location.hash.slice(1);
    }
    function show(view, { focus = false, remember = true } = {}) {
        if (!views.has(view)) return;
        if (current !== view) {
            if (current) scrolls.set(current, window.scrollY);
            current = view;
            // Keep every live DOM node: switches must never recreate library trees,
            // file inputs, translated snapshots, or running job rows.
            for (const [key, node] of views) node.hidden = key !== view;
            for (const button of document.querySelectorAll('.workspace-nav [data-go-workspace]')) {
                if (button.dataset.goWorkspace === view) button.setAttribute('aria-current', 'page');
                else button.removeAttribute('aria-current');
            }
            window.scrollTo(0, scrolls.get(view) || 0);
        }
        if (remember) {
            save(viewKey, view);
            history.replaceState(null, '', '#' + view);
        }
        if (focus) views.get(view).querySelector('h2')?.focus({ preventScroll: true });
        window.dispatchEvent(new CustomEvent('ssv-workspace-view-changed', { detail: { view } }));
    }
    function applyLibraryTab() {
        for (const tab of document.querySelectorAll('[data-library-tab]')) {
            const active = tab.dataset.libraryTab === libraryTab;
            tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
        }
        for (const name of ['updates', 'all']) {
            const pane = get('library-pane-' + name);
            if (pane) pane.hidden = name !== libraryTab;
        }
        window.dispatchEvent(new CustomEvent('ssv-workspace-library-changed'));
    }
    function selectLibraryTab(tab) {
        if (!['updates', 'all'].includes(tab)) return;
        libraryTab = tab; save(tabKey, tab); applyLibraryTab();
    }
    function syncMirrors() {
        for (const button of document.querySelectorAll('button[data-workspace-click]')) {
            const target = get(button.dataset.workspaceClick);
            button.disabled = !target || target.disabled;
        }
    }
    function updateStory(snapshot) {
        const loaded = !!snapshot.tracks;
        const key = loaded ? snapshot.eventType + '/' + snapshot.eventId : '';
        if (key !== storyKey) {
            storyKey = key;
            const revision = ++storyRevision;
            get('workspace-story').textContent = loaded ? snapshot.eventId : '尚未载入';
            if (loaded && window.ScenarioStoryMetadata) {
                const eventId = snapshot.eventId;
                window.ScenarioStoryMetadata.resolve(snapshot.eventType, eventId).then(metadata => {
                    if (revision !== storyRevision) return;
                    get('workspace-story').textContent = [metadata.storyTitle, eventId].filter(Boolean).join(' · ');
                }).catch(() => {});
            }
        }
        const matched = loaded && snapshot.csvText && snapshot.csvEventType === snapshot.eventType && snapshot.csvEventId === snapshot.eventId;
        get('workspace-csv').textContent = matched ? 'CSV 已匹配 · ' + snapshot.csvName
            : loaded ? '日文剧情已载入 · 可导入 CSV 或进入编辑模式' : '可导入 CSV，或从资源库选择剧情';
        get('workspace-resource-status').textContent = snapshot.cacheBusy ? '正在缓存'
            : snapshot.cachedLocally ? '已缓存，可离线播放' : loaded ? '本地未齐 / 待检查' : '载入后自动检查';
        if (loaded && !snapshot.cacheBusy && !snapshot.cachedLocally) get('story-resources').open = true;
        syncMirrors();
    }
    function updateSpeakers(missing) { get('speaker-details').open = missing > 0; }
    function setExportSummary(jobs, available) {
        const count = status => jobs.filter(j => j.state === status).length;
        const button = get('workspace-export-status');
        button.textContent = [count('running') + ' 运行', count('queued') + ' 排队', count('pending') + ' 待导出',
            count('paused') ? count('paused') + ' 暂停' : '', !available ? '服务未就绪' : ''].filter(Boolean).join(' · ');
        button.dataset.tone = count('paused') || !available ? 'warn' : 'normal';
        syncMirrors();
    }
    document.addEventListener('click', event => {
        const button = event.target.closest('[data-go-workspace], [data-workspace-click], [data-library-tab]');
        if (!button || button.disabled) return;
        if (button.dataset.goWorkspace) show(button.dataset.goWorkspace, { focus: true });
        if (button.dataset.libraryTab) selectLibraryTab(button.dataset.libraryTab);
        if (button.dataset.workspaceClick) get(button.dataset.workspaceClick)?.click();
    });
    document.querySelector('.library-tabs')?.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const tab = event.key === 'Home' ? 'updates' : event.key === 'End' ? 'all' : libraryTab === 'updates' ? 'all' : 'updates';
        selectLibraryTab(tab); get('library-tab-' + tab).focus();
    });
    window.addEventListener('hashchange', () => show(hashView(), { focus: true }));
    window.SSVWorkspace = Object.freeze({ show, applyLibraryTab, updateStory, updateSpeakers, setExportSummary, syncMirrors });
    if (read(tabKey) === 'all') libraryTab = 'all';
    applyLibraryTab();
    const initial = views.has(hashView()) ? hashView() : read(viewKey);
    show(views.has(initial) ? initial : 'workbench', { remember: false });
    // Development and portable packages have different PDF paths; probe locally
    // once, without modifying files or leaving the workbench on a failed link.
    for (const link of document.querySelectorAll('[data-help-fallback]')) {
        fetch(link.getAttribute('href'), { method: 'HEAD' }).then(response => {
            if (!response.ok) link.href = link.dataset.helpFallback;
        }).catch(() => { link.href = link.dataset.helpFallback; });
    }
}());
