'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const csv = require('../scripts/CsvTranslation.js');
const batch = require('../scripts/OfflineBatchCsvQueue.js');

const root = path.join(__dirname, '..');
const scenario = id => [
    { id: `${id}0001`, speaker: '櫻木 真乃', text: 'こんにちは', charAnim1: 'idle' },
    { select: 'その意気だ！', nextLabel: 4 },
    { id: `${id}0002`, speaker: '幽谷 霧子', text: 'ありがとう' },
];
const translation = id => [
    'id,name,text,trans',
    `${id}0001,櫻木 真乃,こんにちは,你好`,
    'select,,その意気だ！,就是这个劲头！',
    `${id}0002,幽谷 霧子,ありがとう,谢谢`,
].join('\n');

test('batch CSV snapshot preserves Chinese text and choices, original action fields, and missing-speaker warnings', () => {
    const tracks = scenario('200902204');
    const result = batch.translatedItem(tracks, translation('200902204'),
        'produce_events', '200902204', new Map([['櫻木 真乃', '真乃']]), csv);
    const localized = JSON.parse(result.item.content);
    assert.equal(result.item.language, 'zh-cn');
    assert.equal(result.item.mode, 'offline');
    assert.equal(result.report.applied, 3);
    assert.deepEqual(result.missingSpeakers, ['幽谷 霧子']);
    assert.equal(localized[0].text, '你好');
    assert.equal(localized[0].text_ja, 'こんにちは');
    assert.equal(localized[0].speaker, '真乃');
    assert.equal(localized[0].charAnim1, 'idle');
    assert.equal(localized[1].select, '就是这个劲头！');
    assert.equal(localized[1].select_ja, 'その意気だ！');
    assert.equal(localized[1].nextLabel, 4);
    assert.equal(localized[2].text, '谢谢');
    assert.equal(tracks[0].text, 'こんにちは', 'the source JSON must remain untouched');
});

test('per-CSV JSON fetch falls back to secondary verified root', async () => {
    const requests = [];
    const fetched = await batch.fetchTracks('produce_events', '200902204', async (url, options) => {
        requests.push({ url, options });
        if (url.startsWith('https://primary/')) return { ok: false, status: 404 };
        return { ok: true, json: async () => scenario('200902204') };
    }, ['https://primary', 'https://fallback']);
    assert.equal(fetched.length, 3);
    assert.deepEqual(requests.map(request => request.url), [
        'https://primary/json/produce_events/200902204.json',
        'https://fallback/json/produce_events/200902204.json',
    ]);
    assert.ok(requests.every(request => request.options.cache === 'no-store' && request.options.mode === 'cors'));
});

class FakeElement {
    constructor() {
        this.children = []; this.dataset = {}; this._value = ''; this.textContent = '';
        this.className = ''; this.hidden = false; this.disabled = false; this.checked = false;
    }
    get value() { return this._value; }
    set value(next) { this._value = String(next); }
    append(...nodes) {
        for (const node of nodes) { if (node.parent) node.remove(); node.parent = this; this.children.push(node); }
    }
    replaceChildren(...nodes) {
        for (const node of this.children) node.parent = null;
        this.children = []; this.append(...nodes);
    }
    insertBefore(node, before) {
        if (node.parent) node.remove();
        const index = before ? this.children.indexOf(before) : -1;
        node.parent = this;
        this.children.splice(index < 0 ? this.children.length : index, 0, node);
    }
    remove() {
        if (!this.parent) return;
        const index = this.parent.children.indexOf(this);
        if (index >= 0) this.parent.children.splice(index, 1);
        this.parent = null;
    }
    querySelector(selector) {
        return selector === '.empty-state' ? this.children.find(node => node.className === 'empty-state') : null;
    }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
}

async function waitUntil(predicate) {
    const deadline = Date.now() + 1000;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error('Timed out waiting for batch export enqueue');
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

test('batch import fetches translated snapshots, checks returned jobs, and never starts rendering', async () => {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, new FakeElement());
        return elements.get(id);
    };
    const listeners = new Map(), apiCalls = [], jsonCalls = [];
    let jobs = [];
    const data = () => ({
        manualStart: true, available: true, missing: [], jobs,
        concurrencyModes: [1, 2], defaultConcurrency: 2,
        verificationModes: ['auto', 'quick', 'full'], defaultVerificationMode: 'auto',
        policyDefaults: { memoryMiB: 3072, reserveMiB: 1609 },
        policyBounds: { memoryMiB: { min: 512, max: 8192 }, reserveMiB: { min: 1024, max: 8192 } },
    });
    const fetcher = async (url, options) => {
        if (url.startsWith('./api/offline-export/')) {
            const route = url.slice('./api/offline-export/'.length);
            const payload = options.body ? JSON.parse(options.body) : null;
            apiCalls.push({ route, method: options.method, payload });
            if (route !== 'jobs') throw new Error(`Unexpected route: ${route}`);
            if (payload) jobs = payload.items.map((item, index) => ({
                id: `job-${index + 1}`, eventId: item.eventId, language: item.language,
                displayTitle: item.eventId, state: 'pending', stage: 'pending', progress: {},
            }));
            return {
                ok: true, headers: { get: () => 'application/json' },
                json: async () => ({ ...data(), ids: jobs.map(job => job.id) }),
            };
        }
        jsonCalls.push(url);
        if (url.includes('/200902204.json') && url.startsWith('https://primary/')) return { ok: false, status: 404 };
        const eventId = url.match(/\/(\d+)\.json$/)?.[1];
        return { ok: true, json: async () => scenario(eventId) };
    };
    const context = vm.createContext({
        window: { addEventListener: (name, callback) => listeners.set(name, callback) },
        document: { hidden: false, getElementById: id => element(id), createElement: () => new FakeElement() },
        state: { tracks: null, csvText: '', eventType: '', eventId: '', speakerMap: new Map([['櫻木 真乃', '真乃']]) },
        OfflineBatchCsvQueue: batch, ScenarioCsvTranslation: csv,
        REMOTE_ROOT: 'https://primary', REMOTE_JSON_FALLBACK: 'https://fallback',
        deriveStoryResourcePaths: () => [], deriveCommonResourcePaths: () => [],
        resourceCacheStatus: async () => ({ missing: new Set() }),
        fetch: fetcher, AbortSignal, console,
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        setTimeout: () => 0,
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'scripts/AppOfflineExport.js'), 'utf8'), context);
    assert.equal(typeof listeners.get('ssv-translation-batch-imported'), 'function');
    listeners.get('ssv-translation-batch-imported')({ detail: { items: [
        { eventType: 'produce_events', eventId: '200902204', fileName: '果穗P4.csv', text: translation('200902204') },
        { eventType: 'produce_events', eventId: '200902211', fileName: '果穗P5.csv', text: translation('200902211') },
    ] } });
    await waitUntil(() => apiCalls.some(call => call.route === 'jobs' && call.method === 'POST')
        && element('offline-export-start').textContent.includes('2')
        && element('offline-export-start').disabled === false);
    const post = apiCalls.find(call => call.route === 'jobs' && call.method === 'POST');
    assert.equal(post.payload.items.length, 2);
    assert.ok(post.payload.items.every(item => item.language === 'zh-cn'));
    assert.deepEqual(post.payload.items.map(item => JSON.parse(item.content)[1].select),
        ['就是这个劲头！', '就是这个劲头！']);
    assert.ok(jsonCalls.includes('https://primary/json/produce_events/200902204.json'));
    assert.ok(jsonCalls.includes('https://fallback/json/produce_events/200902204.json'));
    assert.equal(element('offline-export-jobs').children.length, 2);
    assert.ok(element('offline-export-jobs').children.every(row => row.children[0].checked));
    assert.equal(element('offline-export-start').disabled, false);
    assert.ok(apiCalls.every(call => call.route !== 'start'), 'enqueue must not start encoding');
});

test('workshop wires successful batch imports instead of the old related-fetch button', () => {
    const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
    const importer = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const exporter = fs.readFileSync(path.join(root, 'scripts/AppOfflineExport.js'), 'utf8');
    assert.match(html, /scripts\/OfflineBatchCsvQueue\.js/);
    assert.match(html, /id="offline-export-related-title">批量汉化直出/);
    assert.doesNotMatch(html, /id="offline-export-related-all"/);
    assert.match(importer, /ssv-translation-batch-imported/);
    assert.match(exporter, /window\.addEventListener\('ssv-translation-batch-imported'/);
    assert.doesNotMatch(exporter, /ssv-related-manifest-updated/);
});
