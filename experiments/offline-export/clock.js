'use strict';

// Test-only clock. Loaded before GSAP/PIXI; never imported by the workshop.
class ExportClock {
    constructor() { this.ms = 0; this.sequence = 0; this.timers = new Map(); }
    setTimeout(fn, delay = 0, ...args) {
        const id = ++this.sequence;
        this.timers.set(id, { at: this.ms + Math.max(0, Number(delay) || 0), fn, args });
        return id;
    }
    clearTimeout(id) { this.timers.delete(id); }
    advanceTo(ms) {
        if (ms < this.ms) throw new Error('Export time cannot run backwards');
        let count = 0;
        while (true) {
            let next = null;
            for (const [id, timer] of this.timers) {
                if (timer.at <= ms && (!next || timer.at < next[1].at)) next = [id, timer];
            }
            if (!next) break;
            if (++count > 10000) throw new Error('Export timer loop');
            this.ms = next[1].at;
            this.timers.delete(next[0]);
            next[1].fn(...next[1].args);
        }
        this.ms = ms;
    }
}
if (typeof module !== 'undefined') module.exports = { ExportClock };
if (typeof window !== 'undefined') {
    window.exportClock = new ExportClock();
    window.exportNative = {
        now: performance.now.bind(performance), date: Date.now.bind(Date),
        timeout: setTimeout.bind(window), clearTimeout: clearTimeout.bind(window),
        raf: requestAnimationFrame.bind(window),
    };
    window.exportOffline = new URLSearchParams(location.search).get('clock') !== 'realtime';
    if (exportOffline) {
        Date.now = () => 1700000000000 + exportClock.ms;
        performance.now = () => exportClock.ms;
    }
}
