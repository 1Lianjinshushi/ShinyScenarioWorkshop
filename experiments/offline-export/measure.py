"""Read-only resource sampling of this proof's process tree, never other apps."""
import json
import sys
import time
from pathlib import Path

import psutil

output = Path(__file__).resolve().parents[2] / 'exports' / 'offline-proof' / sys.argv[1]
roots = []
for process in psutil.process_iter(['name', 'cmdline']):
    try:
        if process.info['name'] == 'node.exe' and 'experiments/offline-export/run.cjs' in (process.info['cmdline'] or []):
            roots.append(process)
    except psutil.Error:
        pass
if len(roots) != 1:
    raise SystemExit(f'Expected one proof runner, found {len(roots)}')
root = roots[0]
records = []
previous = {}
started = time.monotonic()
while root.is_running() and time.monotonic() - started < 7200:
    now = time.monotonic()
    rss = private = cpu = 0
    for process in [root] + root.children(recursive=True):
        try:
            memory = process.memory_info()
            rss += memory.rss
            private += getattr(memory, 'private', 0)
            times = process.cpu_times()
            total = times.user + times.system
            if process.pid in previous:
                old_time, old_cpu = previous[process.pid]
                cpu += (total - old_cpu) / (now - old_time) * 100 / psutil.cpu_count()
            previous[process.pid] = now, total
        except psutil.Error:
            pass
    records.append(dict(seconds=now-started, rssMiB=rss/1048576,
                        privateMiB=private/1048576, wholeMachineCpuPercent=cpu))
    if len(records) % 10 == 0:
        print(json.dumps(records[-1]), flush=True)
    time.sleep(3)
report = dict(samples=records, scope='proof runner and descendants; partial run, not full startup',
              peakRssMiB=max(r['rssMiB'] for r in records),
              peakPrivateMiB=max(r['privateMiB'] for r in records),
              meanCpuPercent=sum(r['wholeMachineCpuPercent'] for r in records[1:])/max(1,len(records)-1))
(output / 'performance-sample.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k != 'samples'}, indent=2))
