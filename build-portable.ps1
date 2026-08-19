param(
    [string]$Version = '20260816-r9',
    [string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'release')
)

$ErrorActionPreference = 'Stop'
$SourceRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$OutputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$PackageName = "ShinyScenarioViewer-Portable-$Version"
$PackageRoot = Join-Path $OutputRoot $PackageName
$ZipPath = Join-Path $OutputRoot "$PackageName.zip"
$Utf8 = New-Object Text.UTF8Encoding($false)

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

function Write-PackageText([string]$RelativePath, [string]$Text) {
    $destination = Join-Path $PackageRoot $RelativePath
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
    [IO.File]::WriteAllText($destination, $Text, $Utf8)
}

[IO.Directory]::CreateDirectory($OutputRoot) | Out-Null
if ([IO.Directory]::Exists($PackageRoot)) { Remove-Item -LiteralPath $PackageRoot -Recurse -Force }
if ([IO.File]::Exists($ZipPath)) { Remove-Item -LiteralPath $ZipPath -Force }
[IO.Directory]::CreateDirectory($PackageRoot) | Out-Null

$files = @(
    '.gitignore',
    'app-related.css', 'app.css', 'app.html', 'app.js',
    'CHANGELOG.md',
    'config.example.json',
    'DISTRIBUTION-NOTICE.md',
    'index.html', 'index.local-only.html',
    'LICENSE',
    'main.css', 'main.js',
    'portable-runtime-assets.json',
    'README.md', 'README.upstream.md',
    'remote-main.js',
    'serve-viewer.py', 'serve-viewer.ps1',
    'THIRD-PARTY-NOTICES.md',
    'UPSTREAM-ATTRIBUTION.md'
)
foreach ($file in $files) { Copy-RequiredFile $file }
foreach ($directory in @('lib', 'speaker', 'tests', 'metadata', 'monitor')) { Copy-RequiredDirectory $directory }
Copy-RequiredDirectory 'scripts' @('ShinyScenarioUpdateMonitor.user.js')

$runtimeManifestPath = Join-Path $SourceRoot 'portable-runtime-assets.json'
$runtimeManifest = Get-Content -LiteralPath $runtimeManifestPath -Raw | ConvertFrom-Json
if (-not $runtimeManifest.files -or $runtimeManifest.files.Count -eq 0) {
    throw 'portable-runtime-assets.json does not contain any runtime files.'
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

$portableAppHtmlPath = Join-Path $PackageRoot 'app.html'
$portableAppHtml = [IO.File]::ReadAllText($portableAppHtmlPath)
$portableAppHtml = [Text.RegularExpressions.Regex]::Replace(
    $portableAppHtml,
    '\s*<a class="button-link primary" href="\./scripts/ShinyScenarioUpdateMonitor\.user\.js">.*?</a>',
    '',
    [Text.RegularExpressions.RegexOptions]::Singleline
)
$portableAppHtml = [Text.RegularExpressions.Regex]::Replace(
    $portableAppHtml,
    '\s*<a class="button-link" href="https://shinycolors\.enza\.fun/".*?</a>',
    '',
    [Text.RegularExpressions.RegexOptions]::Singleline
)
$portableAppHtml = $portableAppHtml.Replace(
    '<script src="./scripts/GameUpdateMonitorCore.js"></script>',
    '<script>globalThis.SSV_PORTABLE_LIBRARY_SNAPSHOT = true;</script>' + "`r`n    " + '<script src="./scripts/GameUpdateMonitorCore.js"></script>'
)
[IO.File]::WriteAllText($portableAppHtmlPath, $portableAppHtml, $Utf8)

Write-PackageText 'PORTABLE-README.txt' @"
Shiny Scenario Workshop Portable Edition $Version

1. Extract the ZIP completely. Do not run it inside the ZIP preview window.
2. Double-click start-viewer.cmd.
3. Your browser opens http://127.0.0.1:8000/app.html automatically.
4. Enter the scenario category and event ID, import one or more translated CSV files, or choose a story from the included resource library.
   The workshop can fetch resources, play the Japanese original, merge translations, and open the editing mode.
   If a Support-card still is missing upstream, select a local game screenshot in the repair panel.
5. The resource library and update-log snapshot are included. The private game-update listener is not distributed in this portable build.
6. Close the server window to stop the application.

For a short illustrated Chinese guide and the version maintenance log, open Quick-Guide-ZH.pdf in this folder.

No Python installation is required. This launcher uses Windows PowerShell included with Windows 10/11.
The player foundation is self-contained: the required fonts, common UI atlases,
dialogue/select frames, log portraits, interaction sounds, and tap effects are included.
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
The portable build includes the two font files used by the scenario player:
- FOT-HummingPro-B.OTF
- FZFWQINGYINTIJWB.TTF

See THIRD-PARTY-NOTICES.md and DISTRIBUTION-NOTICE.md before redistributing them.
"@

foreach ($runtimeFile in $runtimeManifest.files) {
    $packagedRuntimeFile = Join-Path $PackageRoot ([string]$runtimeFile)
    if (-not [IO.File]::Exists($packagedRuntimeFile) -or (Get-Item -LiteralPath $packagedRuntimeFile).Length -le 0) {
        throw "Portable runtime file was not packaged correctly: $runtimeFile"
    }
}
if ([IO.File]::Exists((Join-Path $PackageRoot 'scripts\ShinyScenarioUpdateMonitor.user.js'))) {
    throw 'The private game-update listener must not be included in portable builds.'
}
if (-not [IO.File]::ReadAllText($portableAppHtmlPath).Contains('SSV_PORTABLE_LIBRARY_SNAPSHOT')) {
    throw 'Portable resource-library snapshot mode was not enabled.'
}

$manifest = Get-ChildItem -LiteralPath $PackageRoot -Recurse -File |
    ForEach-Object { $_.FullName.Substring($PackageRoot.Length + 1).Replace('\', '/') } |
    Sort-Object
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
