'use strict';

(function exposeSupportStillFallback(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.SupportStillFallback = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildSupportStillFallback() {
    const SUPPORT_TYPE = 'support_idols';
    const CARD_PATH_PATTERN = /(?:^|\/)images\/content\/support_idols\/card\/([A-Za-z0-9_-]+)\.(?:jpe?g|png|webp)(?:[?#].*)?$/i;
    const MOVIE_PATH_PATTERN = /(?:^|\/)movies\/idols\/card\/([0-9]+)\.mp4(?:[?#].*)?$/i;

    function trimRoot(value) {
        return String(value || './assets').replace(/\/+$/, '');
    }

    function isSafeStillId(value) {
        return /^[A-Za-z0-9_-]+$/.test(String(value || ''));
    }

    function buildPath(stillId) {
        if (!isSafeStillId(stillId)) throw new Error(`Invalid support still ID: ${stillId}`);
        return `images/content/${SUPPORT_TYPE}/card/${stillId}.jpg`;
    }

    function buildUrl(stillId, assetRoot = './assets') {
        return `${trimRoot(assetRoot)}/${buildPath(stillId)}`;
    }

    function buildMoviePath(movieId) {
        if (!/^\d+$/.test(String(movieId || ''))) throw new Error(`Invalid card movie ID: ${movieId}`);
        return `movies/idols/card/${movieId}.mp4`;
    }

    function buildMovieUrl(movieId, assetRoot = './assets') {
        return `${trimRoot(assetRoot)}/${buildMoviePath(movieId)}`;
    }

    function collect(tracks) {
        const found = new Map();
        (Array.isArray(tracks) ? tracks : []).forEach((track) => {
            if (!track || track.stillType !== SUPPORT_TYPE || !isSafeStillId(track.stillId)) return;
            const stillId = String(track.stillId);
            if (!found.has(stillId)) found.set(stillId, { stillId, path: buildPath(stillId) });
        });
        return Array.from(found.values());
    }

    function extractStillId(url) {
        const match = String(url || '').match(CARD_PATH_PATTERN);
        return match ? match[1] : null;
    }

    function collectMovies(tracks) {
        const found = new Map();
        (Array.isArray(tracks) ? tracks : []).forEach((track) => {
            if (!track || !/^\d+$/.test(String(track.movie || ''))) return;
            const movieId = String(track.movie);
            if (!found.has(movieId)) found.set(movieId, { movieId, path: buildMoviePath(movieId) });
        });
        return Array.from(found.values());
    }

    function extractMovieId(url) {
        const match = String(url || '').match(MOVIE_PATH_PATTERN);
        return match ? match[1] : null;
    }

    function rewriteConvertedTracks(tracks, localStillIds, localAssetRoot = './assets') {
        const available = localStillIds instanceof Set ? localStillIds : new Set(localStillIds || []);
        (Array.isArray(tracks) ? tracks : []).forEach((track) => {
            if (!track || !track.charStill) return;
            const stillId = extractStillId(track.charStill);
            if (stillId && available.has(stillId)) track.charStill = buildUrl(stillId, localAssetRoot);
        });
        return tracks;
    }

    function rewriteConvertedMovies(tracks, localMovieIds, localAssetRoot = './assets') {
        const available = localMovieIds instanceof Set ? localMovieIds : new Set(localMovieIds || []);
        (Array.isArray(tracks) ? tracks : []).forEach((track) => {
            if (!track || !track.movie) return;
            const movieId = extractMovieId(track.movie);
            if (movieId && available.has(movieId)) track.movie = buildMovieUrl(movieId, localAssetRoot);
        });
        return tracks;
    }

    async function resourceExists(url, fetcher) {
        const request = fetcher || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
        if (!request) throw new Error('fetch is unavailable');
        try {
            const response = await request(url, { method: 'HEAD', cache: 'no-store' });
            return !!response.ok;
        } catch (_) {
            return false;
        }
    }

    async function findAvailableLocalIds(items, localAssetRoot = './assets', fetcher) {
        const pairs = await Promise.all((items || []).map(async (item) => [
            item.stillId,
            await resourceExists(buildUrl(item.stillId, localAssetRoot), fetcher),
        ]));
        return new Set(pairs.filter(([, exists]) => exists).map(([stillId]) => stillId));
    }

    async function findAvailableLocalMovieIds(items, localAssetRoot = './assets', fetcher) {
        const pairs = await Promise.all((items || []).map(async (item) => [
            item.movieId,
            await resourceExists(buildMovieUrl(item.movieId, localAssetRoot), fetcher),
        ]));
        return new Set(pairs.filter(([, exists]) => exists).map(([movieId]) => movieId));
    }

    return {
        SUPPORT_TYPE,
        buildPath,
        buildUrl,
        buildMoviePath,
        buildMovieUrl,
        collect,
        collectMovies,
        extractStillId,
        extractMovieId,
        rewriteConvertedTracks,
        rewriteConvertedMovies,
        resourceExists,
        findAvailableLocalIds,
        findAvailableLocalMovieIds,
    };
});
