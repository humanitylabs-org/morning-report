"""Inbox feed + server-side read state. Run: python3 tests/inbox_test.py (stdlib only)."""
import http.client
import json
import os
import shutil
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
tmp = Path(tempfile.mkdtemp(prefix='mr-inbox-'))
reports, data = tmp / 'reports', tmp / 'data'
reports.mkdir()
for name in ('synthetic-2026-01-01.md', 'synthetic-2026-01-02.md'):
    shutil.copy(HERE / 'fixtures' / name, reports / name)
os.utime(reports / 'synthetic-2026-01-02.md', (1767340800, 1767340800))
os.environ.update(REPORTS_DIR=str(reports), DATA_DIR=str(data), PORT='18871')
sys.path.insert(0, str(HERE.parent / 'app'))
import server  # noqa: E402

srv = ThreadingHTTPServer(('127.0.0.1', 18871), server.Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
HOST = '127.0.0.1:18871'


def req(method, path, body=None, ctype='application/json', headers=None):
    c = http.client.HTTPConnection('127.0.0.1', 18871, timeout=5)
    h = {'Host': HOST, **(headers or {})}
    raw = None
    if body is not None:
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        h['Content-Type'] = ctype
        h['Content-Length'] = str(len(raw))
    c.request(method, path, raw, h)
    r = c.getresponse()
    out = r.read()
    try:
        return r.status, json.loads(out)
    except ValueError:
        return r.status, out


def check(cond, what):
    if not cond:
        raise SystemExit('FAIL ' + what)


try:
    # No read state yet and no seeding: only the newest edition is unread (never the whole archive).
    s, b = req('GET', '/morning-report/api/seen')
    check(s == 200 and b == {'seen': '', 'unread': 1}, f'seen empty {s} {b}')
    s, b = req('GET', '/morning-report/api/inbox')
    check(s == 200 and b['inbox'] == 1 and len(b['items']) == 1, f'inbox one item {b}')
    it = b['items'][0]
    check(it['key'] == 'edition:2026-01-02' and it['title'] == 'Morning report ready', f'key/title {it}')
    check(it['time'] == 1767340800 and it['priority'] == 2 and it['open'] == '?date=2026-01-02', f'time/open {it}')
    check(it['actions'] == [{'id': 'done', 'label': 'Mark as read'}], f'actions {it}')
    check(isinstance(it['text'], str) and it['text'] and '\n' not in it['text'] and '<' not in it['text'], f'text {it}')

    # Startup seeding marks the newest edition seen, so an old report never shows as a stale item.
    server.seed_seen()
    check(json.loads((data / 'seen.json').read_text())['seen'] == '2026-01-02', 'seeded newest')
    s, b = req('GET', '/morning-report/api/inbox')
    check(b == {'inbox': 1, 'items': []}, f'empty after seed {b}')
    # Seeding never overwrites an existing value.
    (data / 'seen.json').write_text(json.dumps({'seen': '2026-01-01'}))
    server.seed_seen()
    check(server.read_seen() == '2026-01-01', 'seed keeps existing')
    s, b = req('GET', '/morning-report/api/seen')
    check(b == {'seen': '2026-01-01', 'unread': 1}, f'one unread {b}')

    # POST guards.
    s, b = req('POST', '/morning-report/api/inbox/act', b'key=x', 'application/x-www-form-urlencoded')
    check(s == 415, f'415 {s}')
    s, b = req('POST', '/morning-report/api/inbox/act', {'key': 'edition:2026-01-02', 'action': 'snooze'})
    check(s == 400 and b['error'] == 'Unknown action.', f'400 action {s} {b}')
    s, b = req('POST', '/morning-report/api/inbox/act', {'key': 'chat:1', 'action': 'done'})
    check(s == 400, f'400 key {s}')
    s, b = req('POST', '/morning-report/api/inbox/act', {'key': 'edition:2025-01-01', 'action': 'done'})
    check(s == 404, f'404 unknown edition {s}')
    s, b = req('POST', '/morning-report/api/inbox/act', [1], 'application/json')
    check(s == 400, f'400 non-object {s}')
    s, b = req('POST', '/morning-report/api/inbox/act', {'key': 'edition:2026-01-02', 'action': 'done'},
               headers={'Origin': 'https://evil.example'})
    check(s == 403, f'cross-origin {s}')
    s, b = req('POST', '/morning-report/api/other', {'a': 1})
    check(s == 405, f'other POST still read-only {s}')
    check(server.read_seen() == '2026-01-01', 'guards wrote nothing')

    # Done marks that edition seen; the item drops out; older marks never move it backwards.
    s, b = req('POST', '/morning-report/api/inbox/act', {'key': 'edition:2026-01-02', 'action': 'done'})
    check(s == 200 and b == {'ok': True}, f'done {s} {b}')
    s, b = req('GET', '/morning-report/api/inbox')
    check(b['items'] == [], f'dropped {b}')
    s, b = req('POST', '/morning-report/api/inbox/act', {'key': 'edition:2026-01-01', 'action': 'done'})
    check(s == 200 and server.read_seen() == '2026-01-02', 'never backwards')
    check(sorted(p.name for p in data.iterdir()) == ['seen.json'], 'atomic write leaves no temp files')

    # A new edition brings the item back.
    (reports / 'synthetic-2026-01-03.md').write_text('# Morning Report — Jan 3\n\n- **Needs you · X:** do a thing\n')
    s, b = req('GET', '/morning-report/api/inbox')
    check(b['items'][0]['key'] == 'edition:2026-01-03' and b['items'][0]['text'] == 'Morning Report — Jan 3 · 1 needs you', f'new {b}')

    # Unwritable data dir: 503, nothing crashes, GET still answers.
    server.DATA = tmp / 'nope' / 'x'
    (tmp / 'nope').write_text('file, not dir')
    s, b = req('POST', '/morning-report/api/inbox/act', {'key': 'edition:2026-01-03', 'action': 'done'})
    check(s == 503, f'503 {s} {b}')
    s, b = req('GET', '/morning-report/api/inbox')
    check(s == 200, 'GET survives missing data')
    print('PASS inbox: feed shape, seed, 415/400/404/403/405, done drops item, monotonic atomic seen, 503')
finally:
    srv.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
