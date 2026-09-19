'use strict';
function exportLanguage(explicit, inputFile = '') {
    const value = String(explicit || '').toLowerCase();
    if (['cn', 'zh', 'zh-cn', 'zh_cn'].includes(value)) return 'cn';
    if (['ja', 'jp'].includes(value)) return 'ja';
    if (value) throw new Error('Unsupported export language: ' + value);
    return /\.zh-cn\.json$/i.test(inputFile) ? 'cn' : 'ja';
}
module.exports = { exportLanguage };
