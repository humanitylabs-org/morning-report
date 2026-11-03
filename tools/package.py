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
# Linux caps one exec argument at 128 KiB (MAX_ARG_STRLEN): an uncompressed bundle over it restart-loops the
# container with "argument list too long" (0.10.0's first build). Ship the file bundle zlib-compressed.
import base64, json, zlib
m = re.search(r"files=json\.loads\(base64\.b64decode\('([A-Za-z0-9+/=]+)'\)\)", t)
if m:
    raw = base64.b64decode(m.group(1))
    json.loads(raw)
    packed = base64.b64encode(zlib.compress(raw, 9)).decode()
    t = t.replace(m.group(0), "files=json.loads(zlib.decompress(base64.b64decode('" + packed + "')))", 1)
    old_imp = 'import base64,json,pathlib,runpy'
    if t.count(old_imp) != 1:
        raise SystemExit('package template changed; expected one loader import line')
    t = t.replace(old_imp, 'import base64,json,pathlib,runpy,zlib', 1)
import yaml
cmd = yaml.safe_load(t)['services']['morning-report']['command']
assert max(len(x) for x in cmd) < 120 * 1024, 'inline bundle too big for one exec argument'
compile(cmd[2], 'loader', 'exec')
p.write_text(t)
print('packaged', p.relative_to(root))
