'use strict';

(function exposeEditModeResourceFallback(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.EditModeResourceFallback = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildEditModeResourceFallback() {
    const OPTIONAL_FIELDS = ['charStill', 'movie'];
    const REMOTE_CARD_VISUAL_PATTERNS = [
        /\/images\/content\/(?:idols|support_idols)\/card\/[^/?#]+\.(?:jpe?g|png|webp)(?:[?#].*)?$/i,
        /\/movies\/idols\/card\/[^/?#]+\.mp4(?:[?#].*)?$/i,
    ];

    function isRemoteCardVisual(url) {
        const value = String(url || '');
        return /^https?:\/\//i.test(value)
            && REMOTE_CARD_VISUAL_PATTERNS.some(pattern => pattern.test(value));
    }

    function resolvedSource(resourceSources, url) {
        return resourceSources instanceof Map && resourceSources.has(url)
            ? resourceSources.get(url)
            : url;
    }

    function apply(tracks, resourceSources, options = {}) {
        if (!options.enabled) return { tracks, skipped: [] };
        const skipped = [];
        (Array.isArray(tracks) ? tracks : []).forEach((track, trackIndex) => {
            if (!track || typeof track !== 'object') return;
            OPTIONAL_FIELDS.forEach((field) => {
                const url = track[field];
                if (!isRemoteCardVisual(url)) return;
                // ssvResolveResourceSources maps a fully cached resource to its
                // local URL. Keep those visuals; only omit remote-only card media
                // that can be unpublished before the card reaches the page game.
                if (resolvedSource(resourceSources, url) !== url) return;
                delete track[field];
                skipped.push({ trackIndex, field, url });
            });
        });
        return { tracks, skipped };
    }

    return {
        OPTIONAL_FIELDS,
        isRemoteCardVisual,
        apply,
    };
});
