'use strict';

// Remote/local hybrid bootstrap. It deliberately overrides main.js's
// startScenarioPlayer while reusing the original entry page and player UI.
const SSV_LOCAL_ASSET_ROOT = './assets';
const SSV_REMOTE_ASSET_ROOT = 'https://service.sc-viewer.top/custom';
const SSV_PORTABLE_RUNTIME_MANIFEST = './portable-runtime-assets.json';
const SSV_TRANSLATOR_STORAGE_KEY = 'ssv-workshop-translator';

function ssvTranslatorName() {
    try { return String(localStorage.getItem(SSV_TRANSLATOR_STORAGE_KEY) || '').trim(); }
    catch (_) { return ''; }
}

function ssvSetBootStatus(message, error = false) {
    let status = document.getElementById('ssv-player-boot-status');
    if (!status) {
        status = document.createElement('div');
        status.id = 'ssv-player-boot-status';
        Object.assign(status.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '2147483647',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '32px',
            boxSizing: 'border-box',
            background: '#05040a',
            color: '#f6f1fa',
            fontFamily: '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
            fontSize: '20px',
            lineHeight: '1.65',
            textAlign: 'center',
            whiteSpace: 'pre-wrap',
        });
        document.body.appendChild(status);
    }
    status.style.color = error ? '#ff9bbd' : '#f6f1fa';
    status.textContent = String(message || '正在准备播放器……');
}

function ssvClearBootStatus() {
    const status = document.getElementById('ssv-player-boot-status');
    if (status) status.remove();
}

async function ssvVerifyPortableRuntime() {
    const response = await fetch(SSV_PORTABLE_RUNTIME_MANIFEST, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`播放器基础资源清单缺失（HTTP ${response.status}）。请重新解压完整便携包。`);
    }
    const manifest = await response.json();
    const files = Array.isArray(manifest && manifest.files) ? manifest.files : [];
    if (!files.length) throw new Error('播放器基础资源清单为空，请重新解压完整便携包。');
    const missing = (await Promise.all(files.map(async (relativePath) => {
        try {
            const check = await fetch(`./${String(relativePath).replace(/^\.?\//, '')}`, {
                method: 'HEAD',
                cache: 'no-store',
            });
            return check.ok ? null : relativePath;
        } catch (_) {
            return relativePath;
        }
    }))).filter(Boolean);
    if (missing.length) {
        const preview = missing.slice(0, 8).join('\n');
        const remainder = missing.length > 8 ? `\n……另有 ${missing.length - 8} 项` : '';
        throw new Error(`播放器基础资源不完整：\n${preview}${remainder}\n\n请完整解压 ZIP，或重新获取便携包。`);
    }
    return manifest;
}

function ssvJoinUrl(root, path) {
    return `${String(root).replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
}

function ssvAssetFormats(root) {
    return {
        bg:         ssvJoinUrl(root, 'images/event/bg/${id}.jpg'),
        fg:         ssvJoinUrl(root, 'images/event/fg/${id}.png'),
        middleFg:   ssvJoinUrl(root, 'images/event/fg/${id}.png'),
        bgm:        ssvJoinUrl(root, 'sounds/bgm/${id}.m4a'),
        se:         ssvJoinUrl(root, 'sounds/se/event/${id}.m4a'),
        voice:      ssvJoinUrl(root, 'sounds/voice/events/${id}.m4a'),
        textFrame:  ssvJoinUrl(SSV_LOCAL_ASSET_ROOT, 'images/event/text_frame/${id}.png'),
        still:      ssvJoinUrl(root, 'images/event/still/${id}.jpg'),
        movie:      ssvJoinUrl(root, 'movies/idols/card/${id}.mp4'),
        gameEventCommunicationMovie: ssvJoinUrl(root, 'movies/game_event_communications/${id}.mp4'),
        gameEventCommunicationSe:    ssvJoinUrl(root, 'sounds/se/game_event_communications/${id}.m4a'),
    };
}

function ssvCharacterAssetFormats(root) {
    return {
        spine:        ssvJoinUrl(root, 'spine/${type}/${category}/${id}/data.json'),
        still:        ssvJoinUrl(root, 'images/content/${type}/card/${id}.jpg'),
        // Speaker portraits are a tiny, stable runtime set.  Keep them local so
        // translated speaker names and a temporarily unavailable CDN cannot
        // turn every log portrait into the anonymous silhouette.
        speakerIcon:  ssvJoinUrl(SSV_LOCAL_ASSET_ROOT, 'images/content/${type}/icon_circle_l/${id}.png'),
        logTextFrame: ssvJoinUrl(SSV_LOCAL_ASSET_ROOT, 'images/event/log_text_frame/${id}.png'),
    };
}

function ssvValidateScenarioKey(eventType, eventId) {
    if (!/^[a-z0-9_-]+$/i.test(String(eventType || ''))) {
        throw new Error(`Invalid eventType: ${eventType}`);
    }
    if (!/^[a-z0-9_-]+$/i.test(String(eventId || ''))) {
        throw new Error(`Invalid eventId: ${eventId}`);
    }
}

async function ssvFetchScenarioJson(url) {
    const response = await fetch(withNoCache(url), { cache: 'no-store', mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error('JSON is not a non-empty track array');
    return data;
}

async function ssvLoadScenarioSource(eventType, eventId, mode) {
    ssvValidateScenarioKey(eventType, eventId);
    const localUrl = ssvJoinUrl(SSV_LOCAL_ASSET_ROOT, `json/${eventType}/${eventId}.json`);
    const remoteUrls = [
        ssvJoinUrl(SSV_REMOTE_ASSET_ROOT, `json/${eventType}/${eventId}.json`),
        `https://service.sc-viewer.top/convert/cache/json/${eventType}/${eventId}.json`,
    ];
    const candidates = [];
    if (mode !== 'remote') {
        candidates.push({ kind: 'local', assetRoot: SSV_LOCAL_ASSET_ROOT, url: localUrl });
    }
    if (mode !== 'local') {
        remoteUrls.forEach(url => candidates.push({ kind: 'remote', assetRoot: SSV_REMOTE_ASSET_ROOT, url }));
    }

    const errors = [];
    for (const candidate of candidates) {
        try {
            const tracks = await ssvFetchScenarioJson(candidate.url);
            return Object.assign(candidate, { tracks, errors });
        } catch (error) {
            errors.push(`${candidate.url}: ${error.message}`);
        }
    }
    throw new Error(`Scenario could not be loaded.\n${errors.join('\n')}`);
}

function ssvAddResource(loader, key, url) {
    if (!loader.resources[key]) loader.add(key, url, { crossOrigin: 'anonymous' });
}

function ssvLoadPixiResources(loader, onProgress) {
    return new Promise((resolve) => {
        let settled = false;
        let progressFallback = null;
        let progressBinding = null;
        const finish = (reason) => {
            if (settled) return;
            settled = true;
            if (progressFallback) clearTimeout(progressFallback);
            if (progressBinding && loader.onProgress && typeof loader.onProgress.detach === 'function') {
                loader.onProgress.detach(progressBinding);
            }
            resolve(reason);
        };
        const handleProgress = (activeLoader, resource) => {
            if (typeof onProgress === 'function') onProgress(activeLoader, resource);
            if ((activeLoader.progress || 0) < 99.999 || progressFallback) return;
            // PIXI Loader 6 can occasionally report 100% while its shared
            // loader never dispatches the final completion callback. The
            // resources have already passed their after-middleware at this
            // point, so give PIXI one animation frame plus a short grace
            // period, then close the loader cycle instead of hanging forever.
            progressFallback = setTimeout(() => {
                if (settled) return;
                console.warn('[remote-main] PIXI loader reached 100% without completing; applying completion fallback');
                try {
                    if (activeLoader.loading && typeof activeLoader._onComplete === 'function') {
                        activeLoader._onComplete();
                    }
                } catch (error) {
                    console.warn('[remote-main] PIXI completion fallback could not close the loader', error);
                }
                finish('progress-100-fallback');
            }, 1200);
        };
        if (loader.onProgress && typeof loader.onProgress.add === 'function') {
            progressBinding = loader.onProgress.add(handleProgress);
        }
        loader.load(() => finish('complete-callback'));
    });
}

function ssvAddStatusToOverlay(overlay, source, translationReport) {
    const parts = [source.kind === 'remote' ? 'Remote assets' : 'Local assets'];
    if (translationReport) {
        parts.push(`中文 ${translationReport.applied}/${translationReport.total}`);
    }
    const status = new PIXI.Text(parts.join('  ·  '), {
        fontFamily: USED_FONT,
        fontSize: 18,
        fill: translationReport && translationReport.applied < translationReport.total ? 0xffc266 : 0xc8bfd8,
        align: 'center',
    });
    status.anchor.set(0.5);
    status.position.set(568, 402);
    overlay.addChild(status);
}

function ssvShowTitlePopup(app, meta, assetRoot) {
    const folder = String(meta.cardId || '').startsWith('2') ? 'support_idols' : 'idols';
    const iconUrl = meta.cardId
        ? ssvJoinUrl(assetRoot, `images/content/${folder}/icon/${meta.cardId}.png`)
        : null;
    const popup = new EventTitlePopup({
        app,
        cardIconUrl: iconUrl,
        eventName: meta.name,
        eventType: meta.catIcon || 'produce',
    });
    app.stage.addChild(popup.stageObj);
    popup.show().then(() => {
        try {
            if (popup.stageObj && popup.stageObj.parent) app.stage.removeChild(popup.stageObj);
        } catch (_) {}
        popup.destroy();
    });
    return popup;
}

async function startScenarioPlayer(eventType, eventId, language) {
    const params = new URLSearchParams(window.location.search);
    const browserVideoExportMode = params.get('mode') === 'export'
        && !!params.get('exportJob')
        && !!globalThis.ScenarioVideoExport;
    const obsExportMode = !!globalThis.ScenarioObsExport
        && ScenarioObsExport.requested();
    const videoExportMode = browserVideoExportMode || obsExportMode;
    const editMode = language === 'cn'
        && params.get('mode') === 'edit'
        && !!globalThis.ScenarioEditMode;
    const editWorkflow = params.get('editWorkflow') === 'correction'
        ? 'correction'
        : 'translation';
    ssvSetBootStatus('正在检查播放器基础资源……');
    try {
        await ssvVerifyPortableRuntime();
    } catch (error) {
        console.error('[remote-main] portable runtime check failed', error);
        ssvSetBootStatus(error.message, true);
        if (obsExportMode) await ScenarioObsExport.fail(error);
        return;
    }
    if (editMode) globalThis.ScenarioEditMode.prepareLayout();
    applyScenarioLanguage(language);
    PIXI.utils.skipHello();
    gsap.registerPlugin(PixiPlugin);
    PixiPlugin.registerPIXI(PIXI);

    const renderOptions = ScenarioRenderQuality.applicationOptions(window);
    ScenarioRenderQuality.configurePixi(PIXI, renderOptions.resolution, renderOptions.textResolution);
    const app = new PIXI.Application(renderOptions);
    app.view.id = 'ShinyColors';
    document.body.appendChild(app.view);
    resizeCanvas(app);
    const resizePlayer = () => {
        if (editMode) globalThis.ScenarioEditMode.prepareLayout();
        resizeCanvas(app);
    };
    window.addEventListener('resize', resizePlayer);
    document.addEventListener('fullscreenchange', () => requestAnimationFrame(resizePlayer));

    let volumeConfig = {};
    try {
        const response = await fetch('./config.json', { cache: 'no-cache' });
        if (response.ok) volumeConfig = await response.json();
    } catch (_) {}

    ssvSetBootStatus('正在载入播放器字体……');
    try {
        await loadScenarioFonts(language);
    } catch (_) {
        console.warn('[remote-main] font load timed out; using browser fallback font');
    }

    const requestedMode = String(params.get('source') || 'auto').toLowerCase();
    const sourceMode = ['local', 'remote'].includes(requestedMode) ? requestedMode : 'auto';
    let source;
    ssvSetBootStatus('正在读取剧情 JSON……');
    try {
        source = await ssvLoadScenarioSource(eventType, eventId, sourceMode);
    } catch (error) {
        console.error('[remote-main] scenario load failed', error);
        if (obsExportMode) await ScenarioObsExport.fail(error);
        else ssvSetBootStatus(`剧情载入失败：\n${error.message}`, true);
        return;
    }

    let preparedTracks = source.tracks;
    let translation = null;
    let translationCsvText = null;
    const applyTranslationCsv = (csvText, url) => {
        translationCsvText = csvText;
        translation = ScenarioCsvTranslation.mergeScenarioTranslation(preparedTracks, csvText);
        preparedTracks = translation.tracks;
        translation.url = url;
        if (editMode) {
            translation.report.bindings.forEach((binding) => {
                const track = preparedTracks[binding.trackIndex];
                if (track && typeof track === 'object') {
                    track.__ssvEditBinding = Object.assign({}, binding);
                }
            });
        }
        if (translation.report.problems.length) {
            console.warn('[remote-main] CSV translation warnings', translation.report.problems);
        }
    };
    if (language === 'cn' && globalThis.ScenarioCsvTranslation) {
        const loaded = await ScenarioCsvTranslation.loadTranslation(eventType, eventId);
        if (loaded.text != null) {
            try {
                applyTranslationCsv(loaded.text, loaded.url);
            } catch (error) {
                console.error('[remote-main] CSV translation failed', error);
                if (obsExportMode) {
                    await ScenarioObsExport.fail(error);
                    return;
                }
                if (editMode) {
                    alert(`编辑模式无法读取当前 CSV：${error.message}`);
                    return;
                }
            }
        }
        if (editMode && translationCsvText == null) {
            try {
                const content = ScenarioCsvTranslation.createEditableScenarioCsv(source.tracks, {
                    eventType,
                    eventId,
                    translator: ssvTranslatorName(),
                });
                const response = await fetch('./api/save-translation', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ eventType, eventId, content, translator: ssvTranslatorName() }),
                });
                const body = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
                applyTranslationCsv(content, `./translations/${eventType}/${eventId}.csv`);
            } catch (error) {
                alert(`编辑模式无法建立空白 CSV：${error.message}`);
                return;
            }
        }
    }
    if (editMode && translationCsvText == null) {
        alert('编辑模式初始化失败：当前播放器没有加载 CSV 编辑组件。');
        return;
    }
    if (obsExportMode && translationCsvText == null) {
        await ScenarioObsExport.fail(new Error('OBS 直出没有读取到当前剧情的翻译 CSV。'));
        return;
    }
    const rawTracks = applyTrackLanguage(preparedTracks, language);

    const supportStills = globalThis.SupportStillFallback
        ? SupportStillFallback.collect(rawTracks)
        : [];
    const localSupportStillIds = globalThis.SupportStillFallback
        ? await SupportStillFallback.findAvailableLocalIds(supportStills, SSV_LOCAL_ASSET_ROOT)
        : new Set();
    const cardMovies = globalThis.SupportStillFallback
        ? SupportStillFallback.collectMovies(rawTracks)
        : [];
    const localCardMovieIds = globalThis.SupportStillFallback
        ? await SupportStillFallback.findAvailableLocalMovieIds(cardMovies, SSV_LOCAL_ASSET_ROOT)
        : new Set();

    const converter = new AdvResourceConverter({
        assetFormat: ssvAssetFormats(source.assetRoot),
        characterAssetFormat: ssvCharacterAssetFormats(source.assetRoot),
    });
    const tracks = converter.convertResourcePaths(rawTracks);
    if (globalThis.SupportStillFallback) {
        SupportStillFallback.rewriteConvertedTracks(tracks, localSupportStillIds, SSV_LOCAL_ASSET_ROOT);
        SupportStillFallback.rewriteConvertedMovies(tracks, localCardMovieIds, SSV_LOCAL_ASSET_ROOT);
    }
    const urls = converter.extractResourceList(tracks);
    const loader = PIXI.Loader.shared;

    const runtimeRoot = SSV_LOCAL_ASSET_ROOT;
    ssvAddResource(loader, 'uiParts', ssvJoinUrl(runtimeRoot, 'images/ui/produce_event/parts_event.json'));
    ssvAddResource(loader, 'uiCommonParts', ssvJoinUrl(runtimeRoot, 'images/ui/start_and_common/parts.json'));
    ssvAddResource(loader, 'uiCommonAtlas', ssvJoinUrl(runtimeRoot, 'images/ui/common/parts.json'));
    ssvAddResource(loader, 'uiInitPop', ssvJoinUrl(runtimeRoot, 'images/ui/init/parts_pop.json'));
    ssvAddResource(loader, UI_TAP_SE_KEY, ssvJoinUrl(runtimeRoot, 'sounds/se/003.m4a'));
    ssvAddResource(loader, UI_CANCEL_SE_KEY, ssvJoinUrl(runtimeRoot, 'sounds/se/004.m4a'));
    ssvAddResource(loader, SELECT_ANSWER_SE_KEY, ssvJoinUrl(runtimeRoot, 'sounds/se/227.m4a'));
    ssvAddResource(loader, TAP_EFFECT_PARTICLES_KEY, ssvJoinUrl(runtimeRoot, 'particles/common/tap_effect/images.json'));
    ssvAddResource(loader, TAP_EFFECT_PARTICLE_CONFIG_KEY, ssvJoinUrl(runtimeRoot, 'particles/common/tap_effect/particle.json'));
    ssvAddResource(loader, TAP_EFFECT_FEATHER_CONFIG_KEY, ssvJoinUrl(runtimeRoot, 'particles/common/tap_effect/feather.json'));
    ssvAddResource(loader, PRODUCER_BUBBLE_KEY, ssvJoinUrl(runtimeRoot, 'sounds/se/002.m4a'));

    let maxSelects = 0;
    let currentSelects = 0;
    tracks.forEach((track) => {
        if (track.select) {
            currentSelects += Array.isArray(track.select) ? track.select.length : 1;
            maxSelects = Math.max(maxSelects, currentSelects);
        } else {
            currentSelects = 0;
        }
    });
    for (let i = 1; i <= Math.min(maxSelects, 5); i++) {
        const selectFrameRoot = i <= 3 ? runtimeRoot : source.assetRoot;
        ssvAddResource(loader, `selectFrame${i}`, ssvJoinUrl(selectFrameRoot, `images/event/select_frame/${String(i).padStart(3, '0')}.png`));
    }
    urls.forEach(url => ssvAddResource(loader, url, url));

    const failedResources = [];
    const onResourceError = (error, _, resource) => {
        failedResources.push(resource && resource.url ? resource.url : String(error));
    };
    const onResourceProgress = (activeLoader) => {
        ssvSetBootStatus(`正在加载剧情资源…… ${Math.round(activeLoader.progress || 0)}%`);
    };
    if (loader.onError && typeof loader.onError.add === 'function') loader.onError.add(onResourceError);
    ssvSetBootStatus('正在加载剧情资源…… 0%');
    const loaderCompletion = await ssvLoadPixiResources(loader, onResourceProgress);
    if (loader.onError && typeof loader.onError.detach === 'function') loader.onError.detach(onResourceError);
    if (loaderCompletion !== 'complete-callback') {
        console.warn(`[remote-main] resource loader continued via ${loaderCompletion}`);
    }
    if (failedResources.length) {
        console.warn(`[remote-main] ${failedResources.length} resources failed to preload`, failedResources);
    }

    const meta = getScenarioMeta(eventType, eventId);
    // The title-card icon is decorative and PIXI.Sprite.from() can acquire it
    // lazily when the title popup is shown. Waiting for it here used to leave
    // the whole player behind a 100% loading screen when an upstream card icon
    // was not published yet or the CDN connection stalled.
    ssvSetBootStatus('正在创建播放器界面……');

    const translationReport = translation && translation.report;
    window.__scenarioLoadInfo = {
        eventType,
        eventId,
        source: source.kind,
        scenarioUrl: source.url,
        assetRoot: source.assetRoot,
        translationUrl: translation && translation.url,
        translationReport,
        failedResources,
        editMode,
        videoExportMode,
    };

    let overlay;
    try {
        overlay = buildTouchOverlay(app);
        ssvAddStatusToOverlay(overlay, source, translationReport);
        app.stage.addChild(overlay);
        ssvClearBootStatus();
    } catch (error) {
        console.error('[remote-main] player UI initialization failed', error);
        ssvSetBootStatus(`播放器界面初始化失败：\n${error.message}\n\n请把此信息截图发给开发者。`, true);
        if (obsExportMode) await ScenarioObsExport.fail(error);
        return;
    }

    let started = false;
    let preparedAdvPlayer = null;
    const videoExporter = videoExportMode
        && browserVideoExportMode
        ? ScenarioVideoExport.create({
            jobId: params.get('exportJob'),
            eventType,
            eventId,
            canvas: app.view,
        })
        : null;
    const startGame = async () => {
        if (started) return true;
        overlay.visible = false;
        let advPlayer = preparedAdvPlayer;
        const restoreStartOverlay = () => {
            overlay.visible = true;
            if (overlay.parent) {
                app.stage.setChildIndex(overlay, app.stage.children.length - 1);
            }
            try { app.renderer.render(app.stage); } catch (_) {}
        };
        if (videoExportMode) {
            try {
                // Build the real scene graph before capture starts. This primes
                // text atlases, controller sprites and layer render targets
                // without advancing a scenario track or starting any audio.
                if (!advPlayer) {
                    advPlayer = new AdvPlayer(app, volumeConfig);
                    preparedAdvPlayer = advPlayer;
                    app.stage.addChild(advPlayer.stageObj);
                }
                app.ticker.stop();
                if (browserVideoExportMode) {
                    ScenarioVideoExport.notify('warming', {
                        message: '正在预载入播放器图层、纹理与字体，预热画面不会写入成片',
                    });
                }
                const warmup = await ScenarioVideoExport.warmupRenderer(app, loader);
                if (browserVideoExportMode) {
                    ScenarioVideoExport.notify('warming', {
                        message: '播放器与资源预热完成，准备开始录制',
                        textures: warmup && warmup.textures || 0,
                    });
                    const captureStarted = await videoExporter.start();
                    if (!captureStarted) {
                        restoreStartOverlay();
                        return false;
                    }
                } else {
                    await ScenarioObsExport.ready();
                }
            } catch (error) {
                restoreStartOverlay();
                if (browserVideoExportMode) await videoExporter.abort(error);
                else await ScenarioObsExport.fail(error);
                return false;
            }
        }
        started = true;
        if (overlay.parent) app.stage.removeChild(overlay);
        overlay.destroy({ children: true });

        let popup = null;
        if (!videoExportMode && meta && meta.name) popup = ssvShowTitlePopup(app, meta, source.assetRoot);
        if (!advPlayer) {
            advPlayer = new AdvPlayer(app, volumeConfig);
            app.stage.addChild(advPlayer.stageObj);
        }
        if (popup && popup.stageObj && popup.stageObj.parent) {
            app.stage.setChildIndex(popup.stageObj, app.stage.children.length - 1);
        }
        if (!videoExportMode) new DebugController(advPlayer, app);
        if (videoExportMode) {
            advPlayer.once('appearSelectList', () => {
                advPlayer.pause();
                const error = new Error('当前剧情含有选择支；第一版直出暂不自动替用户选择。');
                if (browserVideoExportMode) videoExporter.abort(error);
                else ScenarioObsExport.fail(error);
            });
            advPlayer.once('end', async () => {
                try {
                    if (advPlayer.soundController && advPlayer.soundController.fadeOutAll) {
                        advPlayer.soundController.fadeOutAll(1200);
                    }
                    if (browserVideoExportMode) await videoExporter.finish(1300);
                    else await ScenarioObsExport.finish(1300);
                } catch (error) {
                    if (browserVideoExportMode) await videoExporter.abort(error);
                    else await ScenarioObsExport.fail(error);
                }
            });
        } else {
            const handleScenarioEnd = () => {
                if (globalThis.ScenarioEndRelated
                    && ScenarioEndRelated.tryAutoReturnChoice
                    && ScenarioEndRelated.tryAutoReturnChoice(advPlayer)) return;
                showEndOverlay(app, advPlayer);
            };
            const handleChoiceReturnLeadIn = () => {
                if (globalThis.ScenarioEndRelated
                    && ScenarioEndRelated.tryAutoReturnChoice) {
                    ScenarioEndRelated.tryAutoReturnChoice(advPlayer);
                }
            };
            // Ordinary playback may play the green-screen return transition,
            // while correction mode can return directly. Both are reusable.
            // Edit mode ignores this early hint and reaches the authored End.
            advPlayer.on('choiceReturnLeadIn', handleChoiceReturnLeadIn);
            advPlayer.on('end', handleScenarioEnd);
        }
        let fatalReported = false;
        const updatePlayer = delta => {
            advPlayer.update(delta);
            if (videoExportMode && advPlayer._fatalError && !fatalReported) {
                fatalReported = true;
                if (browserVideoExportMode) videoExporter.abort(advPlayer._fatalError);
                else ScenarioObsExport.fail(advPlayer._fatalError);
            }
        };
        if (videoExportMode) {
            // PIXI's normal ticker is requestAnimationFrame-based and Chromium
            // can deprioritize it for hidden tabs or background OBS browser
            // sources. Both exporters use a WebAudio/Worker clock instead.
            app.ticker.stop();
            if (globalThis.gsap && gsap.ticker && typeof gsap.ticker.lagSmoothing === 'function') {
                gsap.ticker.lagSmoothing(0);
            }
            if (globalThis.gsap && gsap.ticker && typeof gsap.ticker.sleep === 'function') {
                // The export frame driver calls ticker.tick() explicitly.
                // Leaving GSAP's requestAnimationFrame loop running would drive
                // the same animations twice whenever the tab is visible.
                gsap.ticker.sleep();
            }
        } else {
            app.ticker.add(updatePlayer);
        }
        if (editMode) {
            window.__scenarioEditMode = new globalThis.ScenarioEditMode({
                eventType,
                eventId,
                csvText: translationCsvText,
                exportWorkflow: editWorkflow,
                advPlayer,
            });
        }
        if (browserVideoExportMode) {
            try {
                await videoExporter.startFrameDriver(({ deltaTicks }) => {
                    updatePlayer(deltaTicks);
                    if (globalThis.gsap && gsap.ticker && typeof gsap.ticker.tick === 'function') {
                        if (typeof gsap.ticker.sleep === 'function') gsap.ticker.sleep();
                        gsap.ticker.tick();
                    }
                    app.renderer.render(app.stage);
                });
                await videoExporter.waitForPreroll(1000);
                videoExporter.markScenarioStart();
            } catch (error) {
                await videoExporter.abort(error);
                return false;
            }
        } else if (obsExportMode) {
            try {
                await ScenarioObsExport.startFrameDriver(({ deltaTicks }) => {
                    updatePlayer(deltaTicks);
                    if (globalThis.gsap && gsap.ticker && typeof gsap.ticker.tick === 'function') {
                        if (typeof gsap.ticker.sleep === 'function') gsap.ticker.sleep();
                        gsap.ticker.tick();
                    }
                    app.renderer.render(app.stage);
                });
                // OBS and NVENC receive a stable still for a short period before
                // the first dialogue/audio node begins. This pre-roll remains in
                // the finished video and avoids a cold first frame.
                await ScenarioObsExport.waitForPreroll(800);
            } catch (error) {
                await ScenarioObsExport.fail(error);
                return false;
            }
        }
        advPlayer.start(tracks);
        if (videoExportMode) advPlayer.setAutoEnabled(true);
        window.__advPlayer = advPlayer;
        return true;
    };
    overlay.once('pointertap', startGame);
    if (videoExportMode) {
        if (browserVideoExportMode) {
            window.__startScenarioExportFromWorkshop = startGame;
            ScenarioVideoExport.notify('ready', {
                eventType,
                eventId,
                failedResources: failedResources.length,
            });
        }
        setTimeout(() => startGame(), 0);
    }
}
