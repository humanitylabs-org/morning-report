'use strict';
const el = (id) => document.getElementById(id);
const hosted = document.documentElement.classList.contains('wz-hosted');
let reports = [], current = null;

function say(text, kind = '') {
  const s = el('status');
  s.classList.toggle('wz-sr', !kind);
  s.classList.toggle('note', kind === 'note');
  s.textContent = text;
}
async function getJSON(path) {
  const r = await fetch(path, { cache: 'no-store' });
  let body = {};
  try { body = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(body.error || 'Could not load reports. Try again.');
  return body;
}
const longDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(innerWidth > 480 ? { year: 'numeric' } : {}), timeZone: 'UTC' });

function fillPicker() {
  const pick = el('pick');
  pick.replaceChildren();
  for (const r of reports.filter((x) => x.markdown)) {
    const o = document.createElement('option');
    o.value = r.date; o.textContent = shortDate(r.date);
    pick.append(o);
  }
  const n = reports.filter((x) => x.markdown).length;
  el('count').textContent = n ? `${n} edition${n === 1 ? '' : 's'}` : '';
}

const reply = window.MorningReply.bind({ paper: el('paper'), button: el('reply'), say });
let editionRequest = 0;
async function show(date) {
  const request = ++editionRequest;
  reply.clear();
  try {
    const data = await getJSON('api/reports/' + (date || 'latest'));
    if (request !== editionRequest) return;
    current = data;
    const paper = el('paper');
    paper.replaceChildren(window.MorningMarkdown.render(data.markdown));
    reply.clear(data.date);
    document.querySelector('.mr-scroll').scrollTop = 0;
    el('pick').value = data.date;
    el('older').disabled = !data.older;
    el('newer').disabled = !data.newer;
    const pdf = el('pdf');
    pdf.hidden = !data.pdf;
    if (data.pdf) pdf.href = 'api/reports/' + data.date + '.pdf';
    syncTitlebar();
    document.title = 'Morning Report · ' + shortDate(data.date);
    say(longDate(data.date));
    markSeen();
  } catch (error) { if (request === editionRequest) say(error.message, 'error'); }
}

el('pick').addEventListener('change', (e) => show(e.target.value));
/* Controls in the window's title bar when the host supports it (Wizard OS app title-bar tools), so the report
 * keeps the whole screen; otherwise the bottom bar. The title bar is used only once the shell confirms it shows. */
let inBar = false;
function syncTitlebar() {
  const WA = window.WizardApp; if (!WA?.titlebar || !current) return;
  const eds = reports.filter((r) => r.markdown);
  const tools = [
    { id: 'older', kind: 'button', icon: 'prev', label: 'Older report', disabled: !current.older },
    { id: 'date', kind: 'select', label: 'Report date', value: current.date, options: eds.map((r) => ({ value: r.date, label: shortDate(r.date) })) },
    { id: 'newer', kind: 'button', icon: 'next', label: 'Newer report', disabled: !current.newer },
  ];
  if (current.pdf) tools.push({ id: 'pdf', kind: 'link', text: 'PDF', label: 'Open PDF', href: 'api/reports/' + current.date + '.pdf' });
  Promise.resolve(WA.titlebar.set(tools, ({ id, value }) => {
    if (id === 'older' && current?.older) show(current.older);
    if (id === 'newer' && current?.newer) show(current.newer);
    if (id === 'date' && value && /^\d{4}-\d{2}-\d{2}$/.test(value)) show(value);
  })).then((ok) => {
    inBar = ok === true && WA.titlebar.shown?.() !== false;
    document.documentElement.classList.toggle('mr-in-bar', inBar);
  }).catch(() => {});
}
el('older').addEventListener('click', () => current?.older && show(current.older));
el('newer').addEventListener('click', () => current?.newer && show(current.newer));
document.addEventListener('keydown', (e) => {
  if (e.target.closest('select, input, textarea')) return;
  // Do not turn keyboard text selection (including Shift+arrows) into edition navigation.
  if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || !window.getSelection()?.isCollapsed) return;
  if (e.key === 'ArrowLeft' && current?.older) show(current.older);
  if (e.key === 'ArrowRight' && current?.newer) show(current.newer);
});

async function load() {
  try {
    const data = await getJSON('api/reports');
    reports = data.reports || [];
    fillPicker();
    const any = reports.some((r) => r.markdown);
    el('empty').hidden = any;
    el('paper').hidden = !any;
    document.querySelector('.mr-bar').hidden = !any;
    const wanted = new URLSearchParams(location.search).get('date');
    if (any) await show(wanted && /^\d{4}-\d{2}-\d{2}$/.test(wanted) ? wanted : (current?.date || null));
  } catch (error) { say(error.message, 'error'); }
}

/* Back contract (Wizard OS): no nested views, so the shell takes the step. Never push history in a frame. */
window.__wizardCloseOverlay = () => false;
if (!hosted) {
  let warnAt = 0;
  history.pushState({ wzGuard: 1 }, '', location.href);
  addEventListener('popstate', () => {
    if (Date.now() - warnAt < 2000) { history.back(); return; }
    warnAt = Date.now();
    say('Press back again to exit', 'note');
    history.pushState({ wzGuard: 1 }, '', location.href);
  });
}

/* Unread badge: editions newer than the newest one you have actually looked at. The shell shows the
 * count on this app's dock/bar mark (WizardApp.badge); a report counts as read once it is on screen
 * in a visible window. "Seen" (the newest edition date read) lives on the server, so the badge, the
 * Wizard OS inbox (api/inbox) and every device agree. The old per-device value is only a migration hint. */
const SEEN = 'morning-report.seen';
const localSeen = () => { try { return localStorage.getItem(SEEN) || ''; } catch (e) { return ''; } };
let serverSeen = null, seenKnown = false, marking = null;
const seen = () => serverSeen || '';
const looking = () => !document.hidden && (window.WizardApp?.view?.isVisible?.() ?? true);
function badge() {
  if (!seenKnown) return;
  const eds = reports.filter((r) => r.markdown);
  const s = seen(), n = s ? eds.filter((r) => r.date > s).length : Math.min(eds.length, 1);
  try { window.WizardApp?.badge?.set(n); } catch (e) {}
}
async function postSeen(date) {
  const r = await fetch('api/inbox/act', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'edition:' + date, action: 'done' }) });
  if (!r.ok) throw new Error('seen');
  if (date > seen()) serverSeen = date;
}
async function loadSeen() {
  try {
    const d = await getJSON('api/seen');
    serverSeen = typeof d.seen === 'string' ? d.seen : '';
    seenKnown = true;
    if (!serverSeen) {
      // No read state on the server yet: start from the newest edition (or this device's newer local value),
      // so an old report never shows up as a stale unread item.
      const eds = reports.filter((r) => r.markdown);
      const local = localSeen();
      const seed = local && eds.some((r) => r.date === local) ? local : eds[0]?.date;
      if (seed) await postSeen(seed).catch(() => {});
    }
  } catch (e) {}
  badge();
}
function markSeen() {
  if (!current?.date || !looking() || !seenKnown) return;
  if (current.date > seen() && marking !== current.date) {
    const date = marking = current.date;
    postSeen(date).then(badge, () => {}).finally(() => { if (marking === date) marking = null; });
  }
  badge();
}

async function refresh() {
  try {
    const newest = reports.find((r) => r.markdown)?.date;
    const d = await getJSON('api/reports');
    const top = (d.reports || []).find((r) => r.markdown)?.date;
    if (top && top !== newest) { const onNewest = current?.date === newest; reports = d.reports; fillPicker(); if (onNewest) await show(top); }
  } catch (e) {}
  await loadSeen(); markSeen();
}

load().then(loadSeen).then(markSeen);
// A new edition arrives each morning: check every few minutes while open, and whenever it comes back into view.
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(refresh, 5 * 60 * 1000);
// Read only when you actually look: re-check visibility often (cheap, no network).
setInterval(markSeen, 2000);
