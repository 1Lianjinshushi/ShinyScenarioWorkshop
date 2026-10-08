'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), cp = require('node:child_process');
const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream');
const { validateMetadata, validatePackets, validateVerificationMode, quickVerify, VerificationPolicy } = require('../experiments/offline-export/verify.cjs');
const metadata = () => ({ streams: [
    { codec_type:'video', codec_name:'h264', width:1920, height:1080, r_frame_rate:'60/1', nb_frames:'2', start_time:'0', duration:'0.033333' },
    { codec_type:'audio', codec_name:'aac', sample_rate:'48000', channels:2, start_time:'0', duration:'0.033333' },
], format:{ duration:'0.033333', size:'1000' } });
const packets = 'pts_time=0.000000|dts_time=0.000000|duration_time=0.016667|size=100|pos=48\n'
    + 'pts_time=0.016667|dts_time=0.016667|duration_time=0.016667|size=100|pos=148\n';
test('quick verification checks track specifications, frame count, timing and packet extent', () => {
    assert.equal(validateMetadata(metadata(),2).frames,2);
    assert.equal(validatePackets(packets,2,1000),2);
    const cases = [d=>d.streams.pop(), d=>d.streams.push(d.streams[0]), d=>d.streams[0].nb_frames='1',
        d=>d.streams[0].width=1280, d=>d.streams[0].r_frame_rate='30/1', d=>d.streams[0].start_time='0.1',
        d=>d.streams[0].duration='2', d=>d.streams[1].channels=1, d=>d.streams[1].sample_rate='44100',
        d=>d.streams[1].duration='2', d=>d.streams[1].start_time='0.3', d=>d.format.duration='2'];
    for (const change of cases) { const d=metadata();change(d);assert.throws(()=>validateMetadata(d,2),/未通过/); }
    for (const bad of [packets.replace('pts_time=0.016667','pts_time=0.02'), packets.replace('dts_time=0.016667','dts_time=0.000000'),
        packets.replace('size=100|pos=148','size=100|pos=950'), packets.replace('size=100','size=0'),
        packets.split('\n')[0], packets.replace('duration_time=0.016667','duration_time=N/A')])
        assert.throws(()=>validatePackets(bad,2,1000),/未通过/);
    for(const mode of ['auto','quick','full']) assert.equal(validateVerificationMode(mode),mode);
    for(const mode of ['none','',null,{},1]) assert.throws(()=>validateVerificationMode(mode),/检查模式/);
});
test('auto verification ignores preflight waits and upgrades only the affected job at a production pause',()=>{
    const policy=new VerificationPolicy(), peer=new VerificationPolicy();
    for(const stage of ['preflight','preroll','verify','cleanup','startup'])
        assert.equal(policy.memoryPause(stage,{reason:'system-memory-pressure'}),false);
    for(const reason of ['normal','busy','moderate','memory-caution','disk-space','encoder-error'])
        assert.equal(policy.memoryPause('render',{reason}),false);
    assert.equal(policy.report().effectiveMode,'quick');
    assert.equal(policy.memoryPause('render',{reason:'export-memory-budget'}),true);
    assert.equal(policy.report().effectiveMode,'full');assert.equal(policy.report().upgraded,true);
    for(let i=0;i<10000;i++)policy.memoryPause('render',{reason:'export-memory-budget'});
    assert.equal(policy.report().reasons.length,1,'bounded deduplicated event memory');
    assert.equal(peer.report().effectiveMode,'quick','no cross-job upgrade');
    const snapshot=policy.report();snapshot.reasons[0].message='changed';
    assert.notEqual(policy.report().reasons[0].message,'changed');
});
test('auto mode handles audio/mux retries; explicit quick/full choices remain explicit',()=>{
    for(const stage of ['render','audio','mux']) for(const reason of ['allocation-budget','export-memory-budget','system-memory-pressure']) {
        const policy=new VerificationPolicy('auto');policy.memoryPause(stage,{reason});
        assert.equal(policy.report().effectiveMode,'full');
    }
    for(const mode of ['quick','full']) {
        const policy=new VerificationPolicy(mode);policy.memoryPause('audio',{reason:'allocation-budget'});
        assert.equal(policy.report().effectiveMode,mode);assert.equal(policy.report().upgraded,false);
    }
});
test('stability notification reuses pause callbacks and the throttled existing progress channel',()=>{
    const run=fs.readFileSync(path.join(__dirname,'../experiments/offline-export/run.cjs'),'utf8');
    assert.match(run,/governor\.onMemoryPause = detail => \{\s+if \(verificationPolicy\.memoryPause\(lastPhase, detail\)\)/);
    const progress=run.slice(run.indexOf('const progress = '),run.indexOf('governor.onDecision'));
    assert(progress.indexOf('Date.now() - lastProgress < 500')<progress.indexOf('verificationPolicy.report()'));
    const policy=fs.readFileSync(path.join(__dirname,'../experiments/offline-export/verify.cjs'),'utf8').split('function validateMetadata')[0];
    assert.doesNotMatch(policy,/setInterval|setTimeout|\.sample\(|cp\.spawn/);
});
function fixture(t, behavior) {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ssv-verify-')), file=path.join(dir,'video.mp4');
    fs.writeFileSync(file,Buffer.alloc(1000));
    t.after(()=>{ assert.equal(path.dirname(dir),os.tmpdir());fs.rmSync(dir,{recursive:true}); });
    const governor={children:new Set(),cancelled:false,lastSample:0,policy:{sampleMs:0},current:{action:'run'},
        async checkpoint(){ if(this.cancelled)throw new Error('Export cancelled'); },async sample(){},async pauseForMemory(){} };
    let calls=0;
    t.mock.method(cp,'spawn',(_binary,args,options)=>{
        assert.equal(options.windowsHide,true);
        const c=new EventEmitter(); c.pid=90000+calls++; c.stdout=new PassThrough();c.stderr=new PassThrough();
        let closed=false;
        c.finish=(code=0)=>{ if(closed)return;closed=true;c.stdout.end();c.stderr.end();c.emit('close',code); };
        c.kill=()=>c.finish(null);
        setImmediate(()=>behavior(c,args,governor,calls));return c;
    });
    const normal=(c,args)=>{ c.stdout.write(args.includes('-show_packets')?packets:JSON.stringify(metadata()));c.finish(); };
    return {file,governor,normal,calls:()=>calls};
}
test('quick probe succeeds without decoding or modifying the output', async t=>{
    let f;f=fixture(t,(...args)=>f.normal(...args));
    const before=fs.readFileSync(f.file), result=await quickVerify(f.file,2,{ffprobe:'mock',governor:f.governor});
    assert.equal(result.passed,true);assert.equal(result.packetCount,2);assert.equal(f.calls(),2);
    assert.deepEqual(fs.readFileSync(f.file),before);assert.equal(f.governor.children.size,0);
});
test('quick probe kills on memory pressure and repeats only after manual resume', async t=>{
    let f;f=fixture(t,(c,args,g,call)=>{ if(call>1)f.normal(c,args); });
    let pauses=0;
    f.governor.sample=async()=>{ f.governor.current={action:'pause',reason:'system-memory'}; };
    f.governor.pauseForMemory=async(stage,reason)=>{assert.equal(stage,'verify-quick');assert.equal(reason,'system-memory');pauses++;f.governor.current={action:'run'};};
    const result=await quickVerify(f.file,2,{ffprobe:'mock',governor:f.governor});
    assert.equal(result.passed,true);assert.equal(pauses,1);assert.equal(f.calls(),3);assert.equal(f.governor.children.size,0);
});
test('quick probe cancellation and nonzero probe errors cannot pass validation', async t=>{
    const f=fixture(t,(c,args,g)=>{g.cancelled=true;});
    await assert.rejects(quickVerify(f.file,2,{ffprobe:'mock',governor:f.governor}),/cancelled/);
    assert.equal(f.governor.children.size,0);
});
test('quick probe read errors fail', async t=>{
    const f=fixture(t,c=>{c.stderr.write('bad media');c.finish(1);});
    await assert.rejects(quickVerify(f.file,2,{ffprobe:'mock',governor:f.governor}),/bad media/);
    assert.equal(f.governor.children.size,0);
});
test('quick probe rejects a file size mismatch before scanning packets', async t=>{
    const f=fixture(t,c=>{const d=metadata();d.format.size='999';c.stdout.write(JSON.stringify(d));c.finish();});
    await assert.rejects(quickVerify(f.file,2,{ffprobe:'mock',governor:f.governor}),/文件大小不一致/);
    assert.equal(f.calls(),1);
});
test('quick probe rejects a file changed during packet inspection', async t=>{
    let f;f=fixture(t,(c,args)=>{if(args.includes('-show_packets'))fs.appendFileSync(f.file,'x');f.normal(c,args);});
    await assert.rejects(quickVerify(f.file,2,{ffprobe:'mock',governor:f.governor}),/文件发生变化/);
});
test('FFmpeg commands do not own the shared allocation lease for their duration',()=>{
    const run=fs.readFileSync(path.join(__dirname,'../experiments/offline-export/run.cjs'),'utf8');
    const ff=run.slice(run.indexOf('async function ff('),run.indexOf('async function writeStream'));
    assert(!ff.includes('withAllocation'));assert(ff.includes('governor.allocation'));
    assert(ff.includes('governor.children.add'));assert(ff.includes('governor.sample()'));
    assert(ff.includes('governor.pauseForMemory'));assert(ff.includes('code !== 0'));
});
