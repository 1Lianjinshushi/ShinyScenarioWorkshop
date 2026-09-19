import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from offline_export_bridge import progress_taskbar_attention


TOKEN = 'a' * 32
JOB = 'b' * 32


class ProgressAttentionTests(unittest.TestCase):
    def test_flash_requires_a_paused_job_in_this_batch(self):
        with patch('offline_export_bridge.relay', return_value={'jobs': [
                {'id': JOB, 'state': 'running'}]}) as relay, \
             patch('offline_export_bridge.subprocess.run') as run:
            self.assertEqual(progress_taskbar_attention(Path('.'), 'flash', TOKEN, [JOB])['attention'], False)
        relay.assert_called_once_with(Path('.'), 'GET', '/jobs')
        run.assert_not_called()

    def test_flash_targets_only_validated_token_without_shell_interpolation(self):
        completed = subprocess.CompletedProcess([], 0, 'True\n', '')
        with patch('offline_export_bridge.relay', return_value={'jobs': [
                {'id': JOB, 'state': 'paused'}]}), \
             patch('offline_export_bridge.shutil.which', return_value=r'C:\Windows\powershell.exe'), \
             patch('offline_export_bridge.subprocess.run', return_value=completed) as run:
            self.assertEqual(progress_taskbar_attention(Path('.'), 'flash', TOKEN, [JOB]), {'attention': True})
        args, kwargs = run.call_args
        self.assertEqual(args[0][0], r'C:\Windows\powershell.exe')
        self.assertEqual(json.loads(kwargs['input'])['token'], TOKEN)
        self.assertNotIn(TOKEN, args[0][-1])

    def test_stop_does_not_need_a_still_paused_job(self):
        completed = subprocess.CompletedProcess([], 0, 'True\n', '')
        with patch('offline_export_bridge.relay') as relay, \
             patch('offline_export_bridge.shutil.which', return_value='powershell.exe'), \
             patch('offline_export_bridge.subprocess.run', return_value=completed):
            self.assertEqual(progress_taskbar_attention(Path('.'), 'stop', TOKEN, [JOB]), {'attention': True})
        relay.assert_not_called()

    def test_invalid_action_token_or_job_ids_are_rejected(self):
        for action, token, ids in [('raise', TOKEN, []), ('flash', 'x' * 32, []),
                                   ('flash', TOKEN, ['../outside'])]:
            with self.assertRaises(ValueError):
                progress_taskbar_attention(Path('.'), action, token, ids)


if __name__ == '__main__':
    unittest.main()
