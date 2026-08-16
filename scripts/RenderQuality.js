'use strict';

(function exposeScenarioRenderQuality(root) {
    const LOGICAL_WIDTH = 1136;
    const LOGICAL_HEIGHT = 640;
    const MAX_RESOLUTION = 2.5;
    const BALANCED_MAX_RESOLUTION = 1.5;
    const RESOLUTION_STEP = 0.25;

    function positiveNumber(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : fallback;
    }

    function calculateResolution(options = {}) {
        const viewportWidth = positiveNumber(options.viewportWidth, LOGICAL_WIDTH);
        const viewportHeight = positiveNumber(options.viewportHeight, LOGICAL_HEIGHT);
        const devicePixelRatio = positiveNumber(options.devicePixelRatio, 1);
        const maxResolution = positiveNumber(options.maxResolution, MAX_RESOLUTION);
        const displayScale = Math.min(
            viewportWidth / LOGICAL_WIDTH,
            viewportHeight / LOGICAL_HEIGHT,
        );
        const physicalScale = Math.max(1, displayScale * devicePixelRatio);
        const stepped = Math.ceil(physicalScale / RESOLUTION_STEP) * RESOLUTION_STEP;
        return Math.min(maxResolution, stepped);
    }

    // Raster scene assets are authored for the 1136x640 logical canvas. Text
    // can be regenerated at arbitrary DPI, so matching it to the CSS scene
    // scale (rather than the extra device-pixel multiplier) keeps the two from
    // looking as if they came from different-quality sources.
    function calculateTextResolution(options = {}) {
        const viewportWidth = positiveNumber(options.viewportWidth, LOGICAL_WIDTH);
        const viewportHeight = positiveNumber(options.viewportHeight, LOGICAL_HEIGHT);
        const maxResolution = positiveNumber(options.maxResolution, MAX_RESOLUTION);
        const displayScale = Math.max(1, Math.min(
            viewportWidth / LOGICAL_WIDTH,
            viewportHeight / LOGICAL_HEIGHT,
        ));
        const stepped = Math.ceil(displayScale / RESOLUTION_STEP) * RESOLUTION_STEP;
        return Math.min(maxResolution, stepped);
    }

    function viewportMetrics(view = root) {
        const documentElement = view.document && view.document.documentElement;
        const fullWidth = positiveNumber(documentElement && documentElement.clientWidth, LOGICAL_WIDTH);
        const reservedWidth = Math.max(0, Math.min(
            fullWidth,
            Number(view.__scenarioReservedWidth || 0),
        ));
        return {
            viewportWidth: Math.max(1, fullWidth - reservedWidth),
            viewportHeight: positiveNumber(documentElement && documentElement.clientHeight, LOGICAL_HEIGHT),
            devicePixelRatio: positiveNumber(view.devicePixelRatio, 1),
            fullWidth,
            reservedWidth,
        };
    }

    function preferredMaxResolution(view = root) {
        let requested = '';
        try {
            requested = new URLSearchParams(view.location && view.location.search || '').get('quality') || '';
        } catch (_) {}
        if (requested === 'high') return MAX_RESOLUTION;
        if (requested === 'performance') return 1;
        // The previous automatic DPI calculation could render 6.25 times as
        // many pixels as the original 1136x640 canvas. Screen recorders also
        // need GPU copy/composition time, so normal playback now defaults to a
        // balanced cap while retaining sharper-than-original raster/text.
        return BALANCED_MAX_RESOLUTION;
    }

    function applicationOptions(view = root) {
        const metrics = viewportMetrics(view);
        const maxResolution = preferredMaxResolution(view);
        const resolution = calculateResolution(Object.assign({}, metrics, { maxResolution }));
        return {
            width: LOGICAL_WIDTH,
            height: LOGICAL_HEIGHT,
            backgroundColor: 0x000000,
            antialias: true,
            autoDensity: true,
            resolution,
            textResolution: calculateTextResolution(Object.assign({}, metrics, { maxResolution })),
            powerPreference: 'high-performance',
        };
    }

    function configurePixi(PIXI, resolution, textResolution = resolution) {
        if (!PIXI || !PIXI.settings) return;
        if (PIXI.SCALE_MODES) PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.LINEAR;
        PIXI.settings.ROUND_PIXELS = false;
        PIXI.settings.RESOLUTION = positiveNumber(textResolution, resolution);
        if ('FILTER_RESOLUTION' in PIXI.settings) {
            PIXI.settings.FILTER_RESOLUTION = positiveNumber(resolution, 1);
        }
    }

    function synchronizeRuntimeResolution(app, resolution, textResolution, view = root) {
        const interaction = app && app.renderer && app.renderer.plugins
            && app.renderer.plugins.interaction;
        if (interaction) interaction.resolution = resolution;

        const PIXI = view.PIXI || root.PIXI;
        if (!app || !app.stage || !PIXI || !PIXI.Text) return;
        const visit = (displayObject) => {
            if (displayObject instanceof PIXI.Text
                && Math.abs(Number(displayObject.resolution || 1) - textResolution) > 0.01) {
                displayObject.resolution = textResolution;
            }
            if (displayObject && Array.isArray(displayObject.children)) {
                displayObject.children.forEach(visit);
            }
        };
        visit(app.stage);
    }

    function resizeApplication(app, view = root) {
        if (!app || !app.view) return null;
        const metrics = viewportMetrics(view);
        const displayScale = Math.min(
            metrics.viewportWidth / LOGICAL_WIDTH,
            metrics.viewportHeight / LOGICAL_HEIGHT,
        );
        const maxResolution = preferredMaxResolution(view);
        const resolution = calculateResolution(Object.assign({}, metrics, { maxResolution }));
        const textResolution = calculateTextResolution(Object.assign({}, metrics, { maxResolution }));
        if (app.renderer && Math.abs(Number(app.renderer.resolution || 1) - resolution) > 0.01) {
            app.renderer.resolution = resolution;
            configurePixi(root.PIXI, resolution, textResolution);
            app.renderer.resize(LOGICAL_WIDTH, LOGICAL_HEIGHT);
        }
        synchronizeRuntimeResolution(app, resolution, textResolution, view);
        app.view.style.width = `${LOGICAL_WIDTH * displayScale}px`;
        app.view.style.height = `${LOGICAL_HEIGHT * displayScale}px`;
        app.view.style.left = `${metrics.viewportWidth / 2}px`;
        return {
            resolution,
            textResolution,
            displayScale,
            cssWidth: LOGICAL_WIDTH * displayScale,
            cssHeight: LOGICAL_HEIGHT * displayScale,
            backingWidth: Math.round(LOGICAL_WIDTH * resolution),
            backingHeight: Math.round(LOGICAL_HEIGHT * resolution),
        };
    }

    const api = {
        LOGICAL_WIDTH,
        LOGICAL_HEIGHT,
        MAX_RESOLUTION,
        BALANCED_MAX_RESOLUTION,
        calculateResolution,
        calculateTextResolution,
        preferredMaxResolution,
        viewportMetrics,
        applicationOptions,
        configurePixi,
        synchronizeRuntimeResolution,
        resizeApplication,
    };
    root.ScenarioRenderQuality = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : window));
