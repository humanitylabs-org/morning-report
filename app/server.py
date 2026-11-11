"""Morning Report: a read-only reader for dated Markdown/PDF reports in one folder.

Stdlib only. The folder is mounted read-only at REPORTS_DIR. File names follow
<anything>-YYYY-MM-DD.md and optional <anything>-YYYY-MM-DD[-mobile].pdf. The app never
writes reports, never takes a path from a request, and never follows symlinks. Its only
write is the owner's read state: the newest edition seen, one small JSON file in DATA_DIR.
"""
import json
import os
import re
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent if '__file__' in globals() else Path(os.environ.get('APP_ROOT', '.')).resolve()
REPORTS = Path(os.environ.get('REPORTS_DIR', '/reports'))
DATA = Path(os.environ.get('DATA_DIR', '/data'))
SEEN_FILE = 'seen.json'
APP_ID = 'morning-report'
VERSION = '0.10.6'
PREFIX = '/' + APP_ID
MAX_BYTES = 16 * 1024 * 1024
NAME = re.compile(r'^[A-Za-z0-9_.-]*?(\d{4}-\d{2}-\d{2})(-mobile)?\.(md|pdf)$')
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
STATIC_TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml'}


class Problem(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def _index():
    """{date: {'md': name, 'pdf': name}}; mobile PDFs win over plain ones."""
    out = {}
    try:
        entries = list(os.scandir(REPORTS))
    except FileNotFoundError:
        return out
    for e in entries:
        m = NAME.match(e.name)
        if not m or not e.is_file(follow_symlinks=False):
            continue
        size = e.stat(follow_symlinks=False).st_size
        if not 0 < size <= MAX_BYTES:
            continue
        day, mobile, kind = m.groups()
        slot = out.setdefault(day, {})
        if kind == 'md':
            slot.setdefault('md', e.name)
        elif mobile or 'pdf' not in slot:
            slot['pdf'] = e.name
    return out


def _title(text):
    for line in text.splitlines():
        if line.startswith('# '):
            return line[2:].strip()[:200]
    return ''


def list_reports(limit=None):
    idx = _index()
    days = sorted(idx, reverse=True)
    if isinstance(limit, int) and not isinstance(limit, bool) and limit > 0:
        days = days[:limit]
    return {'reports': [{'date': d, 'markdown': 'md' in idx[d], 'pdf': 'pdf' in idx[d]} for d in days],
            'total': len(idx)}


def _read(name):
    fd = os.open(REPORTS / name, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as f:
        data = f.read(MAX_BYTES + 1)
    if not data or len(data) > MAX_BYTES:
        raise Problem(404, 'Report not found.')
    return data


def get_report(day=None):
    idx = _index()
    days = sorted(d for d in idx if 'md' in idx[d])
    if day in (None, '', 'latest'):
        if not days:
            raise Problem(404, 'No reports yet.')
        day = days[-1]
    if not isinstance(day, str) or not DATE.match(day):
        raise Problem(400, 'date must be YYYY-MM-DD or latest.')
    if day not in days:
        raise Problem(404, 'No report for that date.')
    text = _read(idx[day]['md']).decode('utf-8', 'replace')
    i = days.index(day)
    return {'date': day, 'title': _title(text), 'markdown': text, 'pdf': 'pdf' in idx[day],
            'older': days[i - 1] if i > 0 else None, 'newer': days[i + 1] if i + 1 < len(days) else None}


# Read state (server-side, so badge, inbox and every device agree): the newest edition the owner has seen.
_seen_lock = threading.Lock()


def read_seen():
    try:
        with open(DATA / SEEN_FILE, encoding='utf-8') as f:
            v = json.load(f).get('seen')
    except (OSError, ValueError, AttributeError):
        return ''
    return v if isinstance(v, str) and DATE.match(v) else ''


def _write_seen(day):
    DATA.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.seen-', dir=DATA)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump({'seen': day, 'at': int(time.time())}, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, DATA / SEEN_FILE)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def mark_seen(day):
    """Advance the seen edition to day (never backwards). Returns the stored value."""
    if not isinstance(day, str) or not DATE.match(day):
        raise Problem(400, 'date must be YYYY-MM-DD.')
    with _seen_lock:
        cur = read_seen()
        if day > cur:
            try:
                _write_seen(day)
            except OSError:
                raise Problem(503, 'Could not save read state.')
            cur = day
    return cur


def _editions(idx=None):
    idx = _index() if idx is None else idx
    return sorted((d for d in idx if 'md' in idx[d]), reverse=True)


def seed_seen():
    """First run with server read state: count only editions written after now as unread."""
    with _seen_lock:
        if read_seen():
            return
        eds = _editions()
        if eds:
            try:
                _write_seen(eds[0])
            except OSError:
                pass


def seen_state():
    eds, s = _editions(), read_seen()
    return {'seen': s, 'unread': sum(1 for d in eds if d > s) if s else (1 if eds else 0)}


def _summary(text):
    head = _title(text) or 'Morning report'
    needs = sum(1 for line in text.splitlines() if re.match(r'^\s*[-*]\s+\*\*Needs you\b', line))
    plain = re.sub(r'[*_`]', '', head).strip()
    if needs:
        plain += f' · {needs} need{"s" if needs == 1 else ""} you'
    return plain[:300]


def inbox():
    idx = _index()
    eds = _editions(idx)
    if not eds or (read_seen() or '') >= eds[0]:
        return {'inbox': 1, 'items': []}
    day = eds[0]
    fd = os.open(REPORTS / idx[day]['md'], os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as f:
        written = int(os.fstat(f.fileno()).st_mtime)
        text = f.read(MAX_BYTES).decode('utf-8', 'replace')
    return {'inbox': 1, 'items': [{
        'key': 'edition:' + day, 'title': 'Morning report ready', 'text': _summary(text), 'time': written,
        'priority': 2, 'open': '?date=' + day, 'actions': [{'id': 'done', 'label': 'Mark as read'}]}]}


def inbox_act(body):
    key, action = body.get('key'), body.get('action')
    if action != 'done':
        raise Problem(400, 'Unknown action.')
    m = re.fullmatch(r'edition:(\d{4}-\d{2}-\d{2})', key) if isinstance(key, str) else None
    if not m:
        raise Problem(400, 'Unknown item.')
    if m.group(1) not in _editions():
        raise Problem(404, 'No report for that date.')
    mark_seen(m.group(1))
    return {'ok': True}


TOOLS = [
    {'name': 'reports_list', 'description': 'List saved morning reports, newest first (dates and which formats exist).',
     'inputSchema': {'type': 'object', 'properties': {'limit': {'type': 'integer', 'minimum': 1}}, 'additionalProperties': False},
     'annotations': {'readOnlyHint': True}},
    {'name': 'report_read', 'description': 'Read one morning report as Markdown. date is YYYY-MM-DD; omit it for the latest.',
     'inputSchema': {'type': 'object', 'properties': {'date': {'type': 'string'}}, 'additionalProperties': False},
     'annotations': {'readOnlyHint': True}},
]


def rpc(msg):
    if not isinstance(msg, dict):
        return {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32600, 'message': 'Expected a JSON-RPC object.'}}
    m, i, p = msg.get('method'), msg.get('id'), msg.get('params') or {}
    if 'id' not in msg:
        return None
    try:
        if m == 'initialize':
            r = {'protocolVersion': '2025-06-18', 'capabilities': {'tools': {}}, 'serverInfo': {'name': APP_ID, 'version': VERSION}}
        elif m == 'tools/list':
            r = {'tools': TOOLS}
        elif m == 'tools/call':
            a = p.get('arguments') or {}
            n = p.get('name')
            if n == 'reports_list':
                value = list_reports(a.get('limit'))
            elif n == 'report_read':
                value = get_report(a.get('date'))
            else:
                return {'jsonrpc': '2.0', 'id': i, 'error': {'code': -32602, 'message': 'Unknown tool.'}}
            r = {'content': [{'type': 'text', 'text': json.dumps(value)}], 'structuredContent': value, 'isError': False}
        elif m == 'ping':
            r = {}
        else:
            return {'jsonrpc': '2.0', 'id': i, 'error': {'code': -32601, 'message': 'Unknown method.'}}
    except Problem as e:
        r = {'content': [{'type': 'text', 'text': e.message}], 'isError': True}
    except OSError:
        r = {'content': [{'type': 'text', 'text': 'Report unavailable.'}], 'isError': True}
    return {'jsonrpc': '2.0', 'id': i, 'result': r}


def _csv(name):
    return {x.strip().lower() for x in os.environ.get(name, '').split(',') if x.strip()}


_PORT = os.environ.get('PORT', '8799')
_LOOPBACK = {f'127.0.0.1:{_PORT}', f'localhost:{_PORT}', f'{APP_ID}:{_PORT}'}
TRUSTED_HOSTS = _csv('WIZARD_TRUSTED_HOSTS') | _LOOPBACK
TRUSTED_ORIGINS = _csv('WIZARD_TRUSTED_ORIGINS') | {'http://' + h for h in _LOOPBACK}


class Handler(BaseHTTPRequestHandler):
    def refused(self, write=False):
        if (self.headers.get('Host') or '').lower() not in TRUSTED_HOSTS:
            self.send(403, {'error': 'Unknown host.'})
            return True
        origin = (self.headers.get('Origin') or '').lower()
        if origin and origin not in TRUSTED_ORIGINS:
            self.send(403, {'error': 'Cross-origin request refused.'})
            return True
        if write and not origin and (self.headers.get('Sec-Fetch-Site') or '') == 'cross-site':
            self.send(403, {'error': 'Cross-origin request refused.'})
            return True
        return False

    def send(self, code, body=None, content_type='application/json', extra=None):
        b = body if isinstance(body, bytes) else b'' if body is None else json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(b)

    def route(self):
        p = urlsplit(self.path).path
        if p == PREFIX:
            return '/'
        return p[len(PREFIX):] if p.startswith(PREFIX + '/') else p

    def do_GET(self):
        if self.refused():
            return
        path = self.route()
        try:
            if path in ('/healthz', '/api/health'):
                return self.send(200, {'ok': True, 'app': APP_ID, 'version': VERSION,
                                       'archive': REPORTS.is_dir(), 'reports': len(_index())})
            if path == '/api/inbox':
                return self.send(200, inbox())
            if path == '/api/seen':
                return self.send(200, seen_state())
            if path == '/api/reports':
                return self.send(200, list_reports())
            m = re.fullmatch(r'/api/reports/(latest|\d{4}-\d{2}-\d{2})', path)
            if m:
                return self.send(200, get_report(m.group(1)))
            m = re.fullmatch(r'/api/reports/(\d{4}-\d{2}-\d{2})\.pdf', path)
            if m:
                slot = _index().get(m.group(1)) or {}
                if 'pdf' not in slot:
                    raise Problem(404, 'No PDF for that date.')
                return self.send(200, _read(slot['pdf']), 'application/pdf',
                                 {'Content-Disposition': f'inline; filename="morning-report-{m.group(1)}.pdf"'})
            if path == '/openapi.json':
                return self.send(200, (ROOT / 'openapi.json').read_bytes())
            name = 'index.html' if path == '/' else path[1:]
            kind = STATIC_TYPES.get(Path(name).suffix)
            if kind and '/' not in name and not name.startswith('.') and (ROOT / 'web' / name).is_file():
                return self.send(200, (ROOT / 'web' / name).read_bytes(), kind)
            self.send(405 if path == '/mcp' else 404, {'error': 'Use POST /mcp.' if path == '/mcp' else 'Not found.'})
        except Problem as e:
            self.send(e.code, {'error': e.message})
        except OSError:
            self.send(404, {'error': 'Report not found.'})

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        if self.refused(write=True):
            return
        route = self.route()
        if route not in ('/mcp', '/api/inbox/act'):
            return self.send(405, {'error': 'Reports are read-only.'})
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.send(415, {'error': 'Use application/json.'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 65536:
                return self.send(413, {'error': 'Request too large.'})
            body = json.loads(self.rfile.read(size))
            if route == '/api/inbox/act':
                if not isinstance(body, dict):
                    return self.send(400, {'error': 'Expected a JSON object.'})
                return self.send(200, inbox_act(body))
            if not isinstance(body, dict):
                return self.send(400, {'error': 'Expected a JSON-RPC object.'})
            out = rpc(body)
            self.send(202 if out is None else 200, out)
        except Problem as e:
            self.send(e.code, {'error': e.message})
        except OSError:
            self.send(404, {'error': 'Report not found.'})
        except (ValueError, TypeError):
            self.send(400, {'error': 'Invalid JSON request.'})

    def log_message(self, format, *args):
        pass

# ---- wizard.app-switches/1 ------------------------------------------------------------------------------------------
# Owner feature switches for the Tracker's Try it (wizard-os docs/APP_SWITCHES.md). Shared block: the same text ships in
# every Wizard app (template: wizard-app-manager templates/hello-wizard). Every new feature ships behind a switch, off by
# default: append it to SWITCHES with the issue it delivers, e.g.
#   {'id': 'compact-header', 'name': 'Compact top bar', 'description': '...', 'default': False,
#    'issues': ['humanitylabs-org/<repo>#20']}
# and gate the feature on switch_on('compact-header'). State lives on the box (DATA_DIR/switches.json), so the app's
# page, the Tracker (through the App Manager) and the agent see one state. GET/POST /api/switches, owner only: the
# box's Tailscale Serve owner login with X-Wizard-Switch: 1; never a bearer, agent grant or box-local host.
import json as _sw_json
import os as _sw_os
import re as _sw_re
import threading as _sw_threading
from pathlib import Path as _SwPath
from urllib.parse import urlsplit as _sw_urlsplit

SWITCHES = []
_SW_CONTRACT = 'wizard.app-switches/1'
_SW_ROUTE = _sw_re.compile(r'(?:/[a-z0-9][a-z0-9-]{0,62})?/api/switches/?')
_SW_LOCAL = {'localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'}
_sw_lock = _sw_threading.Lock()


def _sw_file():
    return _SwPath(_sw_os.environ.get('WIZARD_SWITCHES_DIR') or _sw_os.environ.get('DATA_DIR') or '/data') / 'switches.json'


def _sw_saved():
    try:
        saved = _sw_json.loads(_sw_file().read_text())
    except (OSError, ValueError):
        return {}
    return saved if isinstance(saved, dict) else {}


def switches_doc():
    saved = _sw_saved()
    return {'contract': _SW_CONTRACT, 'switches': [
        dict(s, on=saved[s['id']] if isinstance(saved.get(s['id']), bool) else bool(s.get('default'))) for s in SWITCHES]}


def switch_on(switch_id):
    return next((s['on'] for s in switches_doc()['switches'] if s['id'] == switch_id), False)


def _sw_set(switch_id, on):
    with _sw_lock:
        ids = {s['id'] for s in SWITCHES}
        saved = {k: v for k, v in _sw_saved().items() if k in ids and isinstance(v, bool)}
        saved[switch_id] = on
        f = _sw_file()
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_name(f.name + '.tmp')
        tmp.write_text(_sw_json.dumps(saved))
        _sw_os.replace(tmp, f)
    return switches_doc()


def _sw_owner(h, write):
    hd = h.headers
    if hd.get('Authorization') or hd.get('X-Wizard-Switch') != '1':
        return False
    if (hd.get('Sec-Fetch-Site') or 'same-origin').lower() not in ('same-origin', 'none'):
        return False
    host = (hd.get('Host') or '').strip().lower()
    name = host.split(']')[0] + ']' if host.startswith('[') else host.rsplit(':', 1)[0]
    if not name or name in _SW_LOCAL or '.' not in name:      # box-local and container hosts never prove the owner
        return False
    origin = hd.get('Origin')
    trusted = {o.strip() for o in (_sw_os.environ.get('WIZARD_TRUSTED_ORIGINS') or '').split(',') if o.strip()}
    if origin and _sw_urlsplit(origin).netloc.lower() != host and origin not in trusted:
        return False
    if write and not origin:
        return False
    logins = [x.strip() for x in (hd.get_all('Tailscale-User-Login') or [])]
    owners = {x.strip().lower() for x in (_sw_os.environ.get('WIZARD_OWNER_LOGINS') or '').split(',') if x.strip()}
    return len(logins) == 1 and '@' in logins[0] and (not owners or logins[0].lower() in owners)


def _sw_send(h, code, doc):
    body = _sw_json.dumps(doc).encode()
    h.send_response(code)
    h.send_header('Content-Type', 'application/json')
    h.send_header('Cache-Control', 'no-store')
    h.send_header('Content-Length', str(len(body)))
    h.end_headers()
    if h.command != 'HEAD':
        h.wfile.write(body)


def _sw_handle(h):
    """Serve /api/switches (or /<app>/api/switches) and return True; False for every other request."""
    if not _SW_ROUTE.fullmatch(_sw_urlsplit(h.path).path):
        return False
    if h.command in ('GET', 'HEAD'):
        if not _sw_owner(h, False):
            _sw_send(h, 403, {'error': "Only this Wizard's owner can see these switches.", 'code': 'owner_only'})
        else:
            _sw_send(h, 200, switches_doc())
        return True
    if not _sw_owner(h, True):
        _sw_send(h, 403, {'error': "Only this Wizard's owner can change these switches.", 'code': 'owner_only'})
        return True
    try:
        if (h.headers.get('Content-Type') or '').split(';')[0].strip() != 'application/json':
            raise ValueError
        size = int(h.headers.get('Content-Length') or '0')
        if size <= 0 or size > 4096:
            raise ValueError
        body = _sw_json.loads(h.rfile.read(size))
        if not isinstance(body, dict) or not isinstance(body.get('id'), str) or not isinstance(body.get('on'), bool) \
                or set(body) - {'id', 'on'}:
            raise ValueError
    except (ValueError, TypeError):
        _sw_send(h, 400, {'error': 'Send JSON {"id": "...", "on": true|false}', 'code': 'invalid_input'})
        return True
    if body['id'] not in {s['id'] for s in SWITCHES}:
        _sw_send(h, 404, {'error': 'No such switch', 'code': 'unknown_switch'})
        return True
    try:
        _sw_send(h, 200, _sw_set(body['id'], body['on']))
    except OSError:
        _sw_send(h, 500, {'error': 'storage_failure'})
    return True


def wizard_switches_install(handler_cls):
    """Route the switch endpoint ahead of the app's own GET/HEAD/POST handlers."""
    for method in ('do_GET', 'do_HEAD', 'do_POST'):
        orig = getattr(handler_cls, method, None)
        if getattr(orig, '_wizard_switches', False):
            continue

        def wrapped(self, _orig=orig):
            if _sw_handle(self):
                return None
            if _orig is None:
                return self.send_error(501)
            return _orig(self)
        wrapped._wizard_switches = True
        setattr(handler_cls, method, wrapped)
    return handler_cls
# ---- end wizard.app-switches/1 ---------------------------------------------------------------------------------------

wizard_switches_install(Handler)


if __name__ == '__main__':
    seed_seen()
    ThreadingHTTPServer((os.environ.get('BIND', '0.0.0.0'), int(_PORT)), Handler).serve_forever()
