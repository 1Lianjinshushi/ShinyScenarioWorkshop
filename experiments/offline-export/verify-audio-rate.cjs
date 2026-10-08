'use strict';
// Local-only browser integration test. No system sound settings are changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { validateDecodedAudio } = require('./profile.cjs');
const root = path.resolve(__dirname, '../..');
const playwright = require(process.env.SSV_PLAYWRIGHT || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const chromium = process.env.SSV_CHROMIUM || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const resultDir = path.join(root, 'tmp/audio-rate-verification');
fs.mkdirSync(resultDir, { recursive: true });

function wave(rate, channels) {
    const frames = Math.round(rate * 1.2), data = Buffer.alloc(44 + frames * channels * 2);
    data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
    data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(channels, 22);
    data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * channels * 2, 28);
    data.writeUInt16LE(channels * 2, 32); data.writeUInt16LE(16, 34); data.write('data', 36);
    data.writeUInt32LE(data.length - 44, 40);
    for (let frame = 0; frame < frames; frame++) for (let ch = 0; ch < channels; ch++) {
        const time = frame / rate;
        const sample = time >= .125 && time < .875 ? .25 * Math.sin(2 * Math.PI * (ch ? 660 : 440) * time) : 0;
        data.writeInt16LE(Math.round(sample * 32767), 44 + (frame * channels + ch) * 2);
    }
    return data;
}

(async () => {
    const allowed = new Map([
        ['/lib/pixi.js', path.join(root, 'lib/pixi.js')], ['/lib/pixi-sound.js', path.join(root, 'lib/pixi-sound.js')],
        ['/page.js', path.join(__dirname, 'page.js')],
    ]);
    const fixtures = [];
    for (const rate of [8000, 22050, 32000, 44100, 48000, 96000]) for (const channels of [1, 2])
        fixtures.push({ url: `/fixture-${rate}-${channels}.wav`, rate, channels, bytes: wave(rate, channels) });
    const reportFile = process.argv[2] && path.resolve(process.argv[2]);
    const report = reportFile && JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    const real = report ? [...new Set(report.failures.filter(item => item.stage === 'audio-decode').map(item => item.resource))]
        : ['./assets/sounds/se/003.m4a', './assets/sounds/se/004.m4a'];
    assert(real.length, 'The supplied preflight report has no audio-decode failures to test');
    for (const url of real) {
        assert.match(url, /^\.\/assets\/(?:sounds|movies)\/[a-zA-Z0-9_./-]+$/);
        const file = path.resolve(root, url.slice(2));
        assert(file.startsWith(path.join(root, 'assets') + path.sep));
        assert(fs.existsSync(file), `Missing local test asset: ${url}`);
        allowed.set(url.slice(1), file);
    }
    const server = http.createServer((req, res) => {
        if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><script src="/lib/pixi.js"></script><script src="/lib/pixi-sound.js"></script><script src="/page.js"></script>'); }
        const fixture = fixtures.find(item => item.url === req.url);
        if (fixture) { res.setHeader('Content-Type', 'audio/wav'); return res.end(fixture.bytes); }
        if (!allowed.has(req.url)) { res.statusCode = 404; return res.end(); }
        res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'audio/mp4');
        fs.createReadStream(allowed.get(req.url)).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const results = { browser: path.basename(chromium), sourceReport: reportFile || null, cases: [], legacy: [], equivalenceAt48k: null };
    let browser;
    try {
        browser = await playwright.chromium.launch({ executablePath: chromium, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-extensions', '--disable-background-networking'] });
        const baseline = new Map();
        for (const deviceRate of [48000, 44100, 96000]) {
            const context = await browser.newContext();
            const page = await context.newPage();
            await page.addInitScript(rate => {
                const NativeAudioContext = window.AudioContext;
                window.AudioContext = class extends NativeAudioContext { constructor(options = {}) { super({ ...options, sampleRate: rate }); } };
            }, deviceRate);
            await page.goto(`http://127.0.0.1:${server.address().port}/`);
            const setup = await page.evaluate(() => proof.initAudioDecoder());
            assert.equal(setup.playbackSampleRate, deviceRate);
            assert.equal(setup.sampleRate, 48000);
            const legacy = await page.evaluate(async url => {
                const bytes = await (await fetch(url)).arrayBuffer();
                const b = await new Promise((resolve, reject) => PIXI.sound.context.decode(bytes, (error, buffer) => error ? reject(error) : resolve(buffer)));
                return { sampleRate: b.sampleRate, wouldHitOldGuard: b.sampleRate !== 48000 };
            }, real[0]);
            assert.equal(legacy.wouldHitOldGuard, deviceRate !== 48000);
            results.legacy.push({ deviceRate, ...legacy });
            for (const fixture of fixtures) {
                const result = await page.evaluate(async url => {
                    const metadata = await proof.decodeAudio(url), b = proof.decodedAudio;
                    const measurements = Array.from({ length: b.numberOfChannels }, (_, channel) => {
                        const samples = b.getChannelData(channel); let crossings = 0, first = -1, last = -1;
                        for (let i = 0; i < samples.length; i++) {
                            if (Math.abs(samples[i]) > .02) { if (first < 0) first = i; last = i; }
                            if (i > 9600 && i < 38400 && samples[i - 1] <= 0 && samples[i] > 0) crossings++;
                        }
                        return { frequency: crossings / .6, start: first / 48000, end: last / 48000 };
                    });
                    proof.decodedAudio = null;
                    return { ...metadata, measurements };
                }, fixture.url);
                validateDecodedAudio(result);
                assert.equal(result.samples, 57600);
                assert.equal(result.duration, 1.2);
                assert.equal(result.channels, fixture.channels);
                result.measurements.forEach((value, channel) => {
                    assert(Math.abs(value.frequency - (channel ? 660 : 440)) < 2, 'Pitch changed');
                    assert(Math.abs(value.start - .125) < .001, 'Audio onset shifted');
                    assert(Math.abs(value.end - .875) < .001, 'Audio end shifted');
                });
                results.cases.push({ deviceRate, sourceRate: fixture.rate, channels: fixture.channels, ...result });
            }
            const assets = [];
            for (const url of real) {
                const result = await page.evaluate(async url => {
                    const metadata = await proof.decodeAudio(url), b = proof.decodedAudio;
                    const hashes = [];
                    for (let i = 0; i < b.numberOfChannels; i++) {
                        const digest = await crypto.subtle.digest('SHA-256', b.getChannelData(i));
                        hashes.push(Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, '0')).join(''));
                    }
                    let legacyIdentical = null;
                    if (PIXI.sound.context.audioContext.sampleRate === 48000) {
                        const bytes = await (await fetch(url)).arrayBuffer();
                        const old = await new Promise((resolve, reject) => PIXI.sound.context.decode(bytes, (error, buffer) => error ? reject(error) : resolve(buffer)));
                        const oldHashes = [];
                        for (let i = 0; i < old.numberOfChannels; i++) {
                            const digest = await crypto.subtle.digest('SHA-256', old.getChannelData(i));
                            oldHashes.push(Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, '0')).join(''));
                        }
                        legacyIdentical = old.length === b.length && JSON.stringify(hashes) === JSON.stringify(oldHashes);
                    }
                    proof.decodedAudio = null;
                    return { ...metadata, hashes, legacyIdentical };
                }, url);
                validateDecodedAudio(result);
                if (deviceRate === 48000) { assert.equal(result.legacyIdentical, true, '48 kHz output regression'); baseline.set(url, result.hashes); }
                else assert.deepEqual(result.hashes, baseline.get(url), 'Device rate changed exported PCM');
                assets.push({ url, ...result });
            }
            results.cases.push({ deviceRate, decodedAssets: assets.length, assets });
            console.log(JSON.stringify({ deviceRate, fixtureCases: fixtures.length, actualAudioFiles: assets.length, legacyWouldFail: legacy.wouldHitOldGuard, passed: true }));
            await context.close();
        }
        results.equivalenceAt48k = true;
        results.passed = true;
    } finally {
        if (browser) await browser.close();
        server.close();
        fs.writeFileSync(path.join(resultDir, 'report.json'), JSON.stringify(results, null, 2));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
