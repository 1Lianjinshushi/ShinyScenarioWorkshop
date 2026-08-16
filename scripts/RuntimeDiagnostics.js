'use strict';

window.addEventListener('load', () => {
    let checks = 0;
    const timer = setInterval(() => {
        checks++;
        const info = window.__scenarioLoadInfo;
        if (info) {
            clearInterval(timer);
            const report = info.translationReport;
            const translation = report ? `${report.applied}/${report.total}` : 'none';
            console.info(`[runtime] ready source=${info.source} translation=${translation} failedResources=${info.failedResources.length}`);
            return;
        }
        if (checks >= 120) {
            clearInterval(timer);
            console.warn('[runtime] scenario did not reach the ready overlay within 30 seconds');
        }
    }, 250);
}, { once: true });
