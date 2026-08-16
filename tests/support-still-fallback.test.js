'use strict';

const assert = require('node:assert/strict');
const fallback = require('../scripts/SupportStillFallback.js');

const raw = [
    { stillType: 'support_idols', stillId: '2040040190' },
    { stillType: 'support_idols', stillId: '2040040190' },
    { stillType: 'idols', stillId: '1040270060' },
    { movie: '1040270060' },
];

assert.deepEqual(fallback.collect(raw), [{
    stillId: '2040040190',
    path: 'images/content/support_idols/card/2040040190.jpg',
}]);
assert.deepEqual(fallback.collectMovies(raw), [{
    movieId: '1040270060',
    path: 'movies/idols/card/1040270060.mp4',
}]);

const converted = [
    { charStill: 'https://service.sc-viewer.top/custom/images/content/support_idols/card/2040040190.jpg' },
    { charStill: 'https://service.sc-viewer.top/custom/images/content/idols/card/1040270060.jpg' },
];

fallback.rewriteConvertedTracks(converted, new Set(['2040040190']), './assets');
assert.equal(converted[0].charStill, './assets/images/content/support_idols/card/2040040190.jpg');
assert.equal(converted[1].charStill, 'https://service.sc-viewer.top/custom/images/content/idols/card/1040270060.jpg');

const convertedMovie = [{ movie: 'https://service.sc-viewer.top/custom/movies/idols/card/1040270060.mp4' }];
fallback.rewriteConvertedMovies(convertedMovie, new Set(['1040270060']), './assets');
assert.equal(convertedMovie[0].movie, './assets/movies/idols/card/1040270060.mp4');

fallback.findAvailableLocalIds(fallback.collect(raw), './assets', async (url, options) => {
    assert.equal(options.method, 'HEAD');
    return { ok: url.endsWith('/2040040190.jpg') };
}).then((available) => {
    assert.deepEqual(Array.from(available), ['2040040190']);
    return fallback.findAvailableLocalMovieIds(fallback.collectMovies(raw), './assets', async (url, options) => {
        assert.equal(options.method, 'HEAD');
        return { ok: url.endsWith('/1040270060.mp4') };
    });
}).then((availableMovies) => {
    assert.deepEqual(Array.from(availableMovies), ['1040270060']);
    console.log('support-still-fallback: PASS');
}).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
