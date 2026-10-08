'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashFile } = require('./preflight.cjs');
const { withLease } = require('./lease.cjs');
const ENTRY = /^[a-f0-9]{16}-(pcm|movie)-[a-f0-9]{64}(?:\.partial-[a-f0-9-]+)?$/;
const FILE = /^(?:manifest\.json|audio\.f32|audio\.json|complete\.json|\d{6}\.png)$/;
const DEFAULT_BYTES = 2 * 1024 ** 3;

function noLinks(file) {
    for (let current = path.resolve(file);;) {
        let stat;
        try { stat = fs.lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (stat?.isSymbolicLink()) throw new Error('Cache path contains a link');
        const parent = path.dirname(current);
        if (parent === current) return;
        current = parent;
    }
}
function regular(file) {
    noLinks(file);
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new Error('Cache file is not regular');
    return stat;
}
function validNames(kind, names) {
    const sorted = [...names].sort();
    if (new Set(names).size !== names.length) return false;
    if (kind === 'pcm') return sorted.join(',') === 'audio.f32,audio.json';
    return kind === 'movie' && names.length >= 2 && names.length <= 10001
        && sorted.at(-1) === 'complete.json'
        && sorted.slice(0, -1).every((name, i) => name === `${String(i).padStart(6, '0')}.png`);
}

// Disposable, verified disk cache, not a replacement for original resources.
// A cross-process lease serializes validation, copies, publication and eviction. Job-owned copies
// mean cache eviction never removes data used by a rendering/mixing job.
class DecodedCache {
    constructor(root, namespace, checkpoint = async () => {}, maxBytes = DEFAULT_BYTES, waitHooks = {}) {
        if (!/^[a-f0-9]{16}$/.test(namespace) || !Number.isSafeInteger(maxBytes) || maxBytes < 1)
            throw new Error('Invalid decoded cache settings');
        this.root = path.resolve(root); this.namespace = namespace;
        this.checkpoint = checkpoint; this.maxBytes = maxBytes; this.checkpointErrors = new Set();
        this.verified = new Set();
        this.waitHooks = waitHooks;
        this.stats = { hits: 0, misses: 0, invalid: 0, published: 0, evicted: 0, skipped: 0, maxBytes };
    }
    async check() {
        try { await this.checkpoint(); }
        catch (error) { this.checkpointErrors.add(error); throw error; }
    }
    fallback(error) { if (this.checkpointErrors.has(error)) throw error; this.stats.skipped++; return false; }
    entry(kind, key) {
        if (!['pcm', 'movie'].includes(kind) || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid decoded cache key');
        return path.join(this.root, `${this.namespace}-${kind}-${key}`);
    }
    inspect(dir) {
        noLinks(dir);
        if (path.dirname(dir) !== this.root || !ENTRY.test(path.basename(dir)) || !fs.lstatSync(dir).isDirectory())
            throw new Error('Unsafe decoded cache entry');
        const files = fs.readdirSync(dir);
        if (files.some(name => !FILE.test(name))) throw new Error('Unknown cache contents');
        return files.map(name => ({ name, file: path.join(dir, name), stat: regular(path.join(dir, name)) }));
    }
    remove(dir) {
        const files = this.inspect(dir); // Validate all targets before deleting any.
        for (const file of files) fs.unlinkSync(file.file);
        fs.rmdirSync(dir);
        this.verified.delete(dir);
    }
    async locked(work) {
        noLinks(this.root);
        fs.mkdirSync(this.root, { recursive: true });
        return withLease(path.join(this.root, '.cache.lock'), () => this.check(), work, this.waitHooks);
    }
    async restore(kind, key, targets) {
        try { return await this.locked(() => this.restoreLocked(kind, key, targets)); }
        catch (error) { return this.fallback(error); }
    }
    async restoreLocked(kind, key, targets) {
        const dir = this.entry(kind, key);
        this.verified.delete(dir);
        try {
            await this.check();
            if (!fs.existsSync(dir)) { this.stats.misses++; return false; }
            const actual = this.inspect(dir);
            const manifestFile = path.join(dir, 'manifest.json');
            if (regular(manifestFile).size > 2 * 1024 ** 2) throw new Error('Cache manifest too large');
            const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
            if (manifest.version !== 1 || manifest.kind !== kind || manifest.key !== key
                || manifest.namespace !== this.namespace || !Array.isArray(manifest.files)
                || !validNames(kind, manifest.files.map(f => f.name)) || actual.length !== manifest.files.length + 1)
                throw new Error('Invalid cache manifest');
            const mappings = manifest.files.map(f => {
                const target = typeof targets === 'string' ? path.join(targets, f.name) : targets[f.name];
                if (!target || !Number.isSafeInteger(f.bytes) || f.bytes < 1 || !/^[a-f0-9]{64}$/.test(f.sha256))
                    throw new Error('Invalid cache mapping');
                noLinks(target);
                if (fs.existsSync(target)) regular(target);
                return { ...f, target };
            });
            if (mappings.reduce((n, f) => n + f.bytes, 0) > this.maxBytes) throw new Error('Cache entry exceeds budget');
            for (const f of mappings) {
                await this.check();
                const source = path.join(dir, f.name);
                if (regular(source).size !== f.bytes || await hashFile(source) !== f.sha256) throw new Error('Corrupt decoded cache');
            }
            // Completion marker is always copied last. A cancelled/failed copy
            // cannot be mistaken for a complete job-local cache on restart.
            const marker = kind === 'pcm' ? 'audio.json' : 'complete.json';
            const markerTarget = mappings.find(f => f.name === marker).target;
            if (fs.existsSync(markerTarget)) fs.unlinkSync(markerTarget);
            for (const f of mappings.sort((a, b) => Number(a.name === marker) - Number(b.name === marker))) {
                await this.check();
                fs.mkdirSync(path.dirname(f.target), { recursive: true });
                await fs.promises.copyFile(path.join(dir, f.name), f.target);
            }
            const now = new Date(); fs.utimesSync(dir, now, now);
            this.verified.add(dir);
            this.stats.hits++; return true;
        } catch (error) {
            if (this.checkpointErrors.has(error)) throw error;
            this.stats.invalid++; return false;
        }
    }
    async publish(kind, key, sources) {
        try { return await this.locked(() => this.publishLocked(kind, key, sources)); }
        catch (error) { return this.fallback(error); }
    }
    async publishLocked(kind, key, sources) {
        const dir = this.entry(kind, key);
        const partial = dir + '.partial-' + crypto.randomUUID();
        let created = false;
        try {
            await this.check(); noLinks(this.root);
            fs.mkdirSync(this.root, { recursive: true });
            const names = Object.keys(sources);
            if (!validNames(kind, names)) throw new Error('Incomplete decoded cache inventory');
            const size = names.reduce((n, name) => n + regular(sources[name]).size, 0);
            const allowance = size + 1024 + names.length * 160;
            if (allowance > this.maxBytes) { this.stats.skipped++; return false; }
            const disk = fs.statfsSync(this.root, { bigint: true });
            if (disk.bavail * disk.bsize < BigInt(allowance + 512 * 1024 ** 2)) { this.stats.skipped++; return false; }
            // Recheck identity: another process may have evicted/replaced the
            // entry since this instance last restored it.
            if (this.verified.has(dir) && fs.existsSync(dir)) {
                const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
                if (manifest.files?.length === names.length && this.inspect(dir).length === names.length + 1) {
                    let valid = true;
                    for (const name of names) {
                        const record = manifest.files.find(f => f.name === name);
                        if (!record || regular(path.join(dir, name)).size !== record.bytes
                            || await hashFile(path.join(dir, name)) !== record.sha256) { valid = false; break; }
                    }
                    if (valid) return true;
                }
            }
            if (fs.existsSync(dir)) this.remove(dir);
            const entries = [];
            for (const name of fs.readdirSync(this.root)) {
                if (!ENTRY.test(name)) continue;
                const entry = path.join(this.root, name), files = this.inspect(entry);
                entries.push({ dir: entry, bytes: files.reduce((n, f) => n + f.stat.size, 0), time: fs.statSync(entry).mtimeMs });
            }
            let used = entries.reduce((n, e) => n + e.bytes, 0);
            for (const entry of entries.sort((a, b) => a.time - b.time)) {
                if (used + allowance <= this.maxBytes) break;
                await this.check(); this.remove(entry.dir); used -= entry.bytes; this.stats.evicted++;
            }
            fs.mkdirSync(partial); created = true;
            const manifest = { version: 1, namespace: this.namespace, kind, key, files: [] };
            for (const name of names) {
                await this.check();
                const target = path.join(partial, name);
                await fs.promises.copyFile(sources[name], target);
                manifest.files.push({ name, bytes: regular(target).size, sha256: await hashFile(target) });
            }
            fs.writeFileSync(path.join(partial, 'manifest.json'), JSON.stringify(manifest));
            fs.renameSync(partial, dir); created = false;
            this.verified.add(dir);
            this.stats.published++; return true;
        } catch (error) { return this.fallback(error); }
        finally { if (created) { try { this.remove(partial); } catch (_) {} } }
    }
}
module.exports = { DecodedCache, DEFAULT_BYTES, validNames };
