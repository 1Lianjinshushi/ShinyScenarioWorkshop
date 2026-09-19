param([switch]$Recycle)
$ErrorActionPreference = 'Stop'
# Explicit development-run allowlist, not a general workspace/cache cleaner.
$sampleRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../exports/offline-proof'))
$exportRoot = Split-Path -Parent $sampleRoot
if (Test-Path -LiteralPath (Join-Path $exportRoot '.offline-export.lock')) { throw 'An export lock exists; finish or cancel that export first.' }
$runNames = @(
    '201002001', '202701002', '202701002/preflight-dynamic-20260917', '202701011',
    '4902005026', '4902005026/live-ending-20260917', '4902005026/governed-20260917',
    '4902005026/contention-20260917', '4902005026/contention-20260917-v2',
    '4902005026/contention-20260917-v3', '4902005026/lean-20260917',
    '4902005026/lean-verify-20260917', '9999999999/missing-resources-20260917'
)
$keepVideo = @('201002001', '202701002', '202701011', '4902005026/contention-20260917-v3', '4902005026/lean-20260917')
# Inputs and expected PCM for repeatable audio-equivalence tests stay available.
$keepPCM = @('201002001', '202701002', '4902005026/contention-20260917-v3', '4902005026/lean-20260917')
function Assert-SafePath([string]$target) {
    $resolved = (Resolve-Path -LiteralPath $target).Path
    if (-not $resolved.StartsWith($sampleRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Outside samples: $resolved" }
    $probe = $resolved
    while ($probe.Length -ge $sampleRoot.Length) {
        $item = Get-Item -LiteralPath $probe -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refuse linked path: $probe" }
        if ($probe -eq $sampleRoot) { break }
        $probe = Split-Path -Parent $probe
    }
    return $resolved
}
$targets = [Collections.Generic.List[object]]::new()
foreach ($runName in $runNames) {
    $runPath = Join-Path $sampleRoot $runName
    if (-not (Test-Path -LiteralPath $runPath)) { continue }
    $null = Assert-SafePath $runPath
    foreach ($leaf in @('audio', 'movie-frames')) {
        $directory = Join-Path $runPath $leaf
        if (-not (Test-Path -LiteralPath $directory)) { continue }
        $directory = Assert-SafePath $directory
        $items = @(Get-ChildItem -LiteralPath $directory -Force -Recurse)
        foreach ($item in $items) {
            $null = Assert-SafePath $item.FullName
            if ($item.PSIsContainer) {
                if ($leaf -ne 'movie-frames' -or $item.Name -notmatch '^[a-f0-9]{16}$') { throw "Unexpected directory: $($item.FullName)" }
            } elseif (($leaf -eq 'audio' -and $item.Name -notmatch '^[a-f0-9]{16}(\.browser)?\.f32(\.json)?$') -or
                ($leaf -eq 'movie-frames' -and $item.Name -notmatch '^(\d{6}\.png|complete\.json)$')) {
                throw "Unexpected generated file; preserve it: $($item.FullName)"
            }
        }
        $bytes = ($items | Where-Object { -not $_.PSIsContainer } | Measure-Object -Property Length -Sum).Sum
        $targets.Add([pscustomobject]@{ path = $directory; kind = 'directory'; bytes = [long]$bytes; reason = 'Regenerable decoded media'; status = 'planned' })
    }
    foreach ($file in Get-ChildItem -LiteralPath $runPath -File -Force) {
        $reason = $null
        if ($file.Name -match '^frame-\d+\.png$') { $reason = 'Diagnostic PNG; hashes/reports retained' }
        elseif ($file.Name -in @('picture.mp4', 'picture.h264')) { $reason = 'Intermediate video; final sample retained where needed' }
        elseif ($file.Name -in @('mix.f32', 'media-mix.f32', 'mastered.f32') -and $runName -notin $keepPCM) { $reason = 'Duplicate audio intermediate' }
        elseif ($file.Name -match '^\d+\.offline\.mp4$' -and $runName -notin $keepVideo) { $reason = 'Superseded or duplicate sample' }
        elseif ($file.Name -match '^\d+\.realtime-reference\.webm$' -and $file.Length -eq 0) { $reason = 'Empty failed experiment' }
        if ($reason) {
            $resolved = Assert-SafePath $file.FullName
            $targets.Add([pscustomobject]@{ path = $resolved; kind = 'file'; bytes = $file.Length; reason = $reason; status = 'planned' })
        }
    }
}
$report = [ordered]@{ root = $sampleRoot; mode = $(if ($Recycle) { 'recycle' } else { 'preview' });
    totalBytes = [long]($targets | Measure-Object -Property bytes -Sum).Sum; targets = @($targets.ToArray());
    note = 'Only allowlisted proof outputs. Source JSON, downloaded cache, manifests, reports and audio comparison baselines are retained.' }
$reportPath = Join-Path $sampleRoot ('cleanup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $report.mode + '.json')
function Save-Audit { [IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false)) }
Save-Audit
$targets | Group-Object reason | ForEach-Object { '{0}: {1} targets, {2:N1} MiB' -f $_.Name, $_.Count, (($_.Group | Measure-Object -Property bytes -Sum).Sum / 1MB) }
Write-Output ('Total: {0:N2} GiB; audit: {1}' -f ($report.totalBytes / 1GB), $reportPath)
if (-not $Recycle) { return }
Add-Type -AssemblyName Microsoft.VisualBasic
try {
    foreach ($target in $targets) {
        $resolved = Assert-SafePath $target.path
        if ($target.kind -eq 'directory') {
            [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($resolved,
                [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
                [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
        } else {
            if ((Get-Item -LiteralPath $resolved).Length -ne $target.bytes) { throw "File changed since inventory: $resolved" }
            [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($resolved,
                [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
                [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
        }
        $target.status = 'recycled'
    }
} finally { Save-Audit }
Write-Output 'Moved to Windows Recycle Bin. Nothing was permanently deleted.'
