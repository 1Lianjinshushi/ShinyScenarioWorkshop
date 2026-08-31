'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const player = fs.readFileSync(path.join(root, 'remote-main.js'), 'utf8');
const pythonServer = fs.readFileSync(path.join(root, 'serve-viewer.py'), 'utf8');
const powershellServer = fs.readFileSync(path.join(root, 'serve-viewer.ps1'), 'utf8');

assert.match(app, /startScenarioResourceCache\(\{ automatic: true \}\)/,
    'loading a scenario must begin background caching automatically');
assert.match(app, /playerUrl\('cn', 'hybrid'\)/,
    'translated playback must use the hybrid local-first mode');
assert.match(app, /playerUrl\('cn', 'hybrid', 'edit'\)/,
    'editing playback must use the hybrid local-first mode');
assert.match(app, /Promise\.race\(\[\s*startScenarioResourceCache/,
    'playback must not wait indefinitely for background caching');
assert.match(app, /fetchResourceBytes\(`\$\{REMOTE_ROOT\}\/\$\{encodedPath\}`\)/,
    'background downloads must use the bounded retry helper');

assert.match(player, /async function ssvResolveResourceSources/);
assert.match(player, /\.\/api\/resource-cache-status/,
    'the player must query the local cache in one batch');
assert.match(player, /sources\.set\(url, ssvJoinUrl\(SSV_LOCAL_ASSET_ROOT/,
    'cached remote resource keys must resolve to local files');
assert.match(player, /ssvSpineCompanionPaths/,
    'Spine JSON must be used locally only when its atlas and texture are present');
assert.match(player, /\['local', 'remote', 'hybrid'\]/);

assert.match(pythonServer, /parsed\.path == "\/api\/resource-cache-status"/);
assert.match(powershellServer, /\$Request\.Path -eq '\/api\/resource-cache-status'/);

console.log('resource-cache-regression: PASS');
