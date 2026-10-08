'use strict';
const cp = require('node:child_process');
const os = require('node:os');

// One private, hidden process per worker. Only numeric PIDs cross stdin; no
// caller-supplied commands, paths or scripts are evaluated by PowerShell.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
while ($null -ne ($line = [Console]::ReadLine())) {
    $requestId = 0
    try {
        $request = $line | ConvertFrom-Json
        $requestId = [int]$request.id
        $sum = 0L; $count = 0; $rootRead = $false
        foreach ($pidValue in $request.pids) {
            $p = $null
            try {
                $p = [System.Diagnostics.Process]::GetProcessById([int]$pidValue)
                $sum += $p.PrivateMemorySize64
                $count++
                if ([int]$pidValue -eq [int]$request.rootPid) { $rootRead = $true }
            } catch { } finally { if ($null -ne $p) { $p.Dispose() } }
        }
        if (-not $rootRead -or $sum -le 0) { throw 'Cannot read export process memory' }
        [Console]::WriteLine((@{id=$requestId;bytes=$sum;count=$count} | ConvertTo-Json -Compress))
    } catch {
        [Console]::WriteLine((@{id=$requestId;error='Cannot read export process memory'} | ConvertTo-Json -Compress))
    }
}`;

class ProcessMemorySampler {
    constructor({ spawn = cp.spawn, timeoutMs = 10000 } = {}) {
        this.spawn = spawn; this.timeoutMs = timeoutMs;
        this.child = null; this.pending = null; this.sequence = 0; this.closed = false;
        this.buffer = ''; this.failure = null;
    }
    get pid() { return this.child?.pid; }
    start() {
        if (this.closed) throw new Error('Memory sampler is closed');
        if (this.failure) throw this.failure;
        if (this.child) return;
        const child = this.spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', SCRIPT],
            { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        this.child = child;
        try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (_) {}
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => {
            this.buffer += chunk;
            if (this.buffer.length > 65536) return this.fail(new Error('Invalid memory sampler response'));
            let end;
            while ((end = this.buffer.indexOf('\n')) !== -1) {
                const line = this.buffer.slice(0, end).trim(); this.buffer = this.buffer.slice(end + 1);
                if (!line) continue;
                let data;
                try { data = JSON.parse(line); } catch (_) { return this.fail(new Error('Invalid memory sampler response')); }
                const pending = this.pending;
                if (!pending || data.id !== pending.id || data.error || !Number.isSafeInteger(data.bytes) || data.bytes <= 0
                    || !Number.isInteger(data.count) || data.count < 1 || data.count > pending.count)
                    return this.fail(new Error(data.error || 'Invalid memory sampler response'));
                this.pending = null; clearTimeout(pending.timer); pending.resolve(data.bytes);
            }
        });
        // Drain stderr without retaining unbounded subprocess output.
        child.stderr.on('data', () => {});
        child.stdin.on('error', () => this.fail(new Error('Memory sampler input closed')));
        child.on('error', () => this.fail(new Error('Unable to start memory sampler')));
        child.once('exit', () => {
            if (!this.closed) this.fail(new Error('Memory sampler exited before export completed'));
        });
    }
    fail(error) {
        this.failure ||= error;
        if (this.pending) {
            const pending = this.pending; this.pending = null;
            clearTimeout(pending.timer); pending.reject(this.failure);
        }
        // Only our own helper is stopped, never browser/FFmpeg/user processes.
        this.child?.kill();
    }
    sample(pids, rootPid = process.pid) {
        if (!Array.isArray(pids) || pids.length > 1024 || !pids.includes(rootPid)
            || pids.some(pid => !Number.isSafeInteger(pid) || pid <= 0 || pid > 2147483647))
            return Promise.reject(new Error('Invalid memory sampler PIDs'));
        if (this.pending) return Promise.reject(new Error('Memory sample already in progress'));
        try { this.start(); } catch (error) { return Promise.reject(error); }
        const ids = [...new Set([...pids, this.child.pid])];
        return new Promise((resolve, reject) => {
            const id = ++this.sequence;
            const timer = setTimeout(() => this.fail(new Error('Memory sampler timed out; safety sample unavailable')), this.timeoutMs);
            this.pending = { id, count: ids.length, resolve, reject, timer };
            this.child.stdin.write(JSON.stringify({ id, rootPid, pids: ids }) + '\n', error => {
                if (error) this.fail(new Error('Memory sampler input failed'));
            });
        });
    }
    async close() {
        if (this.closed) return;
        this.closed = true;
        if (this.pending) {
            const pending = this.pending; this.pending = null;
            clearTimeout(pending.timer); pending.reject(new Error('Memory sampler closed'));
        }
        const child = this.child;
        if (!child || child.exitCode != null || child.signalCode != null) return;
        await new Promise(resolve => {
            const timer = setTimeout(() => { child.kill(); resolve(); }, 1500);
            child.once('exit', () => { clearTimeout(timer); resolve(); });
            child.stdin.end();
        });
    }
}
module.exports = { ProcessMemorySampler };
