'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function safeRelative(relative) {
    if (typeof relative !== 'string' || !relative.startsWith('assets/') || /[\\?#\x00]/.test(relative)
        || relative.split('/').some(p => !p || p === '.' || p === '..')) throw new Error(`Invalid resource path: ${relative}`);
    return relative;
}
function dependency(parent, child) {
    if (typeof child !== 'string' || child.startsWith('/') || /[:\\?#]/.test(child) || child.split('/').includes('..'))
        throw new Error(`Invalid dependency in ${parent}: ${child}`);
    return safeRelative(path.posix.join(path.posix.dirname(parent), child));
}
function inspect(file, relative) {
    const size = fs.statSync(file).size;
    if (!size || size > 512 * 1024 * 1024) throw new Error(`Empty/oversized resource: ${relative}`);
    const fd = fs.openSync(file, 'r'), head = Buffer.alloc(Math.min(size, 256));
    try { fs.readSync(fd, head); } finally { fs.closeSync(fd); }
    if (/^\s*(?:<!doctype|<html)/i.test(head.toString())) throw new Error('HTML error page instead of resource');
    const ext = path.extname(relative).toLowerCase();
    if (ext === '.png' && !head.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Invalid PNG signature');
    if (ext === '.png' && (head.length < 24 || !head.readUInt32BE(16) || !head.readUInt32BE(20)
        || head.readUInt32BE(16) * head.readUInt32BE(20) > 16777216)) throw new Error('Unsupported PNG dimensions');
    if (['.mp4', '.m4a'].includes(ext) && head.subarray(4, 8).toString() !== 'ftyp') throw new Error('Invalid MP4/M4A container');
    const deps = [];
    if (ext === '.json') {
        if (size > 64 * 1024 * 1024) throw new Error('Oversized JSON');
        const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        if (!data || typeof data !== 'object') throw new Error('Invalid resource JSON');
        const images = data.meta?.image;
        for (const image of images ? (Array.isArray(images) ? images : [images]) : []) deps.push(dependency(relative, image));
        if (/\/data\.json$/.test(relative)) {
            if (!Array.isArray(data.bones) || !data.bones.length) throw new Error('Spine JSON missing bones');
            deps.push(relative.replace(/data\.json$/, 'data.atlas'));
        }
    }
    if (ext === '.atlas') {
        if (size > 4 * 1024 * 1024) throw new Error('Oversized atlas');
        const pages = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => /^[^\s].*\.(png|jpg|webp)\s*$/i.test(l));
        if (!pages.length) throw new Error('Spine atlas has no texture pages');
        for (const image of pages) deps.push(dependency(relative, image.trim()));
    }
    return { bytes: size, dependencies: deps };
}
async function hashFile(file) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}
class Preflight {
    constructor({ resolve, acquire, checkpoint = async () => {} }) {
        this.resolve = resolve; this.acquire = acquire; this.checkpoint = checkpoint;
        this.inventory = new Map(); this.seen = new Set(); this.failures = []; this.stages = []; this.finished = false;
    }
    async ensure(relative) {
        if (this.seen.has(relative)) return;
        this.seen.add(relative);
        await this.checkpoint();
        try {
            safeRelative(relative);
            let file = this.resolve(relative), source = 'existing local player cache';
            if (!fs.existsSync(file)) ({ file, source } = await this.acquire(relative));
            const details = inspect(file, relative);
            this.inventory.set(relative, { file, source, bytes: details.bytes, sha256: await hashFile(file) });
            // A bad child must not prevent checking the other children/resources.
            for (const child of details.dependencies) await this.ensure(child);
        } catch (error) { this.failures.push({ resource: relative, stage: 'resource', error: error.message }); }
    }
    async stage(resource, name, action) {
        await this.checkpoint();
        try { const result = await action(); this.stages.push({ resource, stage: name, ok: true }); return result; }
        catch (error) { this.failures.push({ resource, stage: name, error: error.message }); }
    }
    report() { return { ok: this.finished && !this.failures.length,
        status: this.failures.length ? 'failed' : this.finished ? 'passed' : 'incomplete',
        resources: this.inventory.size, failures: this.failures, stages: this.stages }; }
    assert() {
        if (this.failures.length) throw new Error(`导出前检查未通过（${this.failures.length} 项）：\n`
            + this.failures.map(f => `${f.resource} [${f.stage}] ${f.error}`).join('\n'));
    }
}
module.exports = { safeRelative, dependency, inspect, hashFile, Preflight };
