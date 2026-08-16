'use strict';

const assert = require('assert');
const RelatedScenarioSearch = require('../scripts/RelatedScenarioSearch.js');

async function main() {
    assert.deepStrictEqual(
        RelatedScenarioSearch.buildGroups('200702001'),
        [
            { label: '20070200X', ids: ['200702001', '200702002', '200702003', '200702004', '200702005', '200702006', '200702007', '200702008', '200702009'] },
            { label: '20070201X', ids: ['200702011', '200702012', '200702013', '200702014', '200702015', '200702016', '200702017', '200702018', '200702019'] },
        ],
    );

    const existing = new Set(['200702001', '200702002', '200702011', '200702012']);
    const tested = [];
    const result = await RelatedScenarioSearch.scan({
        seedId: '200702001',
        eventTypes: ['produce_events'],
        fetchOne: async (eventType, eventId) => {
            tested.push(eventId);
            if (!existing.has(eventId)) throw new Error('HTTP 404');
            return { tracks: [{}], eventType };
        },
    });
    assert.deepStrictEqual(result.hits.map(hit => hit.eventId), ['200702001', '200702002', '200702011', '200702012']);
    assert.deepStrictEqual(tested, [
        '200702001', '200702002', '200702003', '200702004',
        '200702011', '200702012', '200702013', '200702014',
    ]);

    const values = new Map();
    const storage = {
        setItem(key, value) { values.set(key, value); },
        getItem(key) { return values.has(key) ? values.get(key) : null; },
    };
    const manifest = RelatedScenarioSearch.saveManifest({
        hits: [
            { eventType: 'produce_events', eventId: '200702001', tracks: [{}, {}] },
            { eventType: 'produce_events', eventId: '200702002', tracks: [{}] },
            { eventType: 'produce_events', eventId: '200702002', tracks: [{}, {}, {}] },
        ],
    }, storage);
    assert.deepStrictEqual(manifest.hits.map(hit => hit.eventId), ['200702001', '200702002']);
    assert.strictEqual(manifest.hits[0].trackCount, 2);
    assert.deepStrictEqual(
        RelatedScenarioSearch.loadManifest('produce_events', '200702002', storage).hits.map(hit => hit.eventId),
        ['200702001', '200702002'],
    );
    assert.strictEqual(RelatedScenarioSearch.loadManifest('produce_events', '999999999', storage), null);
    console.log('related-scenario-search: PASS');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
