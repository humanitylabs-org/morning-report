/* Overnight lines get the same picker as Settings › Notifications (Miguel, 2 Nov 2026): Chats · Badge · Morning report
 * · Off, one place per source. Each "Overnight" line is one source (App updates, App connections, Wizard updates,
 * Notifications); picking another place saves it on the box (Notifications /api/routes), so every device and
 * tomorrow's report follow it. Shown only when that Notifications app answers with the source names (feature
 * detection: an older Notifications, or none, simply shows the lines without pickers). Built with DOM nodes only.
 * Sections that come from apps (format wizard.report-section/1, docs/report-section.md) carry the same picker under
 * their heading, keyed `report:<section id>`: Morning report (the default) or Off, which takes effect from the next
 * edition. Chats and Badge show but stay unavailable until an app can send its section on its own (Notifications
 * refuses them). Sections turned Off are listed at the end of the report, each with its picker, so he can bring one
 * back. The heading links to the app, and a section that is not final yet says "so far". */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const ICON = {
    chats: { box: '0 0 16 16', d: 'M3 2.5h10A1.5 1.5 0 0 1 14.5 4v6a1.5 1.5 0 0 1-1.5 1.5H7.5L4.5 14v-2.5H3A1.5 1.5 0 0 1 1.5 10V4A1.5 1.5 0 0 1 3 2.5z', line: true },
    badge: { box: '0 0 16 16', circle: true },
    daily: { box: '0 0 512 512', d: 'M96 235H349V236Q353 236 357 236Q381 236 399 253Q416 270 416 295Q416 320 399 337Q381 354 357 354Q346 354 336 351C316 389 275 414 222 414C148 414 96 365 96 297V281H349V297C349 306 348 315 346 323Q351 325 357 325Q369 325 378 316Q387 307 387 295Q387 282 378 274Q369 265 357 265Q353 265 349 266V260H96ZM173 213Q162 199 163 181Q164 172 171 156Q176 144 176 138Q177 130 172 122Q169 117 170 110Q172 104 177 101Q183 97 189 99Q195 100 199 105Q209 123 207 141Q206 152 199 168Q195 180 194 184Q194 189 198 194Q202 199 201 205Q200 212 195 216Q190 220 184 219Q177 218 173 213ZM251 213Q240 199 241 181Q242 172 249 156Q254 144 254 138Q255 130 250 122Q247 117 248 110Q250 104 255 101Q260 97 267 99Q273 100 276 105Q287 123 285 141Q284 152 277 168Q273 180 272 184Q272 189 275 194Q280 199 279 205Q278 212 273 216Q268 220 262 219Q255 218 251 213Z' },
    off: { box: '0 0 16 16', d: 'M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM4.2 11.8l7.6-7.6', line: true },
  };
  const CHOICES = [['chats', 'Chats'], ['badge', 'Badge'], ['daily', 'Morning report'], ['off', 'Off']];
  const AFTER = { chats: 'New ones go to Chats from now on.', badge: 'New ones show as a badge from now on.', daily: 'Stays here, once a day.', off: 'Off from now on · still kept in Notifications.' };
  function icon(to) {
    const I = ICON[to], s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', I.box); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'mr-route-ic' + (I.line ? ' line' : ''));
    if (I.circle) { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', '8'); c.setAttribute('cy', '8'); c.setAttribute('r', '4.5'); s.append(c); }
    else { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', I.d); s.append(p); }
    return s;
  }
  let info = null, asked = null;
  async function load() {
    if (asked) return asked;
    asked = fetch('/notifications/api/routes', { cache: 'no-store', credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null).then(d => { info = d && d.names && d.routes ? d : null; return info; }, () => null)
      .finally(() => { setTimeout(() => { asked = null; }, 30e3); });
    return asked;
  }
  const isReport = id => String(id).startsWith('report:');
  const routeOf = id => (info.routes && info.routes[id]) || (info.defaults && info.defaults[id])
    || (isReport(id) && info.report && info.report.default) || 'badge';
  const allowed = (id, to) => !isReport(id) || !info.report || (info.report.allowed || []).includes(to);
  const NOT_YET = 'Chats and Badge come later: a section is in the report or off for now.';
  const AFTER_REPORT = { daily: 'In the report from the next edition.', off: 'Off from the next edition.' };
  async function save(id, to, seg, note) {
    for (const b of seg.querySelectorAll('button')) b.disabled = true;
    note.textContent = 'Saving…';
    try {
      const r = await fetch('/notifications/api/routes', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routes: { [id]: to } }) });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json(); if (d && d.routes) info.routes = d.routes;
      for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.to === to));
      note.textContent = (isReport(id) && AFTER_REPORT[to]) || AFTER[to];
    } catch (e) { note.textContent = 'Couldn’t save · try again'; }
    finally { for (const b of seg.querySelectorAll('button')) b.disabled = !!b.dataset.locked; }
  }
  function picker(id, name) {
    const wrap = document.createElement('div'); wrap.className = 'mr-route';
    const seg = document.createElement('div'); seg.className = 'mr-route-seg'; seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', 'Where ' + name + ' go');
    const cur = routeOf(id), note = document.createElement('span'); note.className = 'mr-route-note'; note.setAttribute('role', 'status');
    for (const [to, label] of CHOICES) {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.to = to; b.dataset.route = id;
      b.setAttribute('aria-checked', String(cur === to)); b.append(icon(to)); const t = document.createElement('span'); t.textContent = label; b.append(t);
      if (!allowed(id, to)) { b.disabled = true; b.dataset.locked = '1'; b.title = NOT_YET; }
      b.addEventListener('click', () => { if (b.getAttribute('aria-checked') !== 'true' && !b.dataset.locked) save(id, to, seg, note); });
      seg.append(b);
    }
    wrap.append(seg, note);
    return wrap;
  }
  const json = (t) => { try { const v = JSON.parse(t); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } };
  const localPath = (u) => typeof u === 'string' && /^\/[A-Za-z0-9._~\/?=&%-]*$/.test(u) && !u.startsWith('//') ? u : null;
  const routeId = (m) => m && typeof m.route === 'string' && /^report:[a-z0-9][a-z0-9-]{0,47}(\.[a-z0-9][a-z0-9-]{0,31})?$/.test(m.route) ? m.route : null;
  // App sections: the heading links to its app, says "so far" until final, and gets the picker (when routes answer).
  function sectionHeads(paper, d) {
    for (const h of paper.querySelectorAll('h2[data-section]')) {
      const m = json(h.dataset.section); if (!m) continue;
      if (!h.classList.contains('mr-sec')) {
        h.classList.add('mr-sec');
        const href = localPath(m.link);
        if (href) {
          const a = document.createElement('a'); a.className = 'mr-sec-link'; a.href = href; a.target = '_blank'; a.rel = 'noopener';
          a.append(...h.childNodes); h.append(a);
        }
        if (m.final === false) { const st = document.createElement('span'); st.className = 'mr-sec-state'; st.textContent = 'so far'; h.append(st); }
      }
      const id = routeId(m), next = h.nextElementSibling;
      if (d && d.report && id && !(next && next.classList.contains('mr-route'))) {
        h.after(picker(id, (h.querySelector('.mr-sec-link') || h).textContent.replace(/so far$/, '').trim()));
      }
    }
  }
  // Sections he turned Off: not in this edition, listed once at the end with their picker to bring them back.
  function offList(paper, d) {
    if (!d || !d.report || paper.querySelector('.mr-off')) return;
    const offs = [...paper.querySelectorAll('.mr-meta[data-kind="off"]')].map(n => json(n.dataset.json)).filter(m => routeId(m) && m.title);
    if (!offs.length) return;
    const box = document.createElement('section'); box.className = 'mr-off';
    const t = document.createElement('h2'); t.textContent = 'Turned off'; box.append(t);
    for (const m of offs) {
      const row = document.createElement('div'); row.className = 'mr-off-row';
      const name = document.createElement('strong'); name.textContent = String(m.title).slice(0, 40); row.append(name, picker(routeId(m), m.title));
      box.append(row);
    }
    paper.append(box);
  }
  // After a report is drawn: pickers under app sections, the Off list, and under each Overnight line naming a source.
  async function decorate(paper) {
    const hasSections = !!paper.querySelector('h2[data-section], .mr-meta[data-kind="off"]');
    const h = [...paper.querySelectorAll('h2')].find(x => x.textContent.trim().toLowerCase() === 'overnight');
    if (hasSections) sectionHeads(paper, null);  // links and "so far" even when Notifications does not answer
    if (!h && !hasSections) return;
    const d = await load(); if (!d || !paper.isConnected) return;
    if (hasSections) { sectionHeads(paper, d); offList(paper, d); }
    if (!h) return;
    const byName = {}; for (const [id, nm] of Object.entries(d.names)) byName[String(nm).toLowerCase()] = id;
    let n = h.nextElementSibling;
    while (n && n.tagName !== 'H2') {
      if (n.tagName === 'UL') for (const li of n.children) {
        const label = li.querySelector('strong'); const id = label && byName[label.textContent.trim().toLowerCase()];
        if (id && !li.querySelector('.mr-route')) li.append(picker(id, label.textContent.trim()));
      }
      n = n.nextElementSibling;
    }
  }
  window.MorningRoutes = { decorate };
})();
