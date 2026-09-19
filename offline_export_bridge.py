"""Local-only relay; shares the serial Node queue with the portable host."""
from __future__ import annotations
import json
import os
import re
import shutil
import subprocess
from pathlib import Path


def focus_output_directory(directory: Path) -> bool:
    """Raise only the Explorer window displaying this validated folder."""
    powershell = shutil.which('powershell.exe')
    if not powershell:
        return False
    script = Path(__file__).with_name('offline-export-bridge.ps1')
    command = ("$ErrorActionPreference='Stop'; "
               "$request=[Console]::In.ReadToEnd()|ConvertFrom-Json; "
               ". $request.script; "
               "[bool](Focus-OfflineExplorerWindow ([string]$request.directory))")
    try:
        result = subprocess.run(
            [powershell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
            input=json.dumps({'script': str(script), 'directory': str(directory)}, ensure_ascii=True),
            text=True, encoding='utf-8', capture_output=True, timeout=6,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return result.returncode == 0 and result.stdout.strip().lower() == 'true'
    except (OSError, subprocess.TimeoutExpired):
        return False


def progress_taskbar_attention(root: Path, action: str, token: str, ids: list[str]) -> dict:
    """Flash one identified progress popup only while its queue has a paused job."""
    if action not in ('flash', 'stop') or not re.fullmatch(r'[a-f0-9]{32}', token or ''):
        raise ValueError('进度提醒参数无效')
    if not isinstance(ids, list) or len(ids) > 50 or any(not isinstance(item, str) or
            not re.fullmatch(r'[a-f0-9]{32}', item) for item in ids):
        raise ValueError('任务编号无效')
    if action == 'flash':
        data = relay(root, 'GET', '/jobs')
        if data.get('error'):
            return {'error': data['error']}
        if not any(job.get('state') == 'paused' and (not ids or job.get('id') in ids)
                   for job in data.get('jobs', [])):
            return {'attention': False, 'reason': '没有暂停中的任务'}
    powershell = shutil.which('powershell.exe')
    if not powershell:
        return {'attention': False, 'reason': 'Windows 桌面提醒不可用'}
    script = Path(__file__).with_name('offline-export-bridge.ps1')
    command = ("$ErrorActionPreference='Stop'; "
               "$request=[Console]::In.ReadToEnd()|ConvertFrom-Json; "
               ". $request.script; "
               "[bool](Set-OfflineProgressAttention ([string]$request.action) ([string]$request.token))")
    try:
        result = subprocess.run(
            [powershell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
            input=json.dumps({'script': str(script), 'action': action, 'token': token}, ensure_ascii=True),
            text=True, encoding='utf-8', capture_output=True, timeout=8,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return {'attention': result.returncode == 0 and result.stdout.strip().lower() == 'true'}
    except (OSError, subprocess.TimeoutExpired):
        return {'attention': False}


def open_job_directory(root: Path, job_id: str, directory: str) -> dict:
    import re
    if not re.fullmatch(r'[a-f0-9]{32}', job_id or ''):
        raise ValueError('任务编号无效')
    root = root.absolute()
    job_dir = root / 'exports' / 'offline-jobs' / job_id
    if job_dir.resolve() != job_dir:
        raise ValueError('任务目录路径不安全')
    job = json.loads((job_dir / 'job.json').read_text(encoding='utf-8-sig'))
    if job.get('id') != job_id or job.get('state') != 'complete':
        raise ValueError('视频尚未完成')
    output = Path(job.get('outputPath') or job_dir / 'output.mp4')
    expected = output.parent
    if expected != job_dir:
        try:
            relative = output.relative_to(root / 'exports' / 'offline-videos')
        except ValueError:
            raise ValueError('输出目录不在成片目录内') from None
        if len(relative.parts) != 2 or '..' in relative.parts or output.suffix.lower() != '.mp4':
            raise ValueError('输出路径无效')
    target = Path(directory)
    if target != expected or not target.is_dir() or target.resolve() != expected.absolute():
        raise ValueError('输出目录不存在或路径不安全')
    os.startfile(str(target), 'open')
    return {'opened': str(target), 'foreground': focus_output_directory(target)}


def open_output_root(root: Path, directory: str) -> dict:
    expected = root.absolute() / 'exports' / 'offline-videos'
    if Path(directory) != expected or expected.resolve() != expected or not expected.is_dir():
        raise ValueError('统一保存目录不存在或路径不安全')
    os.startfile(str(expected), 'open')
    return {'opened': str(expected), 'foreground': focus_output_directory(expected)}


def relay(root: Path, method: str, route: str, payload: dict | None = None) -> dict:
    node = os.environ.get('SSV_NODE') or shutil.which('node')
    if not node:
        return {'available': False, 'missing': ['Node.js'], 'jobs': [], 'error': '后台直出试验需要 Node.js；普通播放与编辑不受影响。'}
    result = subprocess.run([node, str(root / 'experiments/offline-export/bridge.cjs')],
        input=json.dumps({'method': method, 'route': route, 'payload': payload or {}}, ensure_ascii=False),
        text=True, encoding='utf-8', capture_output=True, timeout=40 if route == '/resume' else 18,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        data = json.loads(result.stdout)
    except ValueError:
        return {'error': '直出服务返回无效结果：' + result.stderr[-500:]}
    if method == 'POST' and route in ('/open', '/open-root') and data.get('directory'):
        try:
            if route == '/open-root':
                return open_output_root(root, data['directory'])
            return open_job_directory(root, (payload or {}).get('id'), data['directory'])
        except (OSError, ValueError) as error:
            return {'error': '无法打开输出目录：' + str(error), 'directory': data['directory']}
    return data
