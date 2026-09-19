'use strict';

// Sequential local-asset integration regression. Compare the shipped runtime
// with the previously verified public game runtime, never changing model data.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'exports/spine-diagnostic/multi-model');
const reference = path.join(root, 'exports/spine-diagnostic/enza-game.reference.js');
const shipped = fs.readFileSync(path.join(root, 'lib/pixi-spine.umd.js'), 'utf8');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (hash(reference) !== 'd19cf67b77d42419a82b77af4fc33e958f7c62ab9da33f5a9e1a34fa6fb053fd') {
    throw new Error('Missing or changed verified game runtime');
}
const models = fs.readdirSync(path.join(root, 'assets/spine/idols/stand'))
    .filter(id => fs.existsSync(path.join(root, 'assets/spine/idols/stand', id, 'data.json')) && (!process.argv[2] || process.argv[2].split(',').includes(id))).sort();
const playwright = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
fs.mkdirSync(output, { recursive: true });
const html = variant => `<!doctype html><body style="margin:0">${variant === 'game'
    ? '<script src="/exports/spine-diagnostic/enza-game.reference.js"></script><script>PIXI.Loader={shared:PIXI.loader};</script>'
    : '<script src="/lib/pixi.js"></script><script src="/lib/pixi-spine.umd.js"></script>'}
<script src="/scripts/CharacterStage.js"></script><script>
window.setup = async function(id) {
    if (PIXI.utils.skipHello) PIXI.utils.skipHello();
    const app = new PIXI.Application({width:600,height:700,backgroundColor:0xc7d8e8,autoStart:false,preserveDrawingBuffer:true});
    document.body.appendChild(app.view);
    await new Promise((resolve,reject) => {
        PIXI.Loader.shared.onError.add(e => reject(new Error(String(e))));
        PIXI.Loader.shared.add('model','/assets/spine/idols/stand/'+id+'/data.json').load(resolve);
    });
    const stage = new CharacterStage(app);
    app.stage.addChild(stage.stageObj);
    await stage.control({asset:'model',label:'c',position:{x:300,y:850},scale:.65});
    const spine = [...stage._spineMap.values()][0];
    spine.autoUpdate = false;
    window.rig = {app,stage,spine};
};
window.control = async function(params) {
    await rig.stage.control({label:'c',...params});
    rig.spine.autoUpdate = false;
};
</script></body>`;
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
        res.setHeader('Content-Type', 'text/html');
        return res.end('<!doctype html><iframe id="fixed" src="/rig?variant=fixed"></iframe><iframe id="game" src="/rig?variant=game"></iframe>');
    }
    if (url.pathname === '/rig') { res.setHeader('Content-Type', 'text/html'); return res.end(html(url.searchParams.get('variant'))); }
    if (url.pathname === '/lib/pixi-spine.umd.js') {res.setHeader('Content-Type','text/javascript');return res.end(shipped);}
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', ({'.js':'text/javascript','.json':'application/json','.png':'image/png'})[path.extname(file)] || 'text/plain');
    fs.createReadStream(file).pipe(res);
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    const report = {createdAt:new Date().toISOString(),runtimeSha256:hash(path.join(root,'lib/pixi-spine.umd.js')),
        referenceSha256:hash(reference),fps:60,framesPerPose:600,
        // Mesh vertices are Float32. 1e-4 model units covers rounding at the
        // measured coordinate scale, far below one rendered pixel.
        tolerance:1e-4,models:[]};
    try {
        browser = await playwright.chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-background-networking']});
        const session = await browser.newBrowserCDPSession();
        for (const p of (await session.send('SystemInfo.getProcessInfo')).processInfo) {
            try { os.setPriority(p.id, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (_) {}
        }
        for (const id of models) {
            const file = path.join(root,'assets/spine/idols/stand',id,'data.json');
            const modelHash = hash(file);
            const names = Object.keys(JSON.parse(fs.readFileSync(file)).animations);
            const pick = (...candidates) => candidates.find(n => names.includes(n));
            const poses = [
                {anim1:'wait1',anim2:pick('face_wait'),lipAnim:pick('lip_wait','lip_smile','lip_sad')},
                {anim1:'wait4',anim2:pick('face_sad','face_serious'),lipAnim:pick('lip_smile','lip_sad')},
                {anim1:'surp1',anim2:pick('face_jito','face_surp','face_anger'),lipAnim:pick('lip_surp','lip_smile')},
                {anim1:'smile1',anim2:pick('face_smile','face_smile1'),lipAnim:pick('lip_smile','lip_wait')},
                {anim1:'sad1',anim2:pick('face_close'),lipAnim:pick('lip_sad','lip_wait')},
                {anim1:'wait2',anim2:pick('face_anger','face_anger1'),lipAnim:pick('lip_anger')},
                {anim1:'wait3',anim2:pick('face_shy'),lipAnim:pick('lip_shy','lip_smile')},
            ];
            const page = await browser.newPage({viewport:{width:1220,height:720}});
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));
            try {
                await page.goto(`http://127.0.0.1:${server.address().port}/`);
                const result = await page.evaluate(async ({id,poses}) => {
                    const fixed = document.getElementById('fixed').contentWindow;
                    const game = document.getElementById('game').contentWindow;
                    await Promise.all([fixed.setup(id),game.setup(id)]);
                    const stats = {id,version:fixed.rig.spine.spineData.version,poses:[],maxError:0,attachmentMismatches:0,vertexLengthMismatches:0,nonFinite:0,comparedValues:0};
                    if (id === '1040210100') {
                        stats.methods = {};
                        for (const [name,w] of [['fixed',fixed],['game',game]]) {
                            const tl=w.rig.spine.spineData.animations.flatMap(a=>a.timelines).find(t=>t.frameVertices);
                            stats.methods[name]={deform:tl.apply.toString(),stateApply:w.rig.spine.state.apply.toString(),stateMix:w.rig.spine.state.applyMixingFrom.toString()};
                        }
                    }
                    const compare = (s,frame) => {
                        const a = fixed.rig.spine.skeleton.slots, b = game.rig.spine.skeleton.slots;
                        const bonesA=fixed.rig.spine.skeleton.bones,bonesB=game.rig.spine.skeleton.bones;
                        for(let j=0;j<bonesA.length;j++) for(const prop of ['x','y','rotation','scaleX','scaleY','shearX','shearY']) {
                            let e=Math.abs(bonesA[j][prop]-bonesB[j][prop]);
                            if(prop==='rotation') {e%=360;e=Math.min(e,360-e);}
                            if(e>0.0001) {
                                if(!s.boneDifferences)s.boneDifferences={};
                                const key=bonesA[j].data.name+'.'+prop;
                                if(!s.boneDifferences[key]||e>s.boneDifferences[key].error)s.boneDifferences[key]={error:e,frame,fixed:bonesA[j][prop],game:bonesB[j][prop]};
                            }
                        }
                        if (a.length !== b.length) throw new Error('Different slot count');
                        for (let i=0;i<a.length;i++) {
                            const aa=a[i].getAttachment(),ba=b[i].getAttachment();
                            if (aa?.name !== ba?.name) {s.attachmentMismatches++;continue;}
                            if (!aa) continue;
                            const check = (av,bv,kind) => {
                                if (av.length !== bv.length) {s.vertexLengthMismatches++;return;}
                                for (let v=0;v<av.length;v++) {
                                    if (!Number.isFinite(av[v]) || !Number.isFinite(bv[v])) s.nonFinite++;
                                    const error = Math.abs(av[v]-bv[v]);
                                    if (!s.byKind) s.byKind={};
                                    s.byKind[kind]=Math.max(s.byKind[kind]||0,error);
                                    if (error>s.maxError) {s.maxError=error;s.worst={frame,slot:a[i].data.name,kind,index:v,fixed:av[v],game:bv[v],attachment:aa.name,
                                        weighted:!!aa.bones,tracks:fixed.rig.spine.state.tracks.map(t=>t&&({name:t.animation.name,time:t.trackTime,alpha:t.alpha,mixTime:t.mixTime,mixingFrom:t.mixingFrom?.animation.name}))};}
                                    s.comparedValues++;
                                }
                            };
                            check(a[i].attachmentVertices,b[i].attachmentVertices,'deform');
                            if (aa.worldVerticesLength) check(a[i].currentMesh?.vertices||[],b[i].currentMesh?.vertices||[],'mesh');
                            const am=a[i].bone.matrix,bm=b[i].bone.matrix;
                            check([am.a,am.b,am.c,am.d,am.tx,am.ty],[bm.a,bm.b,bm.c,bm.d,bm.tx,bm.ty],'bone');
                        }
                    };
                    for (const pose of poses) {
                        await Promise.all([fixed.control(pose),game.control(pose)]);
                        const s={pose,frames:600,maxError:0,attachmentMismatches:0,vertexLengthMismatches:0,nonFinite:0,comparedValues:0,blinkChanges:0};
                        let prior='';
                        for (let f=0;f<600;f++) {
                            fixed.rig.spine.update(1/60);game.rig.spine.update(1/60);
                            compare(s,f);
                            const state=fixed.rig.spine.skeleton.slots.filter(x=>/eye|brow/.test(x.data.name)).map(x=>x.getAttachment()?.name||'-').join('|');
                            if (prior && prior!==state) s.blinkChanges++;
                            prior=state;
                        }
                        stats.poses.push(s);stats.maxError=Math.max(stats.maxError,s.maxError);
                        for(const k of ['attachmentMismatches','vertexLengthMismatches','nonFinite','comparedValues']) stats[k]+=s[k];
                    }
                    // Exercise a lower track alone too; do not hide errors by
                    // forcing expression alpha=1 or removing blink timelines.
                    for (const w of [fixed,game]) {w.rig.spine.state.clearTracks();w.rig.spine.skeleton.setToSetupPose();}
                    await Promise.all([fixed.control({anim1:'wait1'}),game.control({anim1:'wait1'})]);
                    const lower={pose:{anim1:'wait1'},frames:600,maxError:0,attachmentMismatches:0,vertexLengthMismatches:0,nonFinite:0,comparedValues:0};
                    for(let f=0;f<600;f++){fixed.rig.spine.update(1/60);game.rig.spine.update(1/60);compare(lower,f);}
                    stats.poses.push(lower);stats.maxError=Math.max(stats.maxError,lower.maxError);
                    for(const k of ['attachmentMismatches','vertexLengthMismatches','nonFinite','comparedValues'])stats[k]+=lower[k];
                    for(const w of [fixed,game])w.rig.app.renderer.render(w.rig.app.stage);
                    stats.image=fixed.rig.app.view.toDataURL('image/png').split(',')[1];
                    return stats;
                },{id,poses});
                fs.writeFileSync(path.join(output,`${id}.png`),Buffer.from(result.image,'base64'));
                delete result.image;
                result.modelSha256=modelHash;
                result.assetsUnchanged=hash(file)===modelHash;
                result.errors=errors;
                report.models.push(result);
                console.log(id,'maxError',result.maxError,'attachment mismatches',result.attachmentMismatches,'errors',errors.length);
            } catch(error) {report.models.push({id,error:String(error),errors});console.error(id,String(error));}
            finally {await page.close();}
            fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
        }
        // Local rotations of unused/hidden alternative bones can retain
        // different histories. Acceptance checks attachments, deform buffers,
        // active mesh vertices and their matrices, not unused pose internals.
        const failed=report.models.filter(m=>m.error || m.maxError>report.tolerance || m.attachmentMismatches || m.vertexLengthMismatches || m.nonFinite || m.errors?.length || !m.assetsUnchanged);
        report.passed=failed.length===0;
        report.failedModels=failed.map(m=>m.id);
        fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
        console.log(JSON.stringify({models:report.models.length,failed:failed.map(m=>m.id),output}));
        if(failed.length)process.exitCode=1;
    } finally {if(browser)await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
