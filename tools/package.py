"""Package: run `wam package-inline .`, then apply this app's runtime specifics.

The builder's packager regenerates runtipi/docker-compose.yml from its template (a data volume at
/data). This app also reads one folder read-only, so this step adds the read-only report folder next to the
data volume (which holds only the read state), pins the base image and adds a process limit.
Run from the repo root:  python3 tools/package.py
"""
import re
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent.parent
subprocess.run(['wam', 'package-inline', str(root)], check=True, stdout=subprocess.DEVNULL)
p = root / 'runtipi' / 'docker-compose.yml'
t = p.read_text()
swaps = [
    ('    image: python:3.12-alpine\n',
     '    image: python:3.12-alpine@sha256:1b668429b3511ab407d8e00648891631b0b1a4d7e15e3ca70f38ab5b91ad4ab4\n    pids_limit: 64\n'),
    ('      DATA_DIR: /data\n', "      DATA_DIR: /data\n      BIND: 0.0.0.0\n      REPORTS_DIR: /reports\n      PYTHONDONTWRITEBYTECODE: '1'\n"),
    ('    - ${APP_DATA_DIR}/data:/data\n', '    - ${APP_DATA_DIR}/data:/data\n    - ${ROOT_FOLDER_HOST}/media/Reports/morning-report:/reports:ro\n'),
]
for old, new in swaps:
    if t.count(old) != 1:
        raise SystemExit(f'package template changed; expected one {old.strip()!r}')
    t = t.replace(old, new)
assert re.search(r'/reports:ro\n', t) and ':/data\n' in t and '@sha256:' in t
p.write_text(t)
print('packaged', p.relative_to(root))
