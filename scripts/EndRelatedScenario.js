'use strict';

(function installEndRelatedScenario() {
    const REMOTE_ROOT = 'https://service.sc-viewer.top/custom';
    const REMOTE_JSON_FALLBACK = 'https://service.sc-viewer.top/convert/cache/json';
    const MAX_CONSECUTIVE_MISSES = 2;
    const TENS_COUNT = 2;
    const UNITS_COUNT = 9;
    const PAGE_SIZE = 3;
    const CHOICE_RETURN_MOVIE = './assets/movies/choice_branch_return.mp4';

    function buildFollowingGroups(eventId) {
        const value = String(eventId || '').trim();
        if (!/^\d{3,}$/.test(value)) return [];
        const prefix = value.slice(0, -2);
        const startTens = Number(value.slice(-2, -1));
        const startUnit = Number(value.slice(-1));
        const groups = [];
        for (let offset = 0; offset < TENS_COUNT; offset++) {
            const tens = startTens + offset;
            if (tens > 9) break;
            const firstUnit = offset === 0 ? Math.max(1, startUnit + 1) : 1;
            const ids = [];
            for (let unit = firstUnit; unit <= UNITS_COUNT; unit++) {
                ids.push(`${prefix}${tens}${unit}`);
            }
            groups.push({ label: `${prefix}${tens}X`, ids });
        }
        return groups;
    }

    function tryAutoReturnChoice(advPlayer, search) {
        const query = search === undefined
            ? ((window.location && window.location.search) || '')
            : search;
        const correctionMode = new URLSearchParams(query).get('mode') === 'edit';
        if (correctionMode
            || !advPlayer
            || !advPlayer.canReturnToLastChoice
            || !advPlayer.canReturnToLastChoice()
            || !advPlayer.playChoiceReturnTransition) {
            return false;
        }
        // Ordinary playback mirrors the edited reference: preserve the branch
        // fade, key the transition near the end of its empty black hold, then
        // rebuild the latest choice menu without showing End in between.
        advPlayer.playChoiceReturnTransition(CHOICE_RETURN_MOVIE);
        return true;
    }

    async function fetchScenarioCandidate(eventType, eventId) {
        const localPath = `./assets/json/${eventType}/${eventId}.json`;
        const remotePath = `${REMOTE_ROOT}/json/${eventType}/${eventId}.json`;
        const fallbackPath = `${REMOTE_JSON_FALLBACK}/${eventType}/${eventId}.json`;
        const candidates = [
            { url: localPath, source: 'local' },
            { url: remotePath, source: 'remote' },
            { url: fallbackPath, source: 'remote' },
        ];
        const errors = [];
        for (const candidate of candidates) {
            try {
                const response = await fetch(candidate.url, { cache: 'no-store', mode: 'cors' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const tracks = JSON.parse(await response.text());
                if (!Array.isArray(tracks) || tracks.length === 0) {
                    throw new Error('not a non-empty scenario array');
                }
                let hasTranslation = false;
                if (globalThis.ScenarioCsvTranslation) {
                    const translation = await ScenarioCsvTranslation.loadTranslation(eventType, eventId);
                    hasTranslation = translation.text != null;
                }
                return {
                    eventType,
                    eventId,
                    source: candidate.source,
                    trackCount: tracks.length,
                    hasTranslation,
                };
            } catch (error) {
                errors.push(`${candidate.url}: ${error.message}`);
            }
        }
        throw new Error(errors.join(' | '));
    }

    async function findFollowingScenarios(eventType, eventId, onProgress = () => {}) {
        const hits = [];
        const misses = [];
        const groups = buildFollowingGroups(eventId);
        for (const group of groups) {
            let consecutiveMisses = 0;
            for (const candidateId of group.ids) {
                if (consecutiveMisses >= MAX_CONSECUTIVE_MISSES) break;
                onProgress({ eventId: candidateId, group: group.label, hits: hits.length });
                try {
                    const hit = await fetchScenarioCandidate(eventType, candidateId);
                    hits.push(hit);
                    consecutiveMisses = 0;
                } catch (error) {
                    misses.push({ eventId: candidateId, error: error.message });
                    consecutiveMisses++;
                }
            }
        }
        return { hits, misses, groups };
    }

    function buildRelatedPages(hits, pageSize = PAGE_SIZE) {
        const size = Math.max(1, Number(pageSize) || PAGE_SIZE);
        const pages = [];
        for (let index = 0; index < (hits || []).length; index += size) {
            pages.push(hits.slice(index, index + size));
        }
        return pages;
    }

    async function addTranslationAvailability(hit) {
        let hasTranslation = false;
        if (globalThis.ScenarioCsvTranslation) {
            const translation = await ScenarioCsvTranslation.loadTranslation(hit.eventType, hit.eventId);
            hasTranslation = translation.text != null;
        }
        return Object.assign({}, hit, { hasTranslation });
    }

    async function findAvailableRelatedScenarios(eventType, eventId, onProgress = () => {}) {
        const manifest = globalThis.RelatedScenarioSearch
            && typeof RelatedScenarioSearch.loadManifest === 'function'
            ? RelatedScenarioSearch.loadManifest(eventType, eventId)
            : null;
        if (manifest) {
            const storedHits = manifest.hits.filter(hit => (
                hit.eventType !== eventType || hit.eventId !== eventId
            ));
            if (storedHits.length) {
                onProgress({ phase: 'manifest', hits: storedHits.length });
                return {
                    hits: await Promise.all(storedHits.map(addTranslationAvailability)),
                    fromManifest: true,
                };
            }
        }
        const result = await findFollowingScenarios(eventType, eventId, onProgress);
        return Object.assign(result, { fromManifest: false });
    }

    function createText(value, size, color, x, y) {
        const result = new PIXI.Text(value, {
            fontFamily: USED_FONT,
            fontSize: size,
            fill: color,
            align: 'center',
            padding: 3,
        });
        result.anchor.set(0.5);
        result.position.set(x, y);
        return result;
    }

    function createButton(label, x, y, width, height, onTap, compact = false) {
        const container = new PIXI.Container();
        container.position.set(x, y);
        container.interactive = true;
        container.buttonMode = true;
        container.hitArea = new PIXI.Rectangle(-width / 2, -height / 2, width, height);

        const bg = new PIXI.Graphics();
        const draw = (color, alpha, lineAlpha) => {
            bg.clear();
            bg.lineStyle(1, 0xff75aa, lineAlpha);
            bg.beginFill(color, alpha);
            bg.drawRoundedRect(-width / 2, -height / 2, width, height, compact ? 12 : 16);
            bg.endFill();
        };
        draw(0x242332, 0.96, 0.42);
        container.addChild(bg);

        container.addChild(createText(label, compact ? 17 : 21, 0xffffff, 0, 0));
        container.on('pointerover', () => draw(0x3a2c40, 0.98, 0.82));
        container.on('pointerout', () => draw(0x242332, 0.96, 0.42));
        container.on('pointerdown', () => container.scale.set(0.98));
        container.on('pointerupoutside', () => container.scale.set(1));
        container.on('pointertap', () => {
            container.scale.set(1);
            onTap();
        });
        return container;
    }

    function buildScenarioSearch(currentSearch, hit) {
        const params = new URLSearchParams(currentSearch);
        params.set('eventType', hit.eventType);
        params.set('eventId', hit.eventId);
        params.set('source', hit.source || 'remote');
        return params.toString();
    }

    function navigateToScenario(hit) {
        window.location.search = buildScenarioSearch(window.location.search, hit);
    }

    function addRelatedKeyboard(getHits, changePage) {
        const onKeyDown = (event) => {
            const target = event.target;
            if (target && (
                target.isContentEditable
                || target.tagName === 'INPUT'
                || target.tagName === 'TEXTAREA'
                || target.tagName === 'SELECT'
            )) return;
            const match = /^(?:Digit|Numpad)([1-3])$/.exec(event.code || '');
            if (match) {
                const hit = getHits()[Number(match[1]) - 1];
                if (!hit) return;
                event.preventDefault();
                document.removeEventListener('keydown', onKeyDown);
                navigateToScenario(hit);
                return;
            }
            if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
                event.preventDefault();
                changePage(event.code === 'ArrowLeft' ? -1 : 1);
            }
        };
        document.addEventListener('keydown', onKeyDown);
    }

    function workshopReturnAction(search) {
        return new URLSearchParams(search || '').get('returnMode') === 'current'
            ? 'navigate'
            : 'close';
    }

    function returnToWorkshop() {
        if (workshopReturnAction(window.location.search) === 'navigate') {
            window.location.href = './app.html';
            return;
        }
        if (window.opener && !window.opener.closed) window.opener.focus();
        window.close();
        setTimeout(() => {
            if (!window.closed) window.location.href = './app.html';
        }, 100);
    }

    function addRelatedControls(overlay, eventType, eventId) {
        const content = overlay.content;
        const related = new PIXI.Container();
        content.addChild(related);
        const currentLanguage = new URLSearchParams(window.location.search).get('language');

        const status = createText('正在查找后续关联剧情……', 18, 0xc8bfd8, 568, 394);
        related.addChild(status);

        related.addChild(createButton('返回剧情整理工坊', 990, 52, 250, 42, returnToWorkshop, true));

        findAvailableRelatedScenarios(eventType, eventId, (progress) => {
            status.text = progress.phase === 'manifest'
                ? `正在读取已抓取的 ${progress.hits} 段关联剧情……`
                : `正在查找 ${progress.eventId}……`;
        }).then((result) => {
            const hits = result.hits;
            if (hits.length === 0) {
                status.text = '未找到后续关联剧情';
                status.style.fill = 0xaaa2b5;
                return;
            }
            const pages = buildRelatedPages(hits);
            let pageIndex = 0;
            let pageLayer = null;
            const renderPage = () => {
                if (pageLayer) {
                    related.removeChild(pageLayer);
                    pageLayer.destroy({ children: true });
                }
                pageLayer = new PIXI.Container();
                related.addChild(pageLayer);
                const pageHits = pages[pageIndex];
                const origin = result.fromManifest ? '已抓取关联剧情' : '后续关联剧情';
                const pageLabel = pages.length > 1 ? ` · 第 ${pageIndex + 1}/${pages.length} 页` : '';
                status.text = `选择${origin}继续播放${pageLabel}（数字键 1 / 2 / 3）`;
                status.style.fill = 0xff92bd;
                pageHits.forEach((hit, index) => {
                    const sourceLabel = result.fromManifest
                        ? '已抓取'
                        : (hit.source === 'local' ? '本地' : '在线');
                    const translationLabel = currentLanguage === 'cn'
                        ? (hit.hasTranslation ? ' · 汉化 CSV' : ' · 无 CSV（日文回退）')
                        : '';
                    const label = `${index + 1}.  ▶  ${hit.eventId}  ·  ${sourceLabel}${translationLabel}  ·  ${hit.trackCount} 轨道`;
                    pageLayer.addChild(createButton(label, 568, 442 + index * 60, 620, 50, () => {
                        navigateToScenario(hit);
                    }));
                });
                if (pages.length > 1) {
                    pageLayer.addChild(createButton('◀ 上一页', 390, 616, 180, 34, () => changePage(-1), true));
                    pageLayer.addChild(createButton('下一页 ▶', 746, 616, 180, 34, () => changePage(1), true));
                }
            };
            const changePage = (direction) => {
                pageIndex = (pageIndex + direction + pages.length) % pages.length;
                renderPage();
            };
            renderPage();
            addRelatedKeyboard(() => pages[pageIndex], changePage);
        }).catch((error) => {
            console.warn('[EndRelatedScenario] lookup failed', error);
            status.text = '关联剧情检索失败，可返回整理工坊重试';
            status.style.fill = 0xffa3ad;
        });
    }

    showEndOverlay = function showEndOverlayWithRelatedScenarios(app, advPlayer) {
        const overlay = buildEndOverlay(app);
        const params = new URLSearchParams(window.location.search);
        const eventType = params.get('eventType') || 'produce_events';
        const eventId = params.get('eventId') || '';
        const correctionMode = params.get('mode') === 'edit';
        let overlayDisposed = false;
        const disposeOverlay = () => {
            if (overlayDisposed) return;
            overlayDisposed = true;
            if (typeof TweenMax !== 'undefined' && typeof TweenMax.killTweensOf === 'function') {
                TweenMax.killTweensOf(overlay.bg);
                TweenMax.killTweensOf(overlay.content);
            }
            if (overlay.parent) overlay.parent.removeChild(overlay);
            overlay.destroy({ children: true });
        };
        addRelatedControls(overlay, eventType, eventId);
        if (correctionMode
            && advPlayer.canReturnToLastChoice
            && advPlayer.canReturnToLastChoice()) {
            overlay.content.addChild(createButton(
                '退回选择节点',
                148,
                52,
                250,
                42,
                () => advPlayer.returnToLastChoice(),
                true,
            ));
        }
        app.stage.addChild(overlay);
        if (correctionMode && advPlayer.mountEndCorrectionControls) {
            // Keep the two lower-right controls above the End overlay. The log
            // layer is mounted with them so a correction-mode log jump remains
            // available even after the scenario has finished.
            advPlayer.mountEndCorrectionControls(app.stage);
            const leaveEndMode = () => {
                if (advPlayer.off) {
                    advPlayer.off('logJump', leaveEndMode);
                    advPlayer.off('choiceReturn', leaveEndMode);
                }
                advPlayer.restoreEndCorrectionControls();
                disposeOverlay();
            };
            advPlayer.once('logJump', leaveEndMode);
            advPlayer.once('choiceReturn', leaveEndMode);
        }

        if (advPlayer.soundController && typeof advPlayer.soundController.fadeOutAll === 'function') {
            advPlayer.soundController.fadeOutAll(1200);
        }
        const revealText = () => {
            if (overlayDisposed) return;
            if (!correctionMode) advPlayer.stageObj.visible = false;
            if (typeof TweenMax !== 'undefined') TweenMax.to(overlay.content, 0.35, { alpha: 1 });
            else overlay.content.alpha = 1;
        };
        if (typeof TweenMax !== 'undefined') {
            TweenMax.to(overlay.bg, 1.2, { alpha: 1, onComplete: revealText });
        } else {
            overlay.bg.alpha = 1;
            revealText();
        }
    };

    const api = {
        buildFollowingGroups,
        buildScenarioSearch,
        buildRelatedPages,
        workshopReturnAction,
        findFollowingScenarios,
        findAvailableRelatedScenarios,
        tryAutoReturnChoice,
    };
    window.ScenarioEndRelated = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}());
