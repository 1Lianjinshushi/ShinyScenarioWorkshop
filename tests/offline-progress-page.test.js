'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'offline-progress.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'scripts/OfflineProgress.js'), 'utf8');

test('progress page is a lightweight standalone view, not the player', () => {
    assert.match(html, /scripts\/OfflineProgress\.js/);
    assert.doesNotMatch(html, /(?:app\.js|AppOfflineExport|playwright|spine|resource-loader)/i);
    assert.match(html, /id="return-workshop"/);
    assert.match(html, /id="memory-reserve"/);
    assert.match(html, /fonts\/AlimamaShuHeiTi\.ttf/);
    assert.match(html, /button \{ font: inherit; font-size: 14px;/);
    assert.match(source, /\.\/api\/offline-export\//);
    const workshop = fs.readFileSync(path.join(root, 'scripts/AppOfflineExport.js'), 'utf8');
    assert.doesNotMatch(workshop, /window\.open\(/);
    assert.match(workshop, /await action\('start'/);
    assert.doesNotMatch(workshop, /window\.close\(|window\.location\.replace\(|progressWindow\.focus\(/);
    assert.match(workshop, /手动最小化/);
    assert.match(workshop, /进度显示在下方任务列表/);
});

test('parked placeholder never polls the queue or loads the player', () => {
    let requests = 0;
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, { hidden: false, addEventListener() {} });
        return elements.get(id);
    };
    vm.runInNewContext(source, {
        document: { getElementById: element },
        window: { opener: null },
        location: { search: '?parked=1', href: 'http://127.0.0.1:8080/offline-progress.html' },
        URL, URLSearchParams, Set,
        fetch: () => { requests++; throw new Error('parked page must not fetch'); },
    });
    assert.equal(element('parked-view').hidden, false);
    assert.equal(element('monitor-view').hidden, true);
    assert.equal(requests, 0);
});
