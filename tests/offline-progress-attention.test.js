'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../scripts/OfflineProgress.js'), 'utf8');
const jobId = 'b'.repeat(32);

function makeNode() {
    return {
        children: [], dataset: {}, listeners: {}, hidden: false, value: '',
        addEventListener(name, callback) { this.listeners[name] = callback; },
        append(...items) { this.children.push(...items); },
        replaceChildren(...items) { this.children = items; },
        setAttribute() {},
    };
}

async function flush() {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
}

test('paused export displays reason, flashes its popup, and only resumes after manual click', async () => {
    const elements = new Map(), calls = [], windowListeners = {};
    const element = id => {
        if (!elements.has(id)) elements.set(id, makeNode());
        return elements.get(id);
    };
    const paused = { id: jobId, eventId: '200902204', state: 'paused', stage: 'paused',
        pause: { reason: '系统内存不足；请清理内存后重试。' } };
    const response = data => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => data });
    const document = { getElementById: element, createElement: () => makeNode(),
        hasFocus: () => false, title: '' };
    vm.runInNewContext(source, {
        document, window: { opener: null, addEventListener: (event, callback) => { windowListeners[event] = callback; } },
        globalThis: { crypto: { randomUUID: () => 'a'.repeat(32) } },
        location: { search: '?ids=' + jobId, href: 'http://127.0.0.1:8000/offline-progress.html' },
        URL, URLSearchParams, Set, AbortSignal, Number,
        setTimeout: () => {},
        fetch: async (url, options) => {
            calls.push({ url, payload: options.body && JSON.parse(options.body) });
            if (url.endsWith('/jobs')) return response({ jobs: [paused], queueLimit: 50 });
            if (url.endsWith('/attention')) return response({ attention: true });
            if (url.endsWith('/resume')) return response({ jobs: [{ ...paused, state: 'running', stage: 'preflight' }], resumed: true, queueLimit: 50 });
            throw Error('unexpected route: ' + url);
        },
    });
    await flush();
    assert.match(document.title, /\[SSV:a{32}\]/);
    assert.match(element('summary').textContent, /1 项暂停/);
    const jobCard = element('jobs').children[0];
    assert.equal(jobCard.dataset.state, 'paused');
    assert.equal(jobCard.children[2].textContent, paused.pause.reason);
    const button = jobCard.children[3].children[0];
    assert.equal(button.textContent, '继续任务');
    assert.equal(calls.filter(call => call.url.endsWith('/attention')).length, 1);
    assert.equal(calls.filter(call => call.url.endsWith('/start')).length, 0);
    button.listeners.click();
    await flush();
    assert.equal(calls.filter(call => call.url.endsWith('/resume')).length, 1);
    assert.equal(calls.filter(call => call.url.endsWith('/start')).length, 0);
    assert.equal(typeof windowListeners.focus, 'function');
});
