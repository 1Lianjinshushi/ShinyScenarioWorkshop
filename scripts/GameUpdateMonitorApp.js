(function () {
    'use strict';

    const core = window.GameUpdateMonitorCore;
    const badge = document.getElementById('game-update-badge');
    const note = document.getElementById('game-update-note');
    const list = document.getElementById('game-update-list');
    const refreshButton = document.getElementById('game-update-refresh');
    const acknowledgeButton = document.getElementById('game-update-acknowledge');
    const rebuildLabelsButton = document.getElementById('game-update-rebuild-labels');
    const portableSnapshotMode = Boolean(globalThis.SSV_PORTABLE_LIBRARY_SNAPSHOT);
    if (!core || !badge || !note || !list || !refreshButton || !acknowledgeButton) return;
    let libraryLabels = { cards: {}, activities: {}, stories: {}, stats: {} };
    let rebuildingLabels = false;
    let lastExpandedRoot = null;
    let lastTreeSignature = '';
    const collapseAllButton = document.createElement('button');
    collapseAllButton.type = 'button';
    collapseAllButton.className = 'monitor-collapse-float';
    collapseAllButton.hidden = true;
    collapseAllButton.innerHTML = '<span class="monitor-collapse-icon" aria-hidden="true">↑</span><span>收起</span>';
    collapseAllButton.setAttribute('aria-label', '收起全部已展开项目并返回当前大类标题');
    document.body.appendChild(collapseAllButton);

    function topLevelDetails(details) {
        if (!details || !details.isConnected) return null;
        if (details.matches('.monitor-update-log')) return details;
        return details.closest('.monitor-tree-node[data-depth="0"]') || details;
    }

    function syncCollapseAllButton() {
        collapseAllButton.hidden = !list.querySelector('details[open]');
    }

    collapseAllButton.addEventListener('click', () => {
        const anchor = lastExpandedRoot && lastExpandedRoot.isConnected
            ? lastExpandedRoot
            : list.querySelector('.monitor-update-log[open], .monitor-tree-node[data-depth="0"][open]');
        const summary = anchor && anchor.querySelector(':scope > summary');
        Array.from(list.querySelectorAll('details[open]')).reverse().forEach(details => {
            details.open = false;
        });
        lastExpandedRoot = null;
        collapseAllButton.hidden = true;
        requestAnimationFrame(() => summary && summary.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    });

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function localTime(value) {
        if (!value) return '尚未扫描';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
    }

    function applyLibraryLabels(items) {
        const cards = libraryLabels && libraryLabels.cards || {};
        const activities = libraryLabels && libraryLabels.activities || {};
        const stories = libraryLabels && libraryLabels.stories || {};
        return (Array.isArray(items) ? items : []).map(item => {
            const row = Object.assign({}, item);
            const story = stories[`${row.eventType || ''}/${row.eventId || ''}`];
            // Listener metadata comes from the page game itself. A cached
            // catalogue title is only a fallback and must never downgrade or
            // replace a newer official value.
            if (!row.storyTitle && story && story.storyTitle) {
                row.storyTitle = story.storyTitle;
                row.metadataSource = story.source || row.metadataSource;
            }
            if (row.eventType === 'produce_events' && /^[23]\d{8}$/.test(String(row.eventId || ''))) {
                const metadata = cards[String(row.eventId).slice(0, 7)];
                if (!row.cardName && metadata && metadata.cardName) row.cardName = metadata.cardName;
            } else if (row.eventType === 'game_event_communications') {
                const match = String(row.eventId || '').match(/^4001(\d{3})\d{2}$/);
                const metadata = match && activities[match[1]];
                if (!row.activityLabel && metadata && metadata.label) row.activityLabel = metadata.label;
            }
            return row;
        });
    }

    function statusChipMarkup(chip) {
        return `<span class="monitor-status-chip ${escapeHtml(chip.tone || '')}"><b>${escapeHtml(chip.label)}</b>${escapeHtml(chip.text)}</span>`;
    }

    function implementationMarkup(node) {
        if (!node || !['produce-card', 'support-card', 'game-event'].includes(node.category)) return '';
        const rows = Array.isArray(node.children) ? node.children : [];
        const implemented = rows.some(row => row.pageImplementationStatus === 'available'
            || row.staticCardStatus === 'available'
            || (node.category === 'game-event' && row.activityImplementationStatus === 'available'));
        const unimplemented = rows.some(row => row.pageImplementationStatus === 'missing'
            || row.staticCardStatus === 'missing'
            || row.updateKind === 'preload'
            || (node.category === 'game-event' && row.activityImplementationStatus === 'missing'));
        const status = implemented ? '已实装' : unimplemented ? '未实装' : '待检测';
        const tone = implemented ? 'good' : unimplemented ? 'missing' : 'pending';
        return statusChipMarkup({ label: '页游实装状态', text: status, tone });
    }

    function childMarkup(row) {
        const source = row.storyTitle
            ? row.metadataSource === 'official-game-api'
                ? '名称已由页游主数据补齐'
                : '名称已由 shinycolors.moe 自动补齐'
            : `${row.categoryLabel || '剧情'} · 根据资源编号自动分类`;
        const isCard = row.eventType === 'produce_events' && /^[23]\d{8}$/.test(String(row.eventId || ''));
        const changeText = row.implementationChanges
            ? ` · 本次更新：${isCard ? '卡片资料或页游实装状态变更' : row.implementationChanges}`
            : '';
        return `<article class="monitor-row monitor-child${row.unread ? ' unread' : ''}" data-event-type="${escapeHtml(row.eventType)}" data-event-id="${escapeHtml(row.eventId)}">
            <div class="monitor-copy">
                <strong>${escapeHtml(core.childDisplayLine(row))}</strong>
                <span>${escapeHtml(source)} · 首次发现 ${escapeHtml(localTime(row.firstSeenAt))}${escapeHtml(changeText)}</span>
            </div>
            <button class="monitor-use" type="button">填入工坊</button>
        </article>`;
    }

    function bindUseButtons(container) {
        container.querySelectorAll('.monitor-use').forEach(button => {
            button.addEventListener('click', () => {
                const row = button.closest('.monitor-row');
                const type = document.getElementById('event-type');
                const id = document.getElementById('event-id');
                if (type && Array.from(type.options).some(option => option.value === row.dataset.eventType)) {
                    type.value = row.dataset.eventType;
                }
                if (id) id.value = row.dataset.eventId;
                document.querySelector('.fetch-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    function downloadFilename(response, fallback) {
        const disposition = response.headers.get('Content-Disposition') || '';
        const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
        if (encoded) {
            try { return decodeURIComponent(encoded[1]); } catch (_) {}
        }
        return fallback;
    }

    async function exportScenarioGroup(node, button) {
        const eventIds = (node.children || []).map(row => row.eventId).filter(Boolean);
        if (!node.eventType || !eventIds.length) return;
        button.disabled = true;
        const oldText = button.textContent;
        button.textContent = '正在抓取并打包…';
        note.textContent = `正在获取 ${node.label} 的 ${eventIds.length} 话日文 JSON，并转换为可翻译 CSV。`;
        try {
            const response = await fetch('./api/export-scenario-group', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    eventType: node.eventType,
                    eventIds,
                    groupLabel: node.label,
                    updateDetectedAt: (node.children || []).map(row => row.updateDetectedAt).find(Boolean) || '',
                    translator: window.SSVWorkshopSettings
                        ? window.SSVWorkshopSettings.translatorName()
                        : '',
                }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${response.status}`);
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = downloadFilename(response, `${String(node.code || 'scenario-group').replace(/_/g, '')}.zip`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            note.textContent = `已导出 ${node.label}：${eventIds.length} 份 CSV；文件内已按每话标题自动命名。`;
        } catch (error) {
            note.textContent = `整组 CSV 导出失败：${error.message}`;
        } finally {
            button.disabled = false;
            button.textContent = oldText;
        }
    }

    function groupExportMarkup(node) {
        if (!node.trainingGroup && !['produce-card', 'support-card', 'game-event', 'special'].includes(node.category)) return '';
        return `<div class="monitor-group-actions">
            <span>整组操作会抓取当前分组全部日文剧情，并生成可直接翻译／回灌的 CSV。</span>
            <button class="monitor-group-export" type="button">获取整组 CSV（ZIP）</button>
        </div>`;
    }

    function bindGroupExport(container, node) {
        const button = container.querySelector('.monitor-group-export');
        if (button) button.addEventListener('click', () => exportScenarioGroup(node, button));
    }

    function countText(node) {
        const total = Number(node.totalCount || 0);
        if (node.kind === 'scenario-group') {
            return `${total} 话`;
        }
        if (node.kind === 'character-type' && (node.label === 'P卡' || node.label === 'S卡')) {
            const cards = Array.isArray(node.children) ? node.children.length : 0;
            return `${cards} 张卡`;
        }
        if (node.kind === 'update-day') return `${Array.isArray(node.children) ? node.children.length : 0} 组`;
        return `${total} 条`;
    }

    function treeMarkup(node, depth, openKeys) {
        const open = openKeys.has(node.treeKey);
        // Implementation belongs to the card/activity as a whole. Do not
        // repeat resource-state chips on every child story.
        const implementation = implementationMarkup(node);
        return `<details class="monitor-tree-node monitor-tree-${escapeHtml(node.kind)}" data-tree-key="${escapeHtml(node.treeKey)}" data-depth="${depth}"${open ? ' open' : ''}>
            <summary class="monitor-tree-summary">
                <div class="monitor-copy">
                    <strong>${escapeHtml(node.label)}</strong>
                    <span>${node.code ? `<code class="monitor-group-code">${escapeHtml(node.code)}</code> · ` : ''}${escapeHtml(node.description || '')}</span>
                </div>
                <div class="monitor-tree-meta">${implementation}<span class="monitor-group-count">${escapeHtml(countText(node))}</span></div>
            </summary>
            <div class="monitor-tree-children"><div class="monitor-lazy-note">展开后加载下一级内容。</div></div>
        </details>`;
    }

    function indexTree(nodes, target) {
        for (const node of nodes) {
            target.set(node.treeKey, node);
            if (node.kind !== 'scenario-group') indexTree(node.children || [], target);
        }
    }

    function bindTreeNodes(container, nodeMap, openKeys) {
        Array.from(container.children).forEach(details => {
            if (!details.matches || !details.matches('.monitor-tree-node')) return;
            const node = nodeMap.get(details.dataset.treeKey);
            if (!node || details.dataset.treeBound === 'true') return;
            details.dataset.treeBound = 'true';
            const materialize = () => {
                if (details.dataset.childrenRendered === 'true') return;
                const childContainer = details.querySelector(':scope > .monitor-tree-children');
                const depth = Number(details.dataset.depth || 0) + 1;
                if (node.kind === 'scenario-group') {
                    childContainer.innerHTML = groupExportMarkup(node)
                        + node.children.map(row => childMarkup(row)).join('');
                    bindUseButtons(childContainer);
                    bindGroupExport(childContainer, node);
                } else {
                    childContainer.innerHTML = node.children.length
                        ? node.children.map(child => treeMarkup(child, depth, openKeys)).join('')
                        : '<div class="monitor-lazy-note">此分类暂时没有剧情。</div>';
                    bindTreeNodes(childContainer, nodeMap, openKeys);
                }
                details.dataset.childrenRendered = 'true';
            };
            details.addEventListener('toggle', () => {
                if (details.open) {
                    lastExpandedRoot = topLevelDetails(details);
                    materialize();
                }
                requestAnimationFrame(syncCollapseAllButton);
            });
            if (details.open) {
                lastExpandedRoot = topLevelDetails(details);
                materialize();
            }
        });
    }

    function contentSignature(data, rows) {
        const stableRows = rows.map(row => [
            row.eventType || '', row.eventId || '', Boolean(row.unread),
            row.updateDetectedAt || '', row.updateKind || '',
            row.cardName || '', row.storyTitle || '', row.activityLabel || '',
            row.pageImplementationStatus || '', row.activityImplementationStatus || '',
            row.staticCardStatus || '',
        ]);
        return JSON.stringify({
            initialized: Boolean(data.initialized),
            rows: stableRows,
        });
    }

    function render(data) {
        const unread = Number(data.unreadCount || 0);
        const total = Number(data.totalCount || 0);
        const listener = data.listenerStatus || {};
        const failureStages = new Set(['webpack-missed', 'asset-map-missing', 'empty-asset-map', 'scan-error', 'local-http-error']);
        badge.textContent = data.initialized
            ? `${unread} 条未读 / ${total} 条已知`
            : portableSnapshotMode
                ? '资源库快照尚未建立'
            : listener.stage
                ? (failureStages.has(listener.stage) ? '监听遇到问题' : '脚本已连接')
                : '尚未建立基线';
        badge.className = `badge${unread || failureStages.has(listener.stage) ? ' warn' : data.initialized || listener.stage ? ' good' : ''}`;
        acknowledgeButton.disabled = unread === 0;
        const listenerText = listener.message
            ? `监听状态：${listener.message}（脚本 ${listener.scriptVersion || '未知版本'}，${localTime(listener.reportedAt)}）`
            : '';
        const enrichment = data.enrichmentStatus || {};
        const enrichmentText = data.lastEnrichmentAt
            ? `　名称资料检查：${localTime(data.lastEnrichmentAt)}，${Number(enrichment.updatedStories || 0)} 条剧情已核对；只补卡名和单话标题，不会后台下载卡图或视频。`
            : '';
        note.textContent = portableSnapshotMode
            ? data.initialized
                ? `便携包内置资源库快照：${localTime(data.lastObservedAt)}　资源版本：${data.assetVersion || '未报告'}。本包不含页游监听脚本；刷新列表只读取包内现有记录。${enrichmentText}`
                : '本便携包不含页游监听脚本，当前也没有可读取的资源库快照。'
            : data.initialized
                ? `最近扫描：${localTime(data.lastObservedAt)}　资源版本：${data.assetVersion || '未报告'}。监听脚本每 10 分钟检查；存在待实装卡时还会在每天 23:02 专门复查。页游标签不必置于前台，但不能被浏览器休眠或丢弃。${enrichmentText}`
                : listenerText || '安装脚本后打开一次页游，首次扫描只建立基线，不会把已有剧情全部报成更新。';

        const rows = applyLibraryLabels(data.items);
        const signature = contentSignature(data, rows);
        if (signature === lastTreeSignature && list.childElementCount) {
            syncCollapseAllButton();
            return;
        }
        lastTreeSignature = signature;
        lastExpandedRoot = null;
        if (!rows.length) {
            list.innerHTML = `<div class="empty-state">${data.initialized ? '基线已建立，目前没有记录。' : portableSnapshotMode ? '此便携包没有内置资源库记录。' : '等待页游监听脚本送来第一份资源清单。'}</div>`;
            return;
        }
        const openTreeKeys = new Set(Array.from(
            list.querySelectorAll('.monitor-tree-node[open]'), item => item.dataset.treeKey
        ));
        const updateLogWasOpen = Boolean(list.querySelector('.monitor-update-log[open]'));
        const hierarchy = core.buildScenarioHierarchy(rows);
        const updateLog = core.buildUpdateLog(rows);
        const nodeMap = new Map();
        indexTree(hierarchy, nodeMap);
        indexTree(updateLog, nodeMap);
        const updateLogBody = updateLog.length
            ? updateLog.map(node => treeMarkup(node, 0, openTreeKeys)).join('')
            : '<div class="monitor-lazy-note">升级后的新发现会按日期保存在这里；旧基线不会被误报为更新。</div>';
        list.innerHTML = `<details class="monitor-update-log${unread ? ' unread' : ''}"${updateLogWasOpen || unread ? ' open' : ''}>
            <summary class="monitor-update-log-summary">
                <span class="monitor-update-log-dot" aria-hidden="true"></span>
                <div class="monitor-copy">
                    <strong>更新日志</strong>
                    <span>按发现日期整理新增剧情；标记已读后历史记录仍会保留。</span>
                </div>
                <span class="monitor-group-count">${unread ? `${unread} 条未读` : `${updateLog.length} 个日期`}</span>
            </summary>
            <div class="monitor-update-log-days">${updateLogBody}</div>
        </details>
        <section class="monitor-library">
            <div class="monitor-library-heading">
                <div><strong>完整资源库</strong><span>按活动、育成、特殊剧情以及组合／角色／卡片分层浏览</span></div>
                <span>${total} 条剧情</span>
            </div>
            <div class="monitor-library-tree">${hierarchy.map(node => treeMarkup(node, 0, openTreeKeys)).join('')}</div>
        </section>`;
        const logDays = list.querySelector('.monitor-update-log-days');
        const libraryTree = list.querySelector('.monitor-library-tree');
        if (logDays) bindTreeNodes(logDays, nodeMap, openTreeKeys);
        if (libraryTree) bindTreeNodes(libraryTree, nodeMap, openTreeKeys);
        const updateLogDetails = list.querySelector('.monitor-update-log');
        if (updateLogDetails) {
            updateLogDetails.addEventListener('toggle', () => {
                if (updateLogDetails.open) lastExpandedRoot = updateLogDetails;
                requestAnimationFrame(syncCollapseAllButton);
            });
            if (updateLogDetails.open) lastExpandedRoot = updateLogDetails;
        }
        syncCollapseAllButton();
    }

    async function load() {
        if (rebuildingLabels) return;
        refreshButton.disabled = true;
        try {
            const [response, labelsResponse] = await Promise.all([
                fetch('./api/game-update-monitor', { cache: 'no-store' }),
                fetch('./api/scenario-library-labels', { cache: 'no-store' }).catch(() => null),
            ]);
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            if (labelsResponse && labelsResponse.ok) {
                libraryLabels = await labelsResponse.json().catch(() => libraryLabels);
            }
            render(data);
        } catch (error) {
            badge.textContent = '监听接口不可用';
            badge.className = 'badge warn';
            note.textContent = `请关闭旧服务器并重新运行 start-viewer.cmd：${error.message}`;
        } finally {
            refreshButton.disabled = false;
        }
    }

    async function rebuildLibraryLabels() {
        if (!rebuildLabelsButton || rebuildingLabels) return;
        rebuildingLabels = true;
        rebuildLabelsButton.disabled = true;
        refreshButton.disabled = true;
        const oldText = rebuildLabelsButton.textContent;
        rebuildLabelsButton.textContent = '正在扫描全库名称…';
        note.textContent = '正在批量读取角色卡列表，并扫描各期活动的实际发言人。首次补全可能需要数分钟；完成后结果会保存在本地。';
        try {
            const response = await fetch('./api/rebuild-scenario-library-labels', {
                method: 'POST',
                body: '',
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
            libraryLabels = result;
            lastTreeSignature = '';
            const stats = result.stats || {};
            const monitorResponse = await fetch('./api/game-update-monitor', { cache: 'no-store' });
            const monitorData = await monitorResponse.json().catch(() => ({}));
            if (!monitorResponse.ok) throw new Error(monitorData.error || `HTTP ${monitorResponse.status}`);
            render(monitorData);
            note.textContent = `资料库名称已补全：角色卡 ${stats.namedCardGroups || 0}/${stats.knownCardGroups || 0} 张，活动 ${stats.namedActivityGroups || 0}/${stats.knownActivityGroups || 0} 期。未命中的新卡会在资料站更新或页游主数据到达后自动补入。`;
        } catch (error) {
            note.textContent = `全库名称补全失败：${error.message}`;
        } finally {
            rebuildingLabels = false;
            rebuildLabelsButton.disabled = false;
            rebuildLabelsButton.textContent = oldText;
            refreshButton.disabled = false;
        }
    }

    async function acknowledge() {
        acknowledgeButton.disabled = true;
        try {
            const response = await fetch('./api/game-update-acknowledge', { method: 'POST', body: '' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            render(data);
        } catch (error) {
            note.textContent = `标记已读失败：${error.message}`;
        }
    }

    refreshButton.addEventListener('click', load);
    acknowledgeButton.addEventListener('click', acknowledge);
    if (rebuildLabelsButton) rebuildLabelsButton.addEventListener('click', rebuildLibraryLabels);
    load();
    setInterval(load, 30000);
})();
