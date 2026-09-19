'use strict';

// Read-only production regression against an immutable pre-fix Git baseline.
// Neither game assets nor the shipped library are rewritten by this script.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const focus = process.argv[2] === 'eyes' ? 'eyes' : 'brows';
const targetTime = focus === 'eyes' ? 161.28333333333333 : 178;
const output = path.join(root, 'exports/spine-diagnostic/verified-fix', focus);
const rawScenario = JSON.parse(fs.readFileSync(path.join(root, 'exports/offline-proof/201002001/source.json')));
const replayEvents = JSON.parse(fs.readFileSync(path.join(root, 'exports/offline-proof/201002001/offline-report.json'))).events.filter(e => e.kind === 'track' && e.time <= targetTime + 1e-8);
const playwright = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const shipped = fs.readFileSync(path.join(root, 'lib/pixi-spine.umd.js'), 'utf8');
const runtime = execFileSync('git', ['show', '26a7b918ca2e18f23e53dd88fb734750eee46ceb:lib/pixi-spine.umd.js'],
    {cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
if(createHash('sha256').update(runtime).digest('hex')!=='760d735a24d66623b617b782c7a2aaeb8aef688ed3d690a877f0e65cfc90fb57')throw new Error('Historical library hash mismatch');
const trial = shipped;
fs.mkdirSync(output, { recursive: true });
const html = variant => variant === 'game' ? `<!doctype html><body style="margin:0"><script src="/exports/spine-diagnostic/enza-game.reference.js"></script><script>if(window.PIXI) PIXI.Loader={shared:PIXI.loader};</script><script src="/scripts/CharacterStage.js"></script></body>` : `<!doctype html><body style="margin:0"><script src="/lib/pixi.js"></script><script src="/runtime?variant=${variant}"></script><script src="/exports/spine-diagnostic/spine-core-3.6.js"></script><script src="/scripts/CharacterStage.js"></script></body>`;
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(html(url.searchParams.get('variant'))); }
    if (url.pathname === '/runtime') { res.setHeader('Content-Type', 'text/javascript'); return res.end(url.searchParams.get('variant') === 'fixed' ? trial : runtime); }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' })[path.extname(file)] || 'text/plain');
    fs.createReadStream(file).pipe(res);
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await playwright.chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-background-networking'] });
        const session = await browser.newBrowserCDPSession();
        for (const p of (await session.send('SystemInfo.getProcessInfo')).processInfo) {
            try { os.setPriority(p.id, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (_) {}
        }
        const results = {};
        for (const variant of ['historical', 'fixed', 'game']) {
            const page = await browser.newPage({ viewport: { width: 900, height: 840 } });
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));
            await page.goto(`http://127.0.0.1:${server.address().port}/?variant=${variant}`);
            const metrics = await page.evaluate(async ({ variant, rawScenario, replayEvents, targetTime }) => {
                if (!window.PIXI) throw new Error('Missing PIXI; ezg keys: ' + Object.keys(window.ezg || {}));
                if (PIXI.utils.skipHello) PIXI.utils.skipHello();
                const app = new PIXI.Application({ width: 900, height: 840, backgroundColor: 0xc7d8e8, autoStart: false, preserveDrawingBuffer: true });
                document.body.appendChild(app.view);
                await new Promise((resolve, reject) => {
                    PIXI.Loader.shared.onError.add(reject);
                    PIXI.Loader.shared.add('model', '/assets/spine/idols/stand/1040100140/data.json').load(resolve);
                });
                const stage = new CharacterStage(app);
                app.stage.addChild(stage.stageObj);
                app.stage.scale.set(2);
                app.stage.position.set(-400, -790);
                await stage.control({ asset: 'model', label: 'c', position: { x: 450, y: 860 }, scale: 0.85,
                    anim1: 'wait4', anim2: 'face_sad', lipAnim: 'lip_smile' });
                const spine = [...stage._spineMap.values()][0];
                spine.autoUpdate = false;
                if (variant === 'core36') {
                    const core = window.spine;
                    const displaySkeleton = spine.skeleton;
                    const atlas = { findRegion(name) {
                        for (const skin of spine.spineData.skins) for (const slot of Object.values(skin.attachments)) {
                            for (const a of Object.values(slot)) if (a.region?.name === name) return a.region;
                        }
                        throw new Error('Reference region absent: ' + name);
                    } };
                    const raw = await (await fetch('/assets/spine/idols/stand/1040100140/data.json')).json();
                    const data = new core.SkeletonJson(new core.AtlasAttachmentLoader(atlas)).readSkeletonData(raw);
                    const oldSkeleton = new core.Skeleton(data);
                    oldSkeleton.flipY = true;
                    oldSkeleton.setSkinByName('default');
                    spine.spineData = data;
                    spine.stateData = new core.AnimationStateData(data);
                    spine.state = new core.AnimationState(spine.stateData);
                    const renderUpdate = spine.update.bind(spine);
                    displaySkeleton.updateWorldTransform = () => {
                        for (let i = 0; i < displaySkeleton.bones.length; i++) {
                            const source = oldSkeleton.bones[i], target = displaySkeleton.bones[i].matrix;
                            target.a = source.a; target.b = source.c;
                            target.c = source.b; target.d = source.d;
                            target.tx = source.worldX; target.ty = source.worldY;
                        }
                    };
                    const copyState = { update() {}, apply() {
                        for (let i = 0; i < displaySkeleton.bones.length; i++) {
                            const source = oldSkeleton.bones[i], target = displaySkeleton.bones[i];
                            for (const key of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY']) target[key] = source[key];
                        }
                        for (let i = 0; i < displaySkeleton.slots.length; i++) {
                            const source = oldSkeleton.slots[i], target = displaySkeleton.slots[i];
                            const attachment = source.getAttachment();
                            target.setAttachment(attachment ? displaySkeleton.getAttachment(i, attachment.name) : null);
                            target.color.setFromColor(source.color);
                            target.attachmentVertices.length = source.attachmentVertices.length;
                            for (let j = 0; j < source.attachmentVertices.length; j++) target.attachmentVertices[j] = source.attachmentVertices[j];
                        }
                        displaySkeleton.drawOrder = oldSkeleton.drawOrder.map(s => displaySkeleton.slots[s.data.index]);
                    } };
                    spine.update = dt => {
                        const oldState = spine.state;
                        oldState.update(dt);
                        oldState.apply(oldSkeleton);
                        oldSkeleton.updateWorldTransform();
                        spine.state = copyState;
                        renderUpdate(0);
                        spine.state = oldState;
                    };
                    stage._setAnim('wait4', true, 0, spine);
                    stage._setOverlayAnim('face_sad', true, 1, spine);
                    stage._setOverlayAnim('lip_smile', true, 5, spine);
                }
                spine.state.clearTracks();
                let cursor = 0;
                for (let frame = 0; frame <= Math.round(targetTime * 60); frame++) {
                    while (cursor < replayEvents.length && replayEvents[cursor].time <= frame / 60 + 1e-8) {
                        const raw = rawScenario[replayEvents[cursor++].index];
                        if (raw.charLabel) {
                            const params = { label: 'c' };
                            for (let a = 1; a <= 5; a++) {
                                if (raw['charAnim' + a]) params['anim' + a] = raw['charAnim' + a];
                                if (raw['charAnim' + a + 'Loop'] != null) params['anim' + a + 'Loop'] = raw['charAnim' + a + 'Loop'];
                            }
                            if (raw.charLipAnim) params.lipAnim = raw.charLipAnim;
                            await stage.control(params);
                            spine.autoUpdate = false;
                        }
                    }
                    if (frame < Math.round(targetTime * 60)) spine.update(1 / 60);
                }
                spine.autoUpdate = false;
                if (variant === 'alpha1') spine.state.tracks[1].alpha = 1;
                const sample = () => {
                    const names = ['eyebrows_L', 'eyebrows_R', 'eye_shadow_L', 'eye_shadow_R', 'eyelash_L', 'eyelash_R',
                        'eyes_jito_L', 'eyes_jito_R', 'eye_white_L', 'eye_white_R', 'eyeball_L', 'eyeball_R', 'eye_lid_under_L', 'eye_lid_under_R'];
                    return Object.fromEntries(names.map(n => {
                        const slot = spine.skeleton.findSlot(n);
                        return [n, { deform: Array.from(slot.attachmentVertices), attachment: slot.getAttachment()?.name,
                            vertices: Array.from(slot.currentMesh?.vertices || []),
                            matrix: [slot.bone.matrix.a, slot.bone.matrix.b, slot.bone.matrix.c, slot.bone.matrix.d, slot.bone.matrix.tx, slot.bone.matrix.ty] }];
                    }));
                };
                const frames = [];
                const shots = {};
                for (let i = 0; i < 600; i++) {
                    spine.update(1 / 60);
                    frames.push({ frame: i + 1, tracks: spine.state.tracks.map(t => t && ({ name: t.animation.name, time: t.trackTime, alpha: t.alpha, mixing: !!t.mixingFrom })), slots: sample() });
                    if ([60, 120, 180, 240, 258, 259, 260, 261, 262, 263, 264, 265, 268, 270, 300].includes(i + 1)) {
                        app.renderer.render(app.stage);
                        shots[i + 1] = app.view.toDataURL('image/png').split(',')[1];
                    }
                }
                app.renderer.render(app.stage);
                const image = app.view.toDataURL('image/png').split(',')[1];
                return { version: spine.spineData.version, frames, image, shots };
            }, { variant, rawScenario, replayEvents, targetTime });
            fs.writeFileSync(path.join(output, `${variant}.png`), Buffer.from(metrics.image, 'base64'));
            delete metrics.image;
            for (const [frame, bytes] of Object.entries(metrics.shots)) fs.writeFileSync(path.join(output, `${variant}-${frame}.png`), Buffer.from(bytes, 'base64'));
            delete metrics.shots;
            results[variant] = { ...metrics, errors };
            await page.close();
            console.log('Rendered', variant, 'errors', errors.length);
        }
        fs.writeFileSync(path.join(output, 'metrics.json'), JSON.stringify(results));
        const original = results.historical.frames.at(-1).slots.eyebrows_L.deform;
        const corrected = results.fixed.frames.at(-1).slots.eyebrows_L.deform;
        console.log(JSON.stringify({ output, eyebrowVertexRatios: original.slice(0, 8).map((v, i) => v / corrected[i]) }));
    } finally { if (browser) await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
