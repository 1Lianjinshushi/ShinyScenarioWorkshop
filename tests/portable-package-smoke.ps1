param([Parameter(Mandatory=$true)][string]$ZipPath, [int]$Port=18016)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('ssv-release-smoke-' + [Guid]::NewGuid().ToString('N'))
[IO.Compression.ZipFile]::ExtractToDirectory($ZipPath,$testRoot)
$package=(Get-ChildItem -LiteralPath $testRoot -Directory | Select-Object -First 1).FullName
$state=Get-Content -LiteralPath (Join-Path $package 'monitor/game-update-state.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach($collection in @('entries','metadata','cardResources')) {
    foreach($row in $state.$collection.PSObject.Properties) {
        foreach($field in @('staticCardSaved','dynamicCardSaved','staticCardSyncStatus','dynamicCardSyncStatus')) {
            if($row.Value.PSObject.Properties[$field]) { throw "Leaked local resource flag: $field" }
        }
    }
}
if (@($state.resourceRequests.PSObject.Properties).Count -or @($state.listenerStatus.PSObject.Properties).Count) { throw 'Live personal state leaked' }
$manifest=Get-Content -LiteralPath (Join-Path $package 'PACKAGE-CONTENTS.txt')
$actual=@(Get-ChildItem -LiteralPath $package -File -Recurse | ForEach-Object { $_.FullName.Substring($package.Length+1).Replace('\','/') })
if (Compare-Object $manifest $actual) { throw 'Package manifest does not match contents' }
foreach($forbidden in @('tools/ffmpeg.exe','tools/ffprobe.exe','config.json')) {
    if(Test-Path -LiteralPath (Join-Path $package $forbidden)) { throw "Unexpected private or unlicensed file: $forbidden" }
}
$args=@('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $package 'serve-viewer.ps1')+'"'),'-NoBrowser','-Port',[string]$Port)
$server=Start-Process powershell.exe -ArgumentList $args -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot 'server.log') -RedirectStandardError (Join-Path $testRoot 'server-error.log')
try {
    $base="http://127.0.0.1:$Port"
    $ready=$false
    for($i=0;$i -lt 40;$i++) {
        try { $response=Invoke-WebRequest "$base/app.html" -UseBasicParsing -TimeoutSec 2; $ready=$true; break } catch { Start-Sleep -Milliseconds 250 }
    }
    if(-not $ready) { throw 'Packaged server did not start' }
    if($response.Content -notmatch 'ShinyScenarioUpdateMonitor.user.js') { throw 'Install entry missing' }
    foreach($view in @('library','workbench','export','maintenance')) {
        if($response.Content -notmatch ('data-workspace-view="'+$view+'"')) { throw "Workspace view missing: $view" }
    }
    foreach($file in @('app-workspace.css','scripts/WorkspaceNavigation.js')) {
        $ui=Invoke-WebRequest "$base/$file" -UseBasicParsing -TimeoutSec 10
        if($ui.StatusCode -ne 200 -or $ui.RawContentLength -le 0) { throw "Missing layout file: $file" }
    }
    $script=Invoke-WebRequest "$base/scripts/ShinyScenarioUpdateMonitor.user.js" -UseBasicParsing
    if($script.Headers['Content-Type'] -ne 'application/javascript; charset=utf-8') { throw 'Userscript MIME/encoding incorrect' }
    if($script.Content -notmatch '@version\s+0.9.2') { throw 'Old userscript bundled' }
    foreach($route in @('scenario-library-labels','official-card-resource-requests','scenario-metadata?eventType=produce_events&eventId=200602001')) {
        $null=(Invoke-WebRequest "$base/api/$route" -UseBasicParsing -TimeoutSec 30).Content | ConvertFrom-Json
    }
    $runtime=Get-Content -LiteralPath (Join-Path $package 'portable-runtime-assets.json') -Raw | ConvertFrom-Json
    foreach($file in $runtime.files) {
        $resource=Invoke-WebRequest "$base/$file" -UseBasicParsing -TimeoutSec 10
        if($resource.StatusCode -ne 200 -or $resource.RawContentLength -le 0) { throw "Missing runtime file: $file" }
    }
    $node=Join-Path $package 'tools/node.exe'
    & $node --check (Join-Path $package 'experiments/offline-export/run.cjs')
    if($LASTEXITCODE) { throw 'Packaged Node runtime failed' }
    & $node -e "for(const name of ['queue','governor','profile','lease','memory-sampler','decoded-cache','verify']) require(process.argv[1]+'/'+name+'.cjs'); console.log('Export dependency graph OK')" (Join-Path $package 'experiments/offline-export')
    if($LASTEXITCODE) { throw 'Packaged export dependencies failed' }
    & $node -e "const p=require(process.argv[1]); if(!p.chromium) process.exit(1); console.log('Playwright import OK')" (Join-Path $package 'tools/node_modules/playwright')
    if($LASTEXITCODE) { throw 'Packaged Playwright runtime failed' }
    Write-Output "PASS: extracted ZIP, clean state, $($actual.Count) manifest files, $($runtime.files.Count) runtime assets, UTF-8 userscript, API routes and bundled Node/Playwright"
} finally {
    if(-not $server.HasExited) { Stop-Process -Id $server.Id }
}
