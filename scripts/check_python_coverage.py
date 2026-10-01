"""Enforce production coverage separately for the converter and HTTP API."""
import json
from pathlib import Path

report = json.loads(Path('coverage.json').read_text())
for component, prefix in [('converter', 'docx2tiptap/src/'), ('backend', 'backend/')]:
    files = [v['summary'] for k, v in report['files'].items() if k.startswith(prefix)]
    if not files:
        raise SystemExit(f'No coverage data for {component}')
    for metric, hit, total in [('lines', 'covered_lines', 'num_statements'),
                                ('branches', 'covered_branches', 'num_branches')]:
        possible = sum(f[total] for f in files)
        percent = 100 * sum(f[hit] for f in files) / possible if possible else 100
        print(f'{component} {metric}: {percent:.2f}%')
        if percent < 70:
            raise SystemExit(f'{component} {metric} coverage is below 70%')
