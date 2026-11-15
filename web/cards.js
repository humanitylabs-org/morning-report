/* Cards: fenced blocks in a report that the app draws instead of printing as text.
 *   ```portfolio
 *   {"kind":"portfolio","v":1,"value":..,"cost":..,"cash":..,"positions":[{..,"history":[[unix,price],..]}]}
 *   ```
 * Built from DOM nodes only (report text never goes through innerHTML). A block that is not valid
 * JSON of a known kind falls back to plain preformatted text, so a bad block is visible, never hidden.
 * A portfolio is a total line plus one line per position: put in → worth now, a bar, and the P&L.
 * With a single position the card is just that position's line, named and linked. */
(() => {
  'use strict';
  const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
  /* Whole dollars and whole percents (anything above zero but under 1 shows as <$1 / <1%): the card is for a glance. */
  const money = (v, sign) => {
    const a = Math.abs(v), s = a >= 0.005 && a < 1 ? '<$1' : '$' + a.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return sign ? (v >= 0 ? '+' : '−') + s : (v < 0 ? '−' : '') + s;
  };
  const cents = (p) => { const c = Math.round(p * 1000) / 10; return (Number.isInteger(c) ? c : c.toFixed(1)) + '¢'; };
  const pct = (v) => { const a = Math.abs(v); return (v >= 0 ? '+' : '−') + (a >= 0.005 && a < 1 ? '<1' : a.toFixed(0)) + '%'; };
  const tone = (v) => (v > 0.00001 ? 'up' : v < -0.00001 ? 'down' : 'flat');
  const arrow = (v) => (v > 0.00001 ? '▲' : v < -0.00001 ? '▼' : '■');
  const safeUrl = (u) => { try { const x = new URL(u); return /^https:$/.test(x.protocol) ? x.href : null; } catch (e) { return null; } };

  /* Short label: the subject's surname ("Benjamin Netanyahu" -> Netanyahu), else the market title. */
  const label = (p) => { const n = String(p.name || p.market || 'Market').trim(); return p.name ? n.split(/\s+/).pop() : n; };

  /* Put in vs worth now: solid = money in (or what is left of it), dotted green = gain, hatched red = loss.
     Widths are shares of `scale` (the biggest amount on the card). When `usd` (amount -> US dollars) is known,
     the bar also joins a report-wide scale: after a render every card's bars are resized against the biggest
     dollar amount on the page, so the trades and the things for sale compare by size. */
  const shared = [];
  let pending = false;
  function rescale() {
    pending = false;
    for (let i = shared.length - 1; i >= 0; i--) if (!shared[i].base.isConnected) shared.splice(i, 1);
    const max = Math.max(...shared.map((x) => Math.max(x.a, x.b) * x.usd), 0);
    if (!(max > 0)) return;
    for (const x of shared) {
      x.base.style.width = (Math.min(x.a, x.b) * x.usd / max) * 100 + '%';
      x.diff.style.width = (Math.abs(x.b - x.a) * x.usd / max) * 100 + '%';
    }
  }
  function bar(cost, value, scale, usd) {
    const b = h('span', 'mr-pf-bar'); b.setAttribute('aria-hidden', 'true');
    const base = h('span', 'mr-pf-in'), diff = h('span', 'mr-pf-diff mr-' + tone(value - cost));
    base.style.width = (Math.min(cost, value) / scale) * 100 + '%';
    diff.style.width = (Math.abs(value - cost) / scale) * 100 + '%';
    b.append(base, diff);
    if (usd > 0) {
      shared.push({ base, diff, a: cost, b: value, usd });
      if (!pending) { pending = true; setTimeout(rescale, 0); }
    }
    return b;
  }

  /* One line: name · bar · $in → $now · ±$P&L ±%. */
  function line(name, cost, value, scale, url, cls) {
    const li = h('li', 'mr-pf' + (cls ? ' ' + cls : ''));
    const pnl = value - cost;
    const n = h(url ? 'a' : 'span', 'mr-pf-name', name);
    if (url) { n.href = url; n.target = '_blank'; n.rel = 'noopener noreferrer'; }
    li.append(n, bar(cost, value, scale, 1), h('span', 'mr-pf-amt', `${money(cost)} → ${money(value)}`),
      h('span', 'mr-pf-pl mr-' + tone(pnl), `${money(pnl, true)} ${cost ? pct((pnl / cost) * 100) : ''}`.trim()));
    li.setAttribute('aria-label', `${name}: put in ${money(cost)}, worth ${money(value)}, ${money(pnl, true)}${cost ? ', ' + pct((pnl / cost) * 100) : ''}`);
    return li;
  }

  function portfolio(d) {
    const ps = (d.positions || []).map((p) => ({ p, cost: num(p.cost) ?? 0, value: num(p.value) ?? num(p.cost) ?? 0 }));
    const cost = num(d.cost) ?? ps.reduce((s, x) => s + x.cost, 0), value = num(d.value) ?? ps.reduce((s, x) => s + x.value, 0);
    const list = h('ul', 'mr-card mr-portfolio');
    const scaleRows = Math.max(...ps.map((x) => Math.max(x.cost, x.value)), 0.01);
    /* One position: its own line (name + link) replaces the total, which would only repeat it without saying what the bet is. */
    if (ps.length === 1) { list.append(line(label(ps[0].p), cost, value, Math.max(cost, value, 0.01), safeUrl(ps[0].p.url || ''), 'mr-pf-total')); return list; }
    list.append(line('Total', cost, value, Math.max(cost, value, 0.01), '', 'mr-pf-total'));
    if (ps.length > 1) for (const x of ps) list.append(line(label(x.p), x.cost, x.value, scaleRows, safeUrl(x.p.url || '')));
    return list;
  }

  /* Selling: things the owner has listed for sale, one line each, same look as a portfolio.
   *   {"kind":"selling","v":1,"currency":"฿","usdRate":0.0296,"items":[{"name","url","price","market","state",
   *     "buyers","newBuyers","messages","newMessages","soldPrice"}]}
   * Line: name · bar · ฿asking · mkt ฿middle (each with ≈ dollars under it) · who is interested (or Deal/Sold).
   * Every bar shares one scale (the biggest price on the card) so items compare by size; asking above the market
   * middle draws hatched red, below dotted green. No total line (Miguel, 2 Nov 2026: a summed price means nothing).
   * The change since the last report leads (Miguel, 10 Nov 2026: the daily +n/±0 is what he cares about): "+2" in
   * colour when interest grew, a quiet grey "±0" when nothing changed, with the running totals small and grey under it
   * ("2 interested · 2 messages"). The change is newMessages, else newBuyers for older blocks.
   * "Buyer" is never used: nobody has bought anything. */
  function selling(d) {
    const cur = typeof d.currency === 'string' && d.currency.length <= 3 ? d.currency : '';
    const rate = num(d.usdRate) && d.usdRate > 0 ? d.usdRate : null;
    const amt = (v) => cur + Math.round(Math.abs(v)).toLocaleString('en-US');
    const usd = (v) => { const x = v * rate; return '$' + (x >= 100 ? Math.round(x / 10) * 10 : Math.round(x)).toLocaleString('en-US'); };
    const items = (d.items || []).map((it) => ({ it, price: num(it.price) ?? 0, market: num(it.market) }));
    const scale = Math.max(...items.map((x) => Math.max(x.price, x.market ?? 0)), 0.01);
    const list = h('ul', 'mr-card mr-portfolio mr-selling');
    /* -> { top, sub, tone, said } : two short lines and a spoken version for screen readers. */
    const status = (it) => {
      const sold = num(it.soldPrice);
      if (it.state === 'sold') { const t = 'Sold' + (sold ? ' ' + amt(sold) : ''); return { top: t, sub: '', tone: 'up', said: t }; }
      if (it.state === 'pending') { const t = 'Deal' + (sold ? ' ' + amt(sold) : ''); return { top: t, sub: '', tone: 'up', said: t }; }
      const b = num(it.buyers) ?? 0, m = num(it.messages), dm = num(it.newMessages) ?? num(it.newBuyers) ?? 0;
      const top = dm > 0 ? '+' + dm : '±0';
      const msgs = m != null ? `${m} message${m === 1 ? '' : 's'}` : '';
      const who = b ? `${b} interested` : 'No one yet';
      const sub = msgs ? `${who} · ${msgs}` : who;
      const said = `${dm > 0 ? dm + ' new since yesterday' : 'no change since yesterday'}, ${b ? b + ' interested' : 'no one interested yet'}${msgs ? ', ' + msgs : ''}`;
      return { top, sub, tone: dm > 0 ? 'up' : 'flat', fresh: dm > 0, said };
    };
    /* Amounts: two right-aligned columns, baht on top and (≈ dollars) right under it. */
    const money2 = (label, v) => {
      const c = h('span', 'mr-sl-col');
      c.append(h('span', 'mr-sl-main', (label ? label + ' ' : '') + amt(v)));
      if (rate) c.append(h('span', 'mr-sl-usd', '(' + usd(v) + ')'));
      return c;
    };
    const row = (name, price, market, url, st) => {
      const li = h('li', 'mr-pf');
      const n = h(url ? 'a' : 'span', 'mr-pf-name', name);
      if (url) { n.href = url; n.target = '_blank'; n.rel = 'noopener noreferrer'; }
      const b = bar(price, market ?? price, scale, rate);
      if (market) b.lastChild.className = 'mr-pf-diff mr-' + (price > market ? 'down' : price < market ? 'up' : 'flat');
      const a = h('span', 'mr-pf-amt');
      a.append(money2('', price), market ? money2('mkt', market) : h('span', 'mr-sl-col'));
      const s = h('span', 'mr-pf-pl mr-sl-st mr-' + st.tone);
      s.append(h('span', 'mr-sl-top' + (st.fresh ? ' mr-sl-new' : ''), st.top));
      if (st.sub) s.append(h('span', 'mr-sl-sub', st.sub));
      li.append(n, b, a, s);
      li.setAttribute('aria-label', `${name}: asking ${amt(price)}${rate ? ' (about ' + usd(price) + ')' : ''}${market ? ', typical ' + amt(market) : ''}, ${st.said}`);
      return li;
    };
    for (const x of items) list.append(row(String(x.it.name || 'Item'), x.price, x.market, safeUrl(x.it.url || ''), status(x.it)));
    return list;
  }

  /* Health: a few traffic-light tiles (one per metric the report sends), one plain line and a small 7-day strip.
   *   {"kind":"health","v":1,"day":"YYYY-MM-DD","label":"Yesterday","link":"/<app>/",
   *    "tiles":[{"name","value","word","tone","note"}],"line":"...",
   *    "strip":{"days":["YYYY-MM-DD",..],"rows":[{"name","tones":["green"|"yellow"|"red"|"grey"|null,..]}]}}
   * Tones are one shared scale: green good, yellow okay, red needs attention, grey no data. The last strip
   * column is the day the tiles show. `link` must be a same-origin path (/x/) or https. */
  const TONES = ['green', 'yellow', 'red', 'grey'];
  const toneOf = (t) => (TONES.includes(t) ? t : 'grey');
  const toneWord = { green: 'good', yellow: 'okay', red: 'needs attention', grey: 'no data' };
  const localPath = (u) => (typeof u === 'string' && /^\/[A-Za-z0-9._~-]/.test(u) && !/[\s\\]/.test(u) ? u : null);
  const dayName = (iso, opts) => { const t = Date.parse(String(iso) + 'T12:00:00Z'); return isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' }) : ''; };
  function health(d) {
    const card = h('section', 'mr-card mr-health');
    const head = h('div', 'mr-hl-head');
    const when = [String(d.label || '').slice(0, 40), dayName(d.day, { weekday: 'short', day: 'numeric', month: 'short' })].filter(Boolean).join(' · ');
    head.append(h('span', 'mr-hl-day', when));
    const href = localPath(d.link) || safeUrl(d.link || '');
    if (href) { const a = h('a', 'mr-hl-link', 'Open Health →'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; head.append(a); }
    card.append(head);
    const tiles = h('ul', 'mr-hl-tiles');
    for (const t of (Array.isArray(d.tiles) ? d.tiles : []).slice(0, 4)) {
      const tone = toneOf(t.tone), li = h('li', 'mr-hl-tile mr-t-' + tone);
      li.append(h('span', 'mr-hl-name', String(t.name || '')), h('span', 'mr-hl-num', String(t.value ?? '–')));
      const chip = h('span', 'mr-hl-chip'); chip.append(h('i', 'mr-hl-dot'), String(t.word || toneWord[tone]));
      li.append(chip);
      if (t.note) li.append(h('span', 'mr-hl-note', String(t.note)));
      li.setAttribute('aria-label', `${t.name}: ${t.value ?? 'no data'}, ${t.word || ''} (${toneWord[tone]})${t.note ? ', ' + t.note : ''}`);
      tiles.append(li);
    }
    tiles.style.setProperty('--k', Math.max(tiles.children.length, 1));
    card.append(tiles);
    if (d.line) card.append(h('p', 'mr-hl-line', String(d.line)));
    const s = d.strip && typeof d.strip === 'object' ? d.strip : null;
    const days = s && Array.isArray(s.days) ? s.days.slice(-14) : [];
    if (days.length && Array.isArray(s.rows) && s.rows.length) {
      const g = h('div', 'mr-hl-strip'); g.style.setProperty('--n', days.length);
      g.setAttribute('role', 'img');
      const desc = [];
      for (const r of s.rows.slice(0, 4)) {
        const tones = Array.isArray(r.tones) ? r.tones.slice(-days.length) : [];
        g.append(h('span', 'mr-hl-rname', String(r.name || '')));
        days.forEach((day, i) => {
          const tone = toneOf(tones[i]), q = h('i', 'mr-hl-sq mr-t-' + tone + (i === days.length - 1 ? ' mr-hl-now' : ''));
          q.title = `${r.name} ${dayName(day, { weekday: 'short', day: 'numeric', month: 'short' })}: ${toneWord[tone]}`;
          g.append(q);
        });
        desc.push(`${r.name}: ${tones.map((x) => toneWord[toneOf(x)]).join(', ')}`);
      }
      g.append(h('span', 'mr-hl-rname'));
      for (const day of days) g.append(h('span', 'mr-hl-dname', dayName(day, { weekday: 'narrow' })));
      g.setAttribute('aria-label', `Last ${days.length} days. ` + desc.join('. '));
      card.append(g);
    }
    return card;
  }

  /* Bets: Polymarket markets where big one-sided money and the odds moved the same way in the last day.
   *   {"kind":"bets","v":1,"hours":24,"items":[{"title","url","outcome":"Yes","side":"yes"|"no","then":0.32,"now":0.37,
   *     "net":69707,"wallets":1,"fresh":0,"bets":2}],"record":{"wins":17,"n":23,"implied":16.4,"pnl":-1.38}|null}
   * then/now are always the chance of `outcome` (Yes), so a bet against shows as Yes falling. One tile per market:
   * the question, an odds track (hollow ring = yesterday, filled = now, a coloured arrow between), the big number, and
   * who bet: a money bar on one scale across the card, a FOR/AGAINST badge and one dot per wallet. A plain sentence
   * says what it means. The track record is a row of squares (filled = came true) against what the odds expected. */
  const usdK = (v) => (v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : '$' + Math.round(v / 1e3) + 'k');
  const pc = (p) => { const x = p * 100; return (x > 0 && x < 1 ? '<1' : x > 99 && x < 100 ? '>99' : Math.round(x)) + '%'; };
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  function bets(d) {
    const items = (Array.isArray(d.items) ? d.items : []).slice(0, 5).map((it) => ({ it, then: clamp01(num(it.then) ?? 0), now: clamp01(num(it.now) ?? 0), net: Math.max(num(it.net) ?? 0, 0) }));
    const card = h('section', 'mr-card mr-bets');
    card.append(h('p', 'mr-bt-intro', `Big money bet on one side, and the odds moved its way in the last ${num(d.hours) || 24} hours.`));
    const maxNet = Math.max(...items.map((x) => x.net), 1);
    const list = h('ul', 'mr-bt-list');
    for (const { it, then, now, net } of items) {
      const out = String(it.outcome || 'Yes').slice(0, 24), against = it.side === 'no';
      const dir = now > then + 0.0001 ? 'up' : now < then - 0.0001 ? 'down' : 'flat';
      const li = h('li', 'mr-bt mr-' + dir);
      const url = safeUrl(it.url || '');
      const q = h(url ? 'a' : 'span', 'mr-bt-q', String(it.title || 'Market'));
      if (url) { q.href = url; q.target = '_blank'; q.rel = 'noopener noreferrer'; }
      li.append(q);
      /* Odds: track 0..100 with a coin-flip tick, ring at yesterday, dot now, arrow between; big number at the right. */
      const odds = h('div', 'mr-bt-odds');
      const track = h('span', 'mr-bt-track'); track.setAttribute('aria-hidden', 'true');
      const lo = Math.min(then, now), hi = Math.max(then, now);
      const mv = h('span', 'mr-bt-move'); mv.style.left = lo * 100 + '%'; mv.style.width = (hi - lo) * 100 + '%';
      const was = h('span', 'mr-bt-was'); was.style.left = then * 100 + '%';
      const is = h('span', 'mr-bt-is'); is.style.left = now * 100 + '%';
      track.append(h('span', 'mr-bt-mid'), mv, was, is);
      const scale = h('span', 'mr-bt-scale'); scale.setAttribute('aria-hidden', 'true');
      scale.append(h('span', '', '0'), h('span', '', '50/50'), h('span', '', '100%'));
      const big = h('span', 'mr-bt-big');
      const pts = Math.round((now - then) * 100);
      big.append(h('span', 'mr-bt-num', pc(now)), h('span', 'mr-bt-chg', `${arrow(now - then)} ${Math.abs(pts)} pts · was ${pc(then)}`));
      const tw = h('span', 'mr-bt-tw'); tw.append(track, scale);
      odds.append(h('span', 'mr-bt-lbl', `Chance of ${out}`), tw, big);
      li.append(odds);
      /* Money: bar on one scale, FOR/AGAINST badge, one dot per wallet. */
      const money = h('div', 'mr-bt-money');
      const mb = h('span', 'mr-bt-mbar'); mb.setAttribute('aria-hidden', 'true');
      const fill = h('span', 'mr-bt-mfill'); fill.style.width = Math.max(net / maxNet, 0.04) * 100 + '%'; mb.append(fill);
      const w = Math.max(num(it.wallets) ?? 1, 1), fresh = Math.min(num(it.fresh) ?? 0, w);
      const dots = h('span', 'mr-bt-dots'); dots.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < Math.min(w, 10); i++) dots.append(h('i', i < fresh ? 'mr-bt-new' : ''));
      const badge = h('span', 'mr-bt-side', against ? 'Against' : 'For');
      const right = h('span', 'mr-bt-right');
      right.append(h('span', 'mr-bt-usd', usdK(net)), badge, dots);
      money.append(h('span', 'mr-bt-lbl', 'Big bets'), mb, right);
      li.append(money);
      const said = `${w} bettor${w === 1 ? '' : 's'}${fresh ? ` (${fresh} brand-new)` : ''} put ${usdK(net)} on ${against ? 'No' : out}, and the odds followed: ${pc(then)} → ${pc(now)}.`;
      li.append(h('p', 'mr-bt-said', said));
      li.setAttribute('aria-label', `${it.title}. ${said}`);
      list.append(li);
    }
    card.append(list);
    /* Track record: a square per past pick, filled when it came true, beside what the odds expected. */
    const r = d.record && typeof d.record === 'object' ? d.record : null;
    const n = r ? Math.min(num(r.n) ?? 0, 200) : 0;
    if (n > 0) {
      const wins = Math.min(num(r.wins) ?? 0, n), exp = num(r.implied), pnl = num(r.pnl);
      const rec = h('div', 'mr-bt-rec');
      const sq = h('span', 'mr-bt-sqs'); sq.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < n; i++) sq.append(h('i', i < wins ? 'mr-bt-hit' : ''));
      const edge = exp == null ? '' : wins - exp >= 2 ? 'Better than the odds expected.' : exp - wins >= 2 ? 'Worse than the odds expected.' : 'About what the odds expected: no edge yet.';
      const txt = h('span', 'mr-bt-rtxt');
      txt.append(h('strong', '', `Track record: ${wins} of ${n} came true`),
        h('span', '', ` · odds expected ${exp != null ? Math.round(exp) : '?'}${pnl != null ? ` · $1 on each: ${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(2)}` : ''}. ${edge}`));
      rec.append(sq, txt);
      rec.setAttribute('aria-label', txt.textContent);
      card.append(rec);
    }
    card.append(h('p', 'mr-bt-foot', 'Crowd odds, not advice.'));
    return card;
  }

  /* Odds: Polymarket's chance that each AI model is out by each date, as one stacked bar per model.
   *   {"kind":"odds","v":1,"items":[{"label","url","points":[{"date":"YYYY-MM-DD","p":0.38,"ch":0.03}],"even":"YYYY-MM-DD"|null}]}
   * The card uses the first two dates any item has: dark = by the first date, light = extra chance by the second (odds
   * only grow with a later date). A dashed line marks 50/50. Rows run likeliest first; a big move today gets a chip,
   * and a 50/50 date past the bar is noted under the name. */
  function odds(d) {
    const items = (Array.isArray(d.items) ? d.items : []).slice(0, 12);
    const dates = [...new Set(items.flatMap((it) => (Array.isArray(it.points) ? it.points : []).map((p) => String(p.date || ''))))].filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort().slice(0, 2);
    const short = (iso) => dayName(iso, { day: 'numeric', month: 'short' });
    const card = h('section', 'mr-card mr-odds');
    const legend = h('div', 'mr-od-legend');
    dates.forEach((dt, i) => { const k = h('span', 'mr-od-key'); k.append(h('i', 'mr-od-sw mr-od-s' + i), 'by ' + short(dt)); legend.append(k); });
    const k50 = h('span', 'mr-od-key'); k50.append(h('i', 'mr-od-sw mr-od-s50'), 'coin flip'); legend.append(k50);
    card.append(legend);
    const rows = items.map((it) => {
      const at = {}; for (const p of Array.isArray(it.points) ? it.points : []) if (num(p.p) != null) at[String(p.date)] = p;
      const ps = dates.map((dt) => (at[dt] ? clamp01(at[dt].p) : null));
      return { it, at, ps, a: ps[0] ?? 0, b: ps[1] ?? ps[0] ?? 0 };
    }).sort((x, y) => y.a - x.a || y.b - x.b);
    const list = h('ul', 'mr-od-list');
    for (const { it, at, ps, a, b } of rows) {
      const li = h('li', 'mr-od');
      const url = safeUrl(it.url || '');
      const nm = h('span', 'mr-od-name');
      const t = h(url ? 'a' : 'span', 'mr-od-t', String(it.label || 'Model'));
      if (url) { t.href = url; t.target = '_blank'; t.rel = 'noopener noreferrer'; }
      nm.append(t);
      const even = /^\d{4}-\d{2}-\d{2}$/.test(String(it.even || '')) ? String(it.even) : null;
      if (even && dates.length && even > dates[dates.length - 1]) nm.append(h('span', 'mr-od-even', '50/50 by ' + dayName(even, { day: 'numeric', month: 'short', year: 'numeric' })));
      const bar = h('span', 'mr-od-bar'); bar.setAttribute('aria-hidden', 'true');
      const s0 = h('span', 'mr-od-s0'), s1 = h('span', 'mr-od-s1');
      s0.style.width = (ps[0] ?? 0) * 100 + '%'; s1.style.width = Math.max(b - (ps[0] ?? 0), 0) * 100 + '%';
      bar.append(s0, s1, h('span', 'mr-od-mid'));
      const vals = h('span', 'mr-od-vals');
      ps.forEach((p, i) => vals.append(h('span', 'mr-od-v' + i, p == null ? '–' : pc(p))));
      const near = dates.map((dt) => at[dt]).find(Boolean);
      const ch = near ? num(near.ch) ?? 0 : 0;
      vals.append(Math.abs(ch) >= 0.08 ? h('span', 'mr-od-chip mr-' + tone(ch), `${arrow(ch)}${Math.round(Math.abs(ch) * 100)} today`) : h('span', 'mr-od-chip mr-od-nochip'));
      li.append(nm, bar, vals);
      li.setAttribute('aria-label', `${it.label}: ` + dates.map((dt, i) => `${ps[i] == null ? 'no market' : pc(ps[i])} by ${short(dt)}`).join(', ') + (even ? `, 50/50 by ${even}` : ''));
      list.append(li);
    }
    card.append(list);
    return card;
  }

  const kinds = { portfolio, selling, health, bets, odds };
  /* Cards behind an app switch (wizard.app-switches/1, served by the box; the report response carries the owner's
   * state). Switch off: the block renders as nothing (never the raw JSON) and the text lines after it show as before.
   * Switch on: the card is drawn and settle() hides the text lines that follow it up to the next heading. */
  const gated = { bets: 'polymarket-cards', odds: 'polymarket-cards' };
  let on = new Set();
  function setSwitches(map) {
    on = new Set(map && typeof map === 'object' ? Object.keys(map).filter((k) => map[k] === true) : []);
  }
  /* After a render: hide the siblings after each gated card, up to the next h1/h2 (the generator's text copy). */
  function settle(root) {
    for (const card of [...root.children].filter((n) => n.classList.contains('mr-bets') || n.classList.contains('mr-odds'))) {
      for (let n = card.nextElementSibling; n && !/^H[12]$/.test(n.tagName); n = n.nextElementSibling) {
        if (n.classList.contains('mr-card')) break;
        n.hidden = true; n.classList.add('mr-card-text');
      }
    }
    return root;
  }
  /* Returns a node for a fenced block: a card for a known `lang`, else <pre>. */
  function render(lang, text) {
    if (gated[lang] && !on.has(gated[lang])) { const n = h('div', 'mr-card-off'); n.hidden = true; return n; }
    if (kinds[lang]) {
      try { const d = JSON.parse(text); if (d && typeof d === 'object') return kinds[lang](d); } catch (e) { /* fall through */ }
    }
    const pre = h('pre', 'mr-pre'); pre.append(h('code', '', text)); return pre;
  }
  window.MorningCards = { render, settle, setSwitches, kinds: Object.keys(kinds) };
})();
