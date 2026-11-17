"""No app switches left: polymarket-cards is always on (morning-report#22), and its stored value is cleared at start.
Run: python3 tests/switches_test.py (stdlib only)."""
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
data = Path(tempfile.mkdtemp(prefix='mr-switches-'))
os.environ.update(REPORTS_DIR=str(HERE / 'fixtures'), DATA_DIR=str(data))
os.environ.pop('WIZARD_SWITCHES_DIR', None)
sys.path.insert(0, str(HERE.parent / 'app'))
import server  # noqa: E402

doc = server.switches_doc()
assert doc == {'contract': 'wizard.app-switches/1', 'switches': []}, doc
assert server.switch_on('polymarket-cards') is False

f = data / 'switches.json'
f.write_text(json.dumps({'polymarket-cards': True}))
server.prune_switches()
assert json.loads(f.read_text()) == {}, f.read_text()
server.prune_switches()  # nothing to change: no error

print('switches: ok')
