import tempfile
import json
import subprocess
import shutil
import unittest
from pathlib import Path
from unittest.mock import patch
from offline_export_bridge import focus_output_directory, open_job_directory, open_output_root


def save_job(folder, output=None):
    data = {'id': folder.name, 'state': 'complete'}
    if output:
        data['outputPath'] = str(output)
    (folder / 'job.json').write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')


class OpenExportDirectoryTests(unittest.TestCase):
    def test_foreground_helper_passes_path_as_json_stdin(self):
        folder = Path(r'C:\exports\路加S卡・【she sees】')
        completed = subprocess.CompletedProcess([], 0, 'True\n', '')
        with patch('offline_export_bridge.shutil.which', return_value=r'C:\Windows\powershell.exe'), \
             patch('offline_export_bridge.subprocess.run', return_value=completed) as run:
            self.assertTrue(focus_output_directory(folder))
        args, kwargs = run.call_args
        self.assertEqual(args[0][0], r'C:\Windows\powershell.exe')
        self.assertEqual(json.loads(kwargs['input'])['directory'], str(folder))
        self.assertNotIn(str(folder), args[0][-1])

    def test_unified_output_root_opens_without_a_completed_job(self):
        with tempfile.TemporaryDirectory(prefix='ssv-open-test-') as temp:
            root = Path(temp).resolve()
            folder = root / 'exports' / 'offline-videos'
            folder.mkdir(parents=True)
            with patch('offline_export_bridge.os.startfile', create=True) as start, \
                 patch('offline_export_bridge.focus_output_directory', return_value=True) as focus:
                self.assertEqual(open_output_root(root, str(folder)), {'opened': str(folder), 'foreground': True})
                with self.assertRaises(ValueError):
                    open_output_root(root, str(root))
                start.assert_called_once_with(str(folder), 'open')
                focus.assert_called_once_with(folder)

    def test_opens_only_exact_existing_job_directory_with_os_shell(self):
        with tempfile.TemporaryDirectory(prefix='ssv-open-test-') as temp:
            root = Path(temp).resolve()
            job_id = 'a' * 32
            folder = root / 'exports' / 'offline-jobs' / job_id
            folder.mkdir(parents=True)
            save_job(folder)
            with patch('offline_export_bridge.os.startfile', create=True) as start, \
                 patch('offline_export_bridge.focus_output_directory', return_value=True) as focus:
                self.assertEqual(open_job_directory(root, job_id, str(folder)), {'opened': str(folder), 'foreground': True})
                start.assert_called_once_with(str(folder), 'open')
                for target, key in [(str(root), job_id), (str(folder), '../bad'), (str(folder / 'missing'), job_id)]:
                    with self.assertRaises(ValueError):
                        open_job_directory(root, key, target)
                self.assertEqual(start.call_count, 1)
                focus.assert_called_once_with(folder)

    def test_os_error_is_not_swallowed(self):
        with tempfile.TemporaryDirectory(prefix='ssv-open-test-') as temp:
            root = Path(temp).resolve()
            job_id = 'b' * 32
            folder = root / 'exports' / 'offline-jobs' / job_id
            folder.mkdir(parents=True)
            save_job(folder)
            with patch('offline_export_bridge.os.startfile', side_effect=OSError('access denied'), create=True):
                with self.assertRaisesRegex(OSError, 'access denied'):
                    open_job_directory(root, job_id, str(folder))

    def test_named_folder_must_match_completed_job_record(self):
        with tempfile.TemporaryDirectory(prefix='ssv-open-test-') as temp:
            root = Path(temp).resolve()
            job_id = 'c' * 32
            job_dir = root / 'exports' / 'offline-jobs' / job_id
            folder = root / 'exports' / 'offline-videos' / '路加S卡・【she sees】'
            job_dir.mkdir(parents=True)
            folder.mkdir(parents=True)
            save_job(job_dir, folder / '01.片方.mp4')
            with patch('offline_export_bridge.os.startfile', create=True) as start, \
                 patch('offline_export_bridge.focus_output_directory', return_value=True) as focus:
                self.assertEqual(open_job_directory(root, job_id, str(folder)), {'opened': str(folder), 'foreground': True})
                with self.assertRaises(ValueError):
                    open_job_directory(root, job_id, str(job_dir))
                save_job(job_dir, root / 'outside.mp4')
                with self.assertRaises(ValueError):
                    open_job_directory(root, job_id, str(root))
                self.assertEqual(start.call_count, 1)
                focus.assert_called_once_with(folder)

    @unittest.skipUnless(shutil.which('powershell.exe'), 'Windows PowerShell required')
    def test_portable_host_resolves_named_and_legacy_folders(self):
        with tempfile.TemporaryDirectory(prefix='ssv-open-test-') as temp:
            root = Path(temp).resolve()
            job_id = 'd' * 32
            job_dir = root / 'exports' / 'offline-jobs' / job_id
            folder = root / 'exports' / 'offline-videos' / '路加S卡・【she sees】'
            job_dir.mkdir(parents=True)
            folder.mkdir(parents=True)
            script = Path(__file__).resolve().parents[1] / 'offline-export-bridge.ps1'
            def resolve(target):
                # Read JSON through stdin so PS 5 console encoding cannot alter Japanese paths.
                request = json.dumps({'script': str(script), 'root': str(root), 'id': job_id, 'directory': str(target)}, ensure_ascii=True)
                command = "$ErrorActionPreference='Stop'; $r=[Console]::In.ReadToEnd()|ConvertFrom-Json; . $r.script; $null=Resolve-OfflineExportDirectory $r.root $r.id $r.directory; Write-Output 'VALID'"
                return subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], input=request,
                                      capture_output=True, text=True, timeout=20)
            save_job(job_dir, folder / '01.片方.mp4')
            result = resolve(folder)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotEqual(resolve(job_dir).returncode, 0)
            save_job(job_dir)
            result = resolve(job_dir)
            self.assertEqual(result.returncode, 0, result.stderr)
            save_job(job_dir, root / 'outside.mp4')
            self.assertNotEqual(resolve(root).returncode, 0)


if __name__ == '__main__':
    unittest.main()
