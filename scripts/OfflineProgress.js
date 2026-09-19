'use strict';
(() => {
    const $ = id => document.getElementById(id);
    const params = new URLSearchParams(location.search);
    const parked = params.get('parked') === '1';
    const targetIds = [...new Set((params.get('ids') || '').split(',').filter(id => /^[a-f0-9]{32}$/.test(id)))];
    const targetSet = new Set(targetIds);
    const terminal = new Set(['complete', 'failed', 'cancelled', 'interrupted']);
    const stages = { pending: '待导出', queued: '排队中', paused: '内存不足，已暂停', preflight: '准备资源', preroll: '准备画面',
        render: '生成画面', audio: '处理音频', mux: '封装视频', verify: '检查成片', cleanup: '整理成片',
        cancelling: '正在停止', complete: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' };
    const localApp = new URL('./app.html', location.href).href;
    let lastData = null, editing = false, saving = false, polling = false, stopped = false;
    const resuming = new Set();
    let pausedVisible = false, attentionActive = false, attentionPending = false;
    const attentionToken = !parked && globalThis.crypto?.randomUUID?.().replaceAll('-', '');
    if (attentionToken) document.title = `后台直出进度 [SSV:${attentionToken}] · 闪耀色彩剧情工坊`;

    function returnToWorkshop() {
        if (!parked && window.opener && !window.opener.closed) {
            try {
                window.opener.location.replace(localApp);
                window.opener.focus();
                window.close();
                if (window.closed) return;
            } catch (_) { /* The original tab may no longer be available. */ }
        }
        location.replace(localApp);
    }
    $('return-workshop').addEventListener('click', returnToWorkshop);
    $('open-output').hidden = parked;
    $('parked-view').hidden = !parked;
    $('monitor-view').hidden = parked;
    if (parked) return;

    $('open-output').addEventListener('click', async () => {
        const button = $('open-output');
        button.disabled = true;
        try {
            const data = await request('open-root', {});
            if (!data.opened) throw new Error('保存目录未能打开');
            message(data.foreground === true
                ? '已在前台打开统一保存目录。'
                : '目录已打开；若窗口未置前，请从任务栏切换。', data.foreground === false ? 'error' : 'good');
        } catch (error) { message(error.message, 'error'); }
        finally { button.disabled = false; }
    });

    function message(value, tone = 'normal') {
        $('message').textContent = value;
        $('message').dataset.tone = tone;
    }
    function memoryStatus(value, tone = 'normal') {
        $('memory-status').textContent = value;
        $('memory-status').dataset.tone = tone;
    }
    async function request(route, payload) {
        const response = await fetch('./api/offline-export/' + route, {
            method: payload === undefined ? 'GET' : 'POST',
            headers: { 'Content-Type': 'application/json', 'X-SSV-Offline': '1' },
            body: payload === undefined ? undefined : JSON.stringify(payload),
            cache: 'no-store',
            signal: AbortSignal.timeout(route === 'resume' ? 50000 : 20000),
        });
        if (!response.headers.get('content-type')?.includes('application/json'))
            throw new Error('无法读取后台直出服务，请确认本地工坊仍在运行');
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error || 'HTTP ' + response.status);
        return data;
    }
    async function setAttention(action) {
        if (!attentionToken || attentionPending || (action === 'flash' && attentionActive)) return;
        attentionPending = true;
        try {
            const result = await request('attention', { action, token: attentionToken, ids: targetIds });
            attentionActive = action === 'flash' && result.attention === true;
        } catch (_) {
            // Taskbar flashing is optional; the paused job and Resume button remain usable.
            if (action === 'stop') attentionActive = false;
        } finally {
            attentionPending = false;
            if (action === 'flash' && attentionActive && (!pausedVisible || document.hasFocus()))
                void setAttention('stop');
        }
    }
    function syncAttention() {
        if (pausedVisible && !document.hasFocus()) void setAttention('flash');
        else if (attentionActive) void setAttention('stop');
    }
    window.addEventListener('focus', () => { if (attentionActive) void setAttention('stop'); });
    window.addEventListener('blur', () => { if (pausedVisible) void setAttention('flash'); });
    function relevantJobs(data) {
        const all = Array.isArray(data.jobs) ? data.jobs : [];
        if (targetSet.size) return all.filter(job => targetSet.has(job.id));
        const current = all.filter(job => !terminal.has(job.state));
        return [...current, ...all.filter(job => terminal.has(job.state)).slice(-3)];
    }
    function progressFor(job) {
        const p = job.progress || {};
        if (p.stage === 'render') {
            const ratio = p.storyTotal > 0 ? Math.min(0.99, Math.max(0, Number(p.storyCompleted || 0) / p.storyTotal)) : null;
            const seconds = Number(p.videoSeconds || 0).toFixed(1);
            return { ratio, text: (ratio == null ? '' : `剧情节点约 ${Math.floor(ratio * 100)}% · `)
                + `已生成 ${seconds} 秒 · ${Number(p.encodedFrames || 0)} 帧` };
        }
        if (p.stage === 'audio') {
            const ratio = p.total > 0 ? Math.min(1, Math.max(0, Number(p.completed || 0) / p.total)) : null;
            return { ratio, text: (p.audioPart || '正在处理音频') + (ratio == null ? '' : ` · ${Math.floor(ratio * 100)}%`) };
        }
        if (p.stage === 'preflight') return { ratio: null, text: `已检查 ${Number(p.resources || 0)} 项资源` };
        if (p.pressure === 'system-memory-pressure') return { ratio: null, text: '系统内存余量不足，暂时等待' };
        return { ratio: null, text: '' };
    }
    function renderJob(job) {
        const card = document.createElement('article'); card.className = 'job'; card.dataset.state = job.state;
        const head = document.createElement('div'); head.className = 'job-head';
        const title = document.createElement('strong'); title.className = 'job-title'; title.textContent = job.displayTitle || job.eventId;
        const stage = document.createElement('span'); stage.className = 'job-stage';
        stage.textContent = stages[job.stage] || stages[job.state] || job.stage || job.state;
        head.append(title, stage);
        const meta = document.createElement('p'); meta.className = 'job-meta';
        meta.textContent = [job.displayGroup, job.eventId, job.language === 'zh-cn' ? '汉化版' : '日文原版']
            .filter(Boolean).join(' · ');
        card.append(head, meta);
        const progress = progressFor(job);
        const pauseReason = job.state === 'paused' ? (job.pause?.reason || '系统内存安全预算不足，当前任务已暂停；清理内存后点击“继续任务”。') : '';
        if (progress.text || job.error || pauseReason) {
            const detail = document.createElement('p');
            detail.className = 'job-detail' + (job.error ? ' job-error' : pauseReason ? ' job-pause' : '');
            detail.textContent = job.error || pauseReason || progress.text;
            card.append(detail);
        }
        if (job.state === 'paused') {
            const actions = document.createElement('div'); actions.className = 'job-actions';
            const resume = document.createElement('button'); resume.type = 'button';
            resume.textContent = resuming.has(job.id) ? '正在复检…' : '继续任务';
            resume.disabled = resuming.has(job.id);
            resume.addEventListener('click', () => { void resumeJob(job.id); });
            actions.append(resume); card.append(actions);
        }
        if (!terminal.has(job.state) && !['pending', 'queued', 'paused'].includes(job.state)) {
            const bar = document.createElement('progress'); bar.max = 1;
            bar.setAttribute('aria-label', '当前阶段进度');
            if (progress.ratio !== null) bar.value = progress.ratio;
            card.append(bar);
        }
        return card;
    }
    async function resumeJob(id) {
        if (resuming.has(id)) return;
        resuming.add(id);
        if (lastData) render(lastData);
        try {
            const data = await request('resume', { id });
            render(data.jobs ? data : await request('jobs'));
            message(data.resumed === false ? (data.reason || '安全复检尚未通过，任务继续暂停。')
                : '已请求继续；后台会重新检查内存。', data.resumed === false ? 'error' : 'good');
        } catch (error) { message(error.message, 'error'); }
        finally { resuming.delete(id); if (lastData) render(lastData); }
    }
    function render(data) {
        lastData = data;
        const jobs = relevantJobs(data);
        const done = jobs.filter(job => job.state === 'complete').length;
        const failed = jobs.filter(job => ['failed', 'interrupted'].includes(job.state)).length;
        const running = jobs.filter(job => job.state === 'running' || job.state === 'cancelling').length;
        const queued = jobs.filter(job => job.state === 'queued').length;
        const paused = jobs.filter(job => job.state === 'paused').length;
        $('summary').textContent = `${jobs.length} 项任务 · ${running} 项运行中 · ${queued} 项排队 · ${done} 项完成`
            + (paused ? ` · ${paused} 项暂停` : '') + (failed ? ` · ${failed} 项失败` : '');
        pausedVisible = paused > 0;
        syncAttention();
        const container = $('jobs'); container.replaceChildren();
        if (!jobs.length) {
            const empty = document.createElement('p'); empty.className = 'muted';
            empty.textContent = targetSet.size ? '这批任务尚未出现在后台队列中，请稍候。' : '目前没有后台直出任务。';
            container.append(empty);
        } else jobs.forEach(job => container.append(renderJob(job)));
        const active = jobs.filter(job => !terminal.has(job.state) && job.state !== 'pending');
        const defaults = data.policyDefaults;
        const bounds = data.policyBounds;
        if (defaults && bounds) {
            for (const [id, key] of [['memory-limit', 'memoryMiB'], ['memory-reserve', 'reserveMiB']]) {
                const input = $(id), limit = bounds[key] || {};
                input.min = limit.min; input.max = limit.max;
                if (!editing && !saving) input.value = active.find(job => job.settings)?.settings?.[key] ?? defaults[key];
            }
        }
        const liveSettingsReady = Number(data.queueLimit) >= 50;
        $('memory-save').disabled = saving || !active.length || !defaults || !bounds || !liveSettingsReady;
        if (!liveSettingsReady) memoryStatus('运行中调整内存需要新版后台服务；请等当前任务结束后重启本地工坊。', 'error');
        else if (!active.length) memoryStatus('本批没有正在运行或排队的任务。');
        else if (!editing && !saving && $('memory-status').dataset.tone !== 'good')
            memoryStatus('可调整 ' + active.length + ' 项已启动或排队任务。');
    }
    for (const id of ['memory-limit', 'memory-reserve']) $(id).addEventListener('input', () => { editing = true; });
    $('memory-save').addEventListener('click', async () => {
        if (saving || !lastData) return;
        const jobs = relevantJobs(lastData).filter(job => !terminal.has(job.state) && job.state !== 'pending');
        const settings = { memoryMiB: Number($('memory-limit').value), reserveMiB: Number($('memory-reserve').value) };
        for (const [key, label] of [['memoryMiB', '进程上限'], ['reserveMiB', '系统保留']]) {
            const bounds = lastData.policyBounds?.[key];
            if (!bounds || !Number.isSafeInteger(settings[key]) || settings[key] < bounds.min || settings[key] > bounds.max) {
                memoryStatus(`${label}须为 ${bounds?.min ?? '?'}～${bounds?.max ?? '?'} MiB 的整数`, 'error'); return;
            }
        }
        if (!jobs.length) { memoryStatus('本批没有可调整的任务。', 'error'); return; }
        saving = true; $('memory-save').disabled = true; memoryStatus('正在更新内存设置…');
        try {
            const data = await request('settings', { ids: jobs.map(job => job.id), settings });
            editing = false; render(data.jobs ? data : await request('jobs'));
            memoryStatus('已更新。运行中任务将在下一次安全采样时采用，排队任务在启动前采用。', 'good');
        } catch (error) { memoryStatus(error.message, 'error'); }
        finally { saving = false; $('memory-save').disabled = !(Number(lastData.queueLimit) >= 50)
            || !relevantJobs(lastData).some(job => !terminal.has(job.state) && job.state !== 'pending'); }
    });
    async function poll() {
        if (stopped) return;
        if (!polling && !saving) {
            polling = true;
            try { render(await request('jobs')); message(''); }
            catch (error) { message(error.message, 'error'); }
            finally { polling = false; }
        }
        setTimeout(poll, document.hidden ? 7500 : 2500);
    }
    window.addEventListener('pagehide', () => { stopped = true; if (attentionActive) void setAttention('stop'); });
    void poll();
})();
