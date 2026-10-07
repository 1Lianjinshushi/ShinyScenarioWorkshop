const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const userscriptPath = path.join(__dirname, '..', 'scripts', 'ShinyScenarioUpdateMonitor.user.js');
const userscript = fs.readFileSync(userscriptPath, 'utf8');
const requests = [];
const values = new Map();
const menus = new Map();
let pendingOfficialMovie = false;
const fakeMovie = new Uint8Array(1024);
fakeMovie.set(Buffer.from('ftyp'), 4);

const sandbox = {
    console,
    officialActionCalls: 0,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    location: { href: 'https://shinycolors.enza.fun/', protocol: 'https:' },
    primEnv: { ASSET_ROOT: 'https://assets.example.test/', ENABLE_CRYPTO: true },
    async fetch(url) {
        requests.push({ url, body: null, officialFetch: true });
        return {
            ok: true, status: 200,
            headers: { get: name => name.toLowerCase() === 'content-type' ? 'video/mp4' : '' },
            arrayBuffer: async () => fakeMovie.buffer,
        };
    },
    GM_xmlhttpRequest(options) {
        const body = typeof options.data === 'string' ? JSON.parse(options.data) : options.data || null;
        requests.push({ url: options.url, body });
        const responseText = options.url.includes('/api/import-official-card-resource')
            ? JSON.stringify({ saved: 'assets/movies/idols/card/1040270990.mp4', bytes: 1024 })
            : options.url.includes('/api/official-card-resource-requests')
                ? JSON.stringify({ items: pendingOfficialMovie ? [{
                    kind: 'produce-movie', cardId: '1040270990',
                    path: 'movies/idols/card/1040270990.mp4',
                }] : [] })
                : options.url.includes('/api/game-update-observation')
                    ? JSON.stringify({ items: [{
                        eventType: 'produce_events', eventId: '200602001',
                        characterId: '006', cardType: 'Produce', cardId: '1040060140',
                        cardName: '', storyTitle: '',
                    }] })
                    : JSON.stringify({ items: [] });
        setTimeout(() => options.onload && options.onload({ status: 200, responseText }), 0);
    },
    GM_getValue(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
    GM_setValue(key, value) { values.set(key, value); },
    GM_notification() {},
    GM_registerMenuCommand(label, callback) { menus.set(label, callback); },
};
const context = vm.createContext(sandbox);
vm.runInContext(`
window = this; unsafeWindow = this; window.open = function () {};
nativeArrayPush = Array.prototype.push;
nativeFunctionCall = Function.prototype.call;
`, context);
vm.runInContext(userscript, context, { filename: userscriptPath });

// A different Webpack application is loaded first. The listener must not stop
// looking after capturing this loader because it has no game asset manager.
vm.runInContext(`
var unrelatedModules={1:function(e,t,n){t.ready=true}};
var unrelatedCache={};
function unrelatedRequire(e){var t=unrelatedCache[e];if(void 0!==t)return t.exports;var n=unrelatedCache[e]={id:e,loaded:!1,exports:{}};return unrelatedModules[e].call(n.exports,n,n.exports,unrelatedRequire),n.loaded=!0,n.exports}
unrelatedRequire.m=unrelatedModules;
unrelatedRequire(1);
`, context);

// Deliberately do not expose r.m: this reproduces the browser case where the
// loader is captured but its module registry is not available to the userscript.
vm.runInContext(`
var c={};
var assetUrls=[
  'json/produce_events/300502501.json','json/special_communications/101.json',
  'json/produce_events/200602001.json',
  'images/content/support_idols/card/2040050120.jpg',
  'images/content/idols/card/1040060140.jpg'
];
var m={
  1:function(e,t,n){n(7654);n(7655);n(7656);n(85674);n(9876)},
  85674:function(e,t,n){
    'invalid path'; 'encryptPath'; 'ENABLE_CRYPTO';
    t.A=function(url){return url.replace('https://assets.example.test/', 'https://assets.example.test/encrypted/')};
  },
  9876:function(e,t,n){
    'asset-map.json';
    var f={
      fetchHashMap:async function(){},
      getUrls:function(){return assetUrls},
      getLatestVersion:function(){return 'listener-test'}
    };
    t.A=f;
  },
  7654:function(e,t,n){
    'characterAlbums/characters/';
    t.A={
      getCharacterAlbum:async function(id){
        officialActionCalls++;
        return {characterAlbum:{
          produceIdols:[{id:'1040060140',name:'【未持有也可补全】白瀬咲耶'}],supportIdols:[]
        }};
      }
    };
  },
  7655:function(e,t,n){
    'userIdols/statusMax';
    t.A={
      get:async function(id){
        officialActionCalls++;
        return {idol:{
          id:id,name:'【未持有也可补全】白瀬咲耶',rarity:4,character:{id:'006'},
          produceIdolEvents:[{id:'200602001',title:'后台官方标题'}],produceAfterEvents:[]
        }};
      }
    };
  },
  7656:function(e,t,n){
    'userSupportIdols/statusMax';
    t.A={
      get:async function(id){officialActionCalls++;return {supportIdol:{id:id}};}
    };
  }
};
function r(e){var t=c[e];if(void 0!==t)return t.exports;var n=c[e]={id:e,loaded:!1,exports:{}};return m[e].call(n.exports,n,n.exports,r),n.loaded=!0,n.exports}
r(1);
var originalApiResolve=function(value){return value};
var apiCandidate={method:'POST',path:'/api/session/update',resolve:originalApiResolve};
[].push(apiCandidate);
var apiResolveIdentityPreserved=apiCandidate.resolve===originalApiResolve;
var apiResolveResult=apiCandidate.resolve({body:{session:'unchanged'}});
var arrayPushIdentityPreserved=Array.prototype.push===nativeArrayPush;
var functionCallRestored=Function.prototype.call===nativeFunctionCall;
`, context);

setTimeout(() => {
    assert.strictEqual(
        requests.some(item => item.url.includes('/api/import-official-card-resource')),
        false,
        'baseline monitoring must not download card media',
    );
    pendingOfficialMovie = true;
    vm.runInContext("assetUrls.push('movies/idols/card/1040270990.mp4')", context);
    menus.get('立即检查剧情与页游实装状态')();
}, 80);

setTimeout(() => {
    const statuses = requests
        .filter(item => item.url.endsWith('/api/game-update-status'))
        .map(item => item.body);
    const observations = requests.filter(item => item.url.endsWith('/api/game-update-observation'));
    const observation = observations[0];
    assert(statuses.filter(item => item.stage === 'webpack-captured').length >= 2);
    assert(statuses.some(item => item.stage === 'asset-map-found'
        && item.details.discovery === 'factory-signature'
        && item.details.moduleId === '9876'));
    assert(observation, 'listener should send an observation after finding the manager');
    assert(observations.length >= 2);
    assert.strictEqual(observation.body.assetVersion, 'listener-test');
    assert.strictEqual(observation.body.entries.length, 3);
    const support = observation.body.entries.find(item => item.eventId === '300502501');
    assert.strictEqual(support.scenarioStatus, 'available');
    assert(['pending', 'available'].includes(support.metadataStatus));
    assert(['pending', 'available'].includes(support.staticCardStatus));
    assert.strictEqual(observation.body.resources.length, 2);
    const initialSupportResource = observation.body.resources.find(item => item.cardId === '2040050120');
    assert.strictEqual(initialSupportResource.staticCardStatus, 'available');
    const officialUpload = requests.find(item => item.url.includes('/api/import-official-card-resource')
        && item.url.includes('kind=produce-movie') && item.url.includes('id=1040270990'));
    assert(officialUpload, 'a queued playback request should download the official movie');
    assert.strictEqual(officialUpload.body.byteLength, 1024);
    assert(requests.some(item => item.officialFetch
        && item.url.includes('/encrypted/movies/idols/card/1040270990.mp4')));
    const latestObservation = observations[observations.length - 1];
    assert.strictEqual(vm.runInContext('officialActionCalls', context), 0,
        'startup monitoring must not call authenticated page-game card APIs');
    assert.strictEqual(vm.runInContext('arrayPushIdentityPreserved', context), true,
        'the listener must never replace the page Array.prototype.push');
    assert.strictEqual(vm.runInContext('apiResolveIdentityPreserved', context), true,
        'the listener must not wrap a session request resolver');
    assert.strictEqual(vm.runInContext('apiResolveResult.body.session', context), 'unchanged');
    assert.strictEqual(vm.runInContext('functionCallRestored', context), true,
        'the temporary loader probe must be restored as soon as the asset map is found');
    assert.strictEqual(vm.runInContext('Array.prototype.push===nativeArrayPush', context), true,
        'the native Array.prototype.push identity must still hold after async monitoring work');
    assert.strictEqual(vm.runInContext('Function.prototype.call===nativeFunctionCall', context), true,
        'the loader probe must remain restored after async monitoring work');
    const movie = latestObservation.body.resources.find(item => item.cardId === '1040270990');
    assert.strictEqual(movie.dynamicCardStatus, 'available');
    assert.strictEqual(movie.dynamicCardSyncStatus, 'synced');
    assert.strictEqual(movie.implementationSource, 'official-game-direct-on-demand');
    console.log('game-update-listener-hook: PASS');
    process.exit(0);
}, 300);
