param(
    [string]$Version = '20261007-r16',
    [string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'release'),
    [string]$NodeExecutable = 'C:\Users\Lenovo\AppData\Local\Programs\nodejs-v24.20.0\node.exe',
    [string]$NodeLicense = 'C:\Users\Lenovo\AppData\Local\Programs\nodejs-v24.20.0\LICENSE',
    [string]$PlaywrightModules = 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules',
    [string]$FFmpegDirectory = 'D:\ffmpeg',
    [switch]$BundleOfflineRuntime
)

$ErrorActionPreference = 'Stop'
$SourceRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$OutputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$PackageName = "ShinyScenarioViewer-Portable-$Version"
$PackageRoot = Join-Path $OutputRoot $PackageName
$ZipPath = Join-Path $OutputRoot "$PackageName.zip"
$Utf8 = New-Object Text.UTF8Encoding($false)

if ($Version -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw "Unsafe package version: $Version" }
if ($Version -eq '20260907-r12') { throw 'The published r12 package must never be replaced.' }
foreach ($existing in @($PackageRoot, $ZipPath, "$ZipPath.sha256.txt")) {
    if ([IO.File]::Exists($existing) -or [IO.Directory]::Exists($existing)) {
        throw "Package target already exists; choose a new version or output directory: $existing"
    }
}

function Assert-ExternalFile([string]$Path, [string]$Label) {
    if (-not [IO.Path]::IsPathRooted($Path) -or -not [IO.File]::Exists($Path)) {
        throw "Missing trusted local $Label source: $Path"
    }
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Length -le 0 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Invalid trusted local $Label source: $Path"
    }
}

function Assert-ExternalDirectory([string]$Path, [string]$Label, [bool]$InspectChildren = $true) {
    if (-not [IO.Path]::IsPathRooted($Path) -or -not [IO.Directory]::Exists($Path)) {
        throw "Missing trusted local $Label source: $Path"
    }
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Linked trusted local $Label source is not allowed: $Path"
    }
    if ($InspectChildren -and (Get-ChildItem -LiteralPath $Path -Recurse -Force -Attributes ReparsePoint | Select-Object -First 1)) {
        throw "Linked content in trusted local $Label source is not allowed: $Path"
    }
}

Assert-ExternalFile $NodeExecutable 'Node.js executable'
Assert-ExternalFile $NodeLicense 'Node.js license'
Assert-ExternalDirectory $PlaywrightModules 'Playwright modules' $false
foreach ($name in @('playwright', 'playwright-core')) {
    Assert-ExternalDirectory (Join-Path $PlaywrightModules $name) "$name package"
    Assert-ExternalFile (Join-Path (Join-Path $PlaywrightModules $name) 'package.json') "$name manifest"
    Assert-ExternalFile (Join-Path (Join-Path $PlaywrightModules $name) 'LICENSE') "$name license"
}
$playwrightPackage = Get-Content -LiteralPath (Join-Path $PlaywrightModules 'playwright\package.json') -Raw | ConvertFrom-Json
$playwrightCorePackage = Get-Content -LiteralPath (Join-Path $PlaywrightModules 'playwright-core\package.json') -Raw | ConvertFrom-Json
if ($playwrightPackage.dependencies.'playwright-core' -ne $playwrightCorePackage.version) {
    throw 'Playwright and playwright-core versions do not match.'
}
if ($BundleOfflineRuntime) {
    Assert-ExternalDirectory $FFmpegDirectory 'FFmpeg distribution' $false
    foreach ($name in @('ffmpeg.exe', 'ffprobe.exe')) {
        Assert-ExternalFile (Join-Path (Join-Path $FFmpegDirectory 'bin') $name) "$name executable"
    }
    foreach ($name in @('LICENSE', 'README.txt')) {
        Assert-ExternalFile (Join-Path $FFmpegDirectory $name) "FFmpeg $name"
    }
}

function Copy-RequiredFile([string]$RelativePath, [string]$DestinationRelativePath = '') {
    $source = Join-Path $SourceRoot $RelativePath
    if (-not [IO.File]::Exists($source)) { throw "Missing package file: $RelativePath" }
    if (-not $DestinationRelativePath) { $DestinationRelativePath = $RelativePath }
    $destination = Join-Path $PackageRoot $DestinationRelativePath
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
}

function Copy-RequiredDirectory([string]$RelativePath, [string[]]$ExcludedNames = @()) {
    $source = Join-Path $SourceRoot $RelativePath
    if (-not [IO.Directory]::Exists($source)) { throw "Missing package directory: $RelativePath" }
    $destination = Join-Path $PackageRoot $RelativePath
    [IO.Directory]::CreateDirectory($destination) | Out-Null
    Get-ChildItem -LiteralPath $source -Force | Where-Object {
        $ExcludedNames -notcontains $_.Name
    } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
    }
}

function Copy-ExternalFile([string]$SourcePath, [string]$DestinationRelativePath) {
    $destination = Join-Path $PackageRoot $DestinationRelativePath
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
    Copy-Item -LiteralPath $SourcePath -Destination $destination
}

function Copy-ExternalDirectory([string]$SourcePath, [string]$DestinationRelativePath) {
    $destination = Join-Path $PackageRoot $DestinationRelativePath
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
    Copy-Item -LiteralPath $SourcePath -Destination $destination -Recurse
}

function Write-PackageText([string]$RelativePath, [string]$Text) {
    $destination = Join-Path $PackageRoot $RelativePath
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
    [IO.File]::WriteAllText($destination, $Text, $Utf8)
}

[IO.Directory]::CreateDirectory($OutputRoot) | Out-Null
[IO.Directory]::CreateDirectory($PackageRoot) | Out-Null

$files = @(
    '.gitignore',
    'app-related.css', 'app.css', 'app.html', 'app.js', 'offline-progress.html',
    'CHANGELOG.md',
    'config.example.json',
    'DISTRIBUTION-NOTICE.md',
    'index.html', 'index.local-only.html',
    'LICENSE',
    'main.css', 'main.js',
    'portable-runtime-assets.json',
    'README.md', 'README.upstream.md',
    'SHARING-GUIDE-ZH.md',
    'remote-main.js',
    'serve-viewer.py', 'serve-viewer.ps1',
    'offline_export_bridge.py', 'offline-export-bridge.ps1',
    'THIRD-PARTY-NOTICES.md',
    'UPSTREAM-ATTRIBUTION.md'
)
foreach ($file in $files) { Copy-RequiredFile $file }
foreach ($directory in @('lib', 'speaker', 'metadata', 'monitor')) { Copy-RequiredDirectory $directory }
Copy-RequiredDirectory 'scripts'

# Only the production worker dependency graph belongs in a portable build.
# The experiment README, local diagnostics, proof runners, and developer paths
# are intentionally excluded.
$offlineRuntimeFiles = @(
    'audio-master.js', 'audio-merge.cjs', 'bridge.cjs', 'cleanup.cjs',
    'clock.js', 'flow.js', 'governor.cjs', 'language.cjs', 'movies.js',
    'naming.cjs', 'page.js', 'preflight.cjs', 'profile.cjs', 'queue.cjs',
    'run.cjs', 'service.cjs'
)
foreach ($file in $offlineRuntimeFiles) { Copy-RequiredFile "experiments/offline-export/$file" }

Copy-ExternalFile $NodeExecutable 'tools/node.exe'
Copy-ExternalFile $NodeLicense 'tools/licenses/node-LICENSE.txt'
foreach ($name in @('playwright', 'playwright-core')) {
    Copy-ExternalDirectory (Join-Path $PlaywrightModules $name) "tools/node_modules/$name"
}
if ($BundleOfflineRuntime) {
    Copy-ExternalFile (Join-Path $FFmpegDirectory 'bin\ffmpeg.exe') 'tools/ffmpeg.exe'
    Copy-ExternalFile (Join-Path $FFmpegDirectory 'bin\ffprobe.exe') 'tools/ffprobe.exe'
    Copy-ExternalFile (Join-Path $FFmpegDirectory 'LICENSE') 'tools/licenses/ffmpeg-LICENSE.txt'
    Copy-ExternalFile (Join-Path $FFmpegDirectory 'README.txt') 'tools/licenses/ffmpeg-README.txt'
}

# Keep the public resource-library/update-log baseline while removing the
# developer machine's live listener status, pending official-resource queue,
# unread markers and any old snapshot-only flag. Each recipient starts clean,
# then the bundled userscript can maintain that recipient's own live state.
$portableMonitorStatePath = Join-Path $PackageRoot 'monitor\game-update-state.json'
if ([IO.File]::Exists($portableMonitorStatePath)) {
    $portableMonitorState = Get-Content -LiteralPath $portableMonitorStatePath -Raw | ConvertFrom-Json
    if ($portableMonitorState.entries) {
        foreach ($entry in $portableMonitorState.entries.PSObject.Properties) {
            if ($entry.Value.PSObject.Properties['unread']) { $entry.Value.unread = $false }
        }
    }
    foreach ($collectionName in @('entries', 'metadata', 'cardResources')) {
        foreach ($entry in $portableMonitorState.$collectionName.PSObject.Properties) {
            foreach ($field in @('staticCardSyncStatus', 'dynamicCardSyncStatus', 'staticCardSaved', 'dynamicCardSaved')) {
                $entry.Value.PSObject.Properties.Remove($field)
            }
        }
    }
    $portableMonitorState.listenerStatus = [PSCustomObject]@{}
    $portableMonitorState.resourceRequests = [PSCustomObject]@{}
    $portableMonitorState.lastEnrichmentAt = ''
    $portableMonitorState.enrichmentStatus = [PSCustomObject]@{}
    $portableMonitorState.PSObject.Properties.Remove('portableSnapshot')
    [IO.File]::WriteAllText(
        $portableMonitorStatePath,
        (($portableMonitorState | ConvertTo-Json -Depth 100 -Compress) + "`n"),
        $Utf8
    )
}

$runtimeManifestPath = Join-Path $SourceRoot 'portable-runtime-assets.json'
$runtimeManifest = Get-Content -LiteralPath $runtimeManifestPath -Raw | ConvertFrom-Json
if (-not $runtimeManifest.files -or $runtimeManifest.files.Count -eq 0) {
    throw 'portable-runtime-assets.json does not contain any runtime files.'
}
foreach ($required in @('fonts/AlimamaShuHeiTi.ttf', 'assets/images/event/text_frame/016.png', 'assets/images/event/log_text_frame/016.png')) {
    if ($runtimeManifest.files -cnotcontains $required) { throw "Required portable runtime asset missing from manifest: $required" }
}
foreach ($runtimeFile in $runtimeManifest.files) {
    $relativePath = [string]$runtimeFile
    if ([IO.Path]::IsPathRooted($relativePath) -or $relativePath -match '(^|[\\/])\.\.([\\/]|$)') {
        throw "Unsafe runtime asset path: $relativePath"
    }
    Copy-RequiredFile $relativePath
}

Copy-RequiredFile 'start-portable.cmd' 'start-viewer.cmd'
Copy-RequiredFile 'output\pdf\ShinyScenarioWorkshop-Quick-Guide.pdf' 'Quick-Guide-ZH.pdf'
Copy-RequiredFile 'output\pdf\ShinyScenarioWorkshop-Offline-Export-Guide.pdf' 'Offline-Export-Guide-ZH.pdf'

$offlineToolNotice = if ($BundleOfflineRuntime) {
    'FFmpeg and FFprobe are also bundled in tools/ for experimental background export.'
} else {
    'FFmpeg and FFprobe are NOT bundled. Experimental background export needs a user-supplied compatible FFmpeg/FFprobe installation.'
}

$portableAppHtmlPath = Join-Path $PackageRoot 'app.html'

Write-PackageText 'PORTABLE-README.txt' @"
Shiny Scenario Workshop Portable Edition $Version

1. Extract the ZIP completely. Do not run it inside the ZIP preview window.
2. Double-click start-viewer.cmd.
3. Your browser opens http://127.0.0.1:8000/app.html automatically.
4. Enter the scenario category and event ID, import one or more translated CSV files, or choose a story from the included resource library.
   The workshop can fetch resources, play the Japanese original, merge translations, and open the editing mode.
   Loading a scenario starts a background local cache automatically. Playback uses local files first and downloads only missing resources.
   If a Support-card still is missing upstream, select a local game screenshot in the repair panel.
5. The resource library baseline and the game-update userscript are included. Install Tampermonkey first, then use the workshop's Install/Update Listener Script button and open the game once to establish this computer's baseline.
6. Keep both the workshop server and the game tab running when official game-session resource checks are needed.
7. Close the server window to stop the application.

For a short illustrated Chinese guide and the version maintenance log, open Quick-Guide-ZH.pdf in this folder.
For FFmpeg/FFprobe setup and background video export, open Offline-Export-Guide-ZH.pdf.
For sharing, first launch and upgrading without losing cached resources, open SHARING-GUIDE-ZH.md.

No Python installation is required. This launcher uses Windows PowerShell included with Windows 10/11.
The player foundation is self-contained: the required fonts, common UI atlases,
dialogue/select frames, log portraits, interaction sounds, and tap effects are included.
Experimental background video export includes Node.js and Playwright in tools/.
$offlineToolNotice
It prefers Microsoft Edge on this computer and falls back to
Google Chrome; if neither is installed, background export is unavailable. Browser H.264
WebCodecs support, memory and performance vary by computer and are not guaranteed.
Fetching a scenario still requires an Internet connection because story-specific
backgrounds, characters, voices, music, card art, movies, and Spine data are loaded on demand.
Downloaded resources and generated files stay inside this folder.

For redistribution, this package does not bundle scenario JSON, story-specific audio,
backgrounds, character art, card art, video, Spine data, or user translations.
It does include the small common runtime asset set listed in portable-runtime-assets.json.

See LICENSE, DISTRIBUTION-NOTICE.md, and THIRD-PARTY-NOTICES.md.
"@

Write-PackageText 'assets\README.txt' @"
This folder contains the common player UI/runtime files listed in portable-runtime-assets.json.
Scenario-specific resources fetched by the user are also stored below this folder.
"@
Write-PackageText 'exports\README.txt' "This directory stores JSON exported or merged by the workshop.`r`n"
Write-PackageText 'translations\README.txt' "Place local translation CSV files in category subfolders, or select them in the workshop.`r`n"
Write-PackageText 'fonts\README.txt' @"
The portable build includes these font files used by the workshop and player:
- FOT-HummingPro-B.OTF
- FZFWQINGYINTIJWB.TTF
- AlimamaShuHeiTi.ttf

See THIRD-PARTY-NOTICES.md and DISTRIBUTION-NOTICE.md before redistributing them.
"@

foreach ($runtimeFile in $runtimeManifest.files) {
    $packagedRuntimeFile = Join-Path $PackageRoot ([string]$runtimeFile)
    if (-not [IO.File]::Exists($packagedRuntimeFile) -or (Get-Item -LiteralPath $packagedRuntimeFile).Length -le 0) {
        throw "Portable runtime file was not packaged correctly: $runtimeFile"
    }
}
foreach ($runtimeTool in @(
    'tools/node.exe',
    'tools/node_modules/playwright/package.json',
    'tools/node_modules/playwright-core/package.json',
    'tools/licenses/node-LICENSE.txt'
)) {
    $packagedTool = Join-Path $PackageRoot $runtimeTool
    if (-not [IO.File]::Exists($packagedTool) -or (Get-Item -LiteralPath $packagedTool).Length -le 0) {
        throw "Portable tool was not packaged correctly: $runtimeTool"
    }
}
if ($BundleOfflineRuntime) {
    foreach ($runtimeTool in @('tools/ffmpeg.exe', 'tools/ffprobe.exe', 'tools/licenses/ffmpeg-LICENSE.txt', 'tools/licenses/ffmpeg-README.txt')) {
        $packagedTool = Join-Path $PackageRoot $runtimeTool
        if (-not [IO.File]::Exists($packagedTool) -or (Get-Item -LiteralPath $packagedTool).Length -le 0) {
            throw "Portable offline tool was not packaged correctly: $runtimeTool"
        }
    }
} elseif ([IO.File]::Exists((Join-Path $PackageRoot 'tools\ffmpeg.exe')) -or [IO.File]::Exists((Join-Path $PackageRoot 'tools\ffprobe.exe'))) {
    throw 'FFmpeg was included without -BundleOfflineRuntime.'
}
if ((Get-ChildItem -LiteralPath (Join-Path $PackageRoot 'experiments\offline-export') -File).Name |
        Where-Object { $offlineRuntimeFiles -cnotcontains $_ }) {
    throw 'Non-runtime experiment files were included in the portable build.'
}
if (-not [IO.File]::Exists((Join-Path $PackageRoot 'scripts\ShinyScenarioUpdateMonitor.user.js'))) {
    throw 'The complete portable build is missing the game-update userscript.'
}
if ([IO.File]::ReadAllText($portableAppHtmlPath).Contains('SSV_PORTABLE_LIBRARY_SNAPSHOT')) {
    throw 'The complete portable build must not enable snapshot-only mode.'
}
if (-not [IO.File]::ReadAllText($portableAppHtmlPath).Contains('./scripts/ShinyScenarioUpdateMonitor.user.js')) {
    throw 'The complete portable build is missing the userscript installation entry.'
}

$manifest = Get-ChildItem -LiteralPath $PackageRoot -Recurse -File |
    ForEach-Object { $_.FullName.Substring($PackageRoot.Length + 1).Replace('\', '/') } |
    Sort-Object
$manifest = @($manifest) + @('PACKAGE-CONTENTS.txt') | Sort-Object -Unique
Write-PackageText 'PACKAGE-CONTENTS.txt' (($manifest -join "`r`n") + "`r`n")

# A portable build must never retain the developer machine's absolute paths.
# Runtime output is intentionally rooted at the extracted package directory by
# serve-viewer.ps1; browser downloads still use the recipient's browser setting.
$portableTextExtensions = @('.cmd', '.css', '.html', '.js', '.json', '.md', '.ps1', '.py', '.txt')
$leakedPaths = New-Object Collections.Generic.List[string]
Get-ChildItem -LiteralPath $PackageRoot -Recurse -File | ForEach-Object {
    if ($portableTextExtensions -contains $_.Extension.ToLowerInvariant()) {
        $content = [IO.File]::ReadAllText($_.FullName)
        if ($content -match '(?i)\b[A-Z]:[\\/]Users[\\/]' -or $content.Contains($SourceRoot)) {
            $leakedPaths.Add($_.FullName.Substring($PackageRoot.Length + 1))
        }
    }
}
if ($leakedPaths.Count) {
    throw "Portable package contains developer-machine paths: $($leakedPaths -join ', ')"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory(
    $PackageRoot,
    $ZipPath,
    [IO.Compression.CompressionLevel]::Optimal,
    $true
)

$hash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$hashPath = "$ZipPath.sha256.txt"
[IO.File]::WriteAllText($hashPath, "$hash  $([IO.Path]::GetFileName($ZipPath))`r`n", $Utf8)

Write-Host "Package directory: $PackageRoot"
Write-Host "ZIP: $ZipPath"
Write-Host "SHA256: $hash"
