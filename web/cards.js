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

  const kinds = { portfolio, selling, health };
  /* Returns a node for a fenced block: a card for a known `lang`, else <pre>. */
  function render(lang, text) {
    if (kinds[lang]) {
      try { const d = JSON.parse(text); if (d && typeof d === 'object') return kinds[lang](d); } catch (e) { /* fall through */ }
    }
    const pre = h('pre', 'mr-pre'); pre.append(h('code', '', text)); return pre;
  }
  window.MorningCards = { render, kinds: Object.keys(kinds) };
})();
