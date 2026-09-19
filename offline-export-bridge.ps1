function Invoke-OfflineExportBridge([string]$Method, [string]$Route, [object]$Payload) {
    $node = $env:SSV_NODE
    if (-not $node) { $command = Get-Command node.exe -ErrorAction SilentlyContinue; if ($command) { $node = $command.Source } }
    if (-not $node) { return @{ available = $false; missing = @('Node.js'); jobs = @(); error = '后台直出试验需要 Node.js；普通播放与编辑不受影响。' } }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $node
    $info.Arguments = '"' + (Join-Path $ProjectRoot 'experiments/offline-export/bridge.cjs') + '"'
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    try {
        $null = $process.Start()
        $bytes = [Text.Encoding]::UTF8.GetBytes((@{ method = $Method; route = $Route; payload = $Payload } | ConvertTo-Json -Depth 100 -Compress))
        $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
        $process.StandardInput.Close()
        $read = $process.StandardOutput.ReadToEndAsync()
        $readError = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($(if ($Route -eq '/resume') { 40000 } else { 18000 }))) { $process.Kill(); throw '后台直出服务响应超时' }
        $result = $read.Result | ConvertFrom-Json
        if ($Method -eq 'POST' -and $Route -in @('/open', '/open-root') -and $result.directory) {
            try {
                if ($Route -eq '/open-root') { $expected = Resolve-OfflineOutputRoot $ProjectRoot ([string]$result.directory) }
                else { $expected = Resolve-OfflineExportDirectory $ProjectRoot ([string]$Payload.id) ([string]$result.directory) }
                $foreground = Open-OfflineDirectoryInForeground $expected
                return @{ opened = $expected; foreground = [bool]$foreground }
            } catch { return @{ error = ('无法打开输出目录：' + $_.Exception.Message); directory = $result.directory } }
        }
        return $result
    } finally { $process.Dispose() }
}

function Find-OfflineExplorerWindow([string]$Directory) {
    $target = [IO.Path]::GetFullPath($Directory).TrimEnd([char]'\')
    try {
        $shell = New-Object -ComObject Shell.Application -ErrorAction Stop
        foreach ($window in $shell.Windows()) {
            try {
                $url = [string]$window.LocationURL
                if (-not $url) { continue }
                $uri = [Uri]$url
                if (-not $uri.IsFile) { continue }
                $path = [IO.Path]::GetFullPath($uri.LocalPath).TrimEnd([char]'\')
                if ([string]::Equals($path, $target, [StringComparison]::OrdinalIgnoreCase)) {
                    return [IntPtr]([int64]$window.HWND)
                }
            } catch { continue }
        }
    } catch {
        # A service/session without desktop access can still open the folder via
        # the shell. Report that foreground activation was unavailable.
        return [IntPtr]::Zero
    }
    return [IntPtr]::Zero
}

function Focus-OfflineExplorerWindow([string]$Directory) {
    if (-not ('SsvExplorerFocus' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SsvExplorerFocus {
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint attachTo, bool attachInput);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
'@
    }
    # Explorer may reuse an existing window or create one asynchronously. Only raise
    # a window whose shell location exactly matches the validated output directory.
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $handle = Find-OfflineExplorerWindow $Directory
        if ($handle -ne [IntPtr]::Zero) {
            $null = [SsvExplorerFocus]::ShowWindowAsync($handle, 9)
            $null = [SsvExplorerFocus]::BringWindowToTop($handle)
            $null = [SsvExplorerFocus]::SetForegroundWindow($handle)
            if ([SsvExplorerFocus]::GetForegroundWindow() -ne $handle) {
                $foreground = [SsvExplorerFocus]::GetForegroundWindow()
                $foregroundThread = [SsvExplorerFocus]::GetWindowThreadProcessId($foreground, [IntPtr]::Zero)
                $currentThread = [SsvExplorerFocus]::GetCurrentThreadId()
                if ($foregroundThread -and $foregroundThread -ne $currentThread -and
                    [SsvExplorerFocus]::AttachThreadInput($currentThread, $foregroundThread, $true)) {
                    try {
                        $null = [SsvExplorerFocus]::SetForegroundWindow($handle)
                    } finally {
                        $null = [SsvExplorerFocus]::AttachThreadInput($currentThread, $foregroundThread, $false)
                    }
                }
            }
            return ([SsvExplorerFocus]::GetForegroundWindow() -eq $handle)
        }
        Start-Sleep -Milliseconds 100
    }
    return $false
}

function Open-OfflineDirectoryInForeground([string]$Directory) {
    $openInfo = New-Object Diagnostics.ProcessStartInfo
    $openInfo.FileName = $Directory
    $openInfo.UseShellExecute = $true
    $openInfo.Verb = 'open'
    $opened = [Diagnostics.Process]::Start($openInfo)
    if ($opened) { $opened.Dispose() }
    try { return (Focus-OfflineExplorerWindow $Directory) }
    catch { return $false }
}

function Set-OfflineProgressAttention([string]$Action, [string]$Token) {
    if ($Action -notin @('flash', 'stop') -or $Token -cnotmatch '^[a-f0-9]{32}$') { throw 'Invalid progress attention request' }
    if (-not ('SsvProgressAttention' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class SsvProgressAttention {
    private delegate bool EnumWindowProc(IntPtr hWnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)]
    private struct FLASHWINFO {
        public UInt32 cbSize;
        public IntPtr hwnd;
        public UInt32 dwFlags;
        public UInt32 uCount;
        public UInt32 dwTimeout;
    }
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowProc callback, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool FlashWindowEx(ref FLASHWINFO info);
    public static bool Apply(string token, bool start) {
        string marker = "[SSV:" + token + "]";
        IntPtr found = IntPtr.Zero;
        EnumWindows((handle, ignored) => {
            if (!IsWindowVisible(handle)) return true;
            StringBuilder title = new StringBuilder(512);
            if (GetWindowText(handle, title, title.Capacity) == 0) return true;
            string value = title.ToString();
            if (value.StartsWith("后台直出进度 ", StringComparison.Ordinal) &&
                value.Contains(marker)) { found = handle; return false; }
            return true;
        }, IntPtr.Zero);
        if (found == IntPtr.Zero) return false;
        FLASHWINFO info = new FLASHWINFO();
        info.cbSize = (UInt32)Marshal.SizeOf(typeof(FLASHWINFO));
        info.hwnd = found;
        if (!start) { info.dwFlags = 0; FlashWindowEx(ref info); return true; }
        if (GetForegroundWindow() == found) return false;
        // FLASHW_TRAY | FLASHW_TIMERNOFG: flash only the taskbar button until
        // the user activates the popup. Never raise or focus another window.
        info.dwFlags = 2 | 12;
        info.uCount = 0;
        FlashWindowEx(ref info);
        return true;
    }
}
'@
    }
    return [SsvProgressAttention]::Apply($Token, ($Action -eq 'flash'))
}

function Invoke-OfflineProgressAttention([object]$Payload) {
    $action = [string]$Payload.action
    $token = [string]$Payload.token
    if ($action -notin @('flash', 'stop') -or $token -cnotmatch '^[a-f0-9]{32}$') { throw '进度提醒参数无效' }
    $ids = @($Payload.ids | Where-Object { $null -ne $_ })
    if ($ids.Count -gt 50) { throw '任务编号无效' }
    foreach ($id in $ids) { if ([string]$id -cnotmatch '^[a-f0-9]{32}$') { throw '任务编号无效' } }
    if ($action -eq 'flash') {
        $status = Invoke-OfflineExportBridge 'GET' '/jobs' @{}
        if ($status.error) { return @{ error = [string]$status.error } }
        $paused = @($status.jobs | Where-Object {
            $_.state -eq 'paused' -and ($ids.Count -eq 0 -or $ids -contains [string]$_.id)
        })
        if ($paused.Count -eq 0) { return @{ attention = $false; reason = '没有暂停中的任务' } }
    }
    return @{ attention = [bool](Set-OfflineProgressAttention $action $token) }
}

function Resolve-OfflineExportDirectory([string]$Root, [string]$JobId, [string]$Directory) {
    if ($JobId -cnotmatch '^[a-f0-9]{32}$') { throw 'Invalid job ID' }
    $exportRoot = [IO.Path]::GetFullPath((Join-Path $Root 'exports'))
    $jobDir = Join-Path $exportRoot ('offline-jobs/' + $JobId)
    $job = [IO.File]::ReadAllText((Join-Path $jobDir 'job.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
    if ($job.id -cne $JobId -or $job.state -ne 'complete') { throw 'Video is not complete' }
    $expected = $jobDir
    if ($job.outputPath) {
        $output = [IO.Path]::GetFullPath([string]$job.outputPath)
        $expected = [IO.Path]::GetDirectoryName($output)
        $namedRoot = Join-Path $exportRoot 'offline-videos'
        if ($expected -ne $jobDir -and ([IO.Path]::GetDirectoryName($expected) -ne $namedRoot -or [IO.Path]::GetExtension($output) -ne '.mp4')) {
            throw 'Output is outside the video directory'
        }
    }
    if ($Directory -ne $expected -or -not [IO.Directory]::Exists($expected)) { throw 'Output directory missing or unsafe' }
    foreach ($target in @($jobDir, $expected)) {
        $current = $target
        while ($current) {
            $item = Get-Item -LiteralPath $current -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked output directory refused' }
            $current = [IO.Path]::GetDirectoryName($current)
        }
    }
    return $expected
}

function Resolve-OfflineOutputRoot([string]$Root, [string]$Directory) {
    $expected = [IO.Path]::GetFullPath((Join-Path $Root 'exports/offline-videos'))
    if ($Directory -ne $expected -or -not [IO.Directory]::Exists($expected)) { throw 'Output root missing or unsafe' }
    $current = $expected
    while ($current) {
        $item = Get-Item -LiteralPath $current -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked output root refused' }
        $current = [IO.Path]::GetDirectoryName($current)
    }
    return $expected
}
