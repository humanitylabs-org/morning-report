'use strict';
// cards.js `bets` and `odds` blocks behind the `polymarket-cards` switch (humanitylabs-org/morning-report#22), in a
// real Chromium page: switch off draws nothing and keeps the text lines; switch on draws the card, hides the text
// lines after it up to the next heading, and lays out without overflow at 820px and 400px.
// node tests/polymarket.browser.test.js   (PLAYWRIGHT_MODULE / CHROMIUM_PATH as in reply.browser.test.js)
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = (f) => fs.readFileSync(path.join(__dirname, '..', 'web', f), 'utf8');
const bets = {
  kind: 'bets', v: 1, hours: 24,
  items: [
    { title: 'Will it rain on Mars?', url: 'https://polymarket.com/event/x', outcome: 'Yes', side: 'yes', then: 0.32, now: 0.37, net: 69707, wallets: 1, fresh: 0, bets: 2 },
    { title: 'Will the thing ship by Friday?', url: 'javascript:alert(1)', outcome: 'Yes', side: 'no', then: 0.6, now: 0.41, net: 1250000, wallets: 3, fresh: 2, bets: 5 },
  ],
  record: { wins: 17, n: 23, implied: 16.4, pnl: -1.38 },
};
const odds = {
  kind: 'odds', v: 1,
  items: [
    { label: 'Model B', url: 'https://polymarket.com/event/b', points: [{ date: '2026-12-31', p: 0.2, ch: 0.01 }, { date: '2027-03-31', p: 0.45, ch: 0 }], even: '2027-06-30' },
    { label: 'Model A', url: 'https://polymarket.com/event/a', points: [{ date: '2026-12-31', p: 0.38, ch: 0.13 }, { date: '2027-03-31', p: 0.7, ch: 0.02 }], even: null },
  ],
};
const md = [
  '# Morning report', '',
  '## Polymarket', '*Big one-sided bets in the last day.*', '',
  '```bets', JSON.stringify(bets), '```', '',
  '- Will it rain on Mars? 32% → 37%', '- Will the thing ship by Friday? 60% → 41%', '',
  'Track record: 17 of 23.', '',
  '## Polymarket watch list', '',
  '```odds', JSON.stringify(odds), '```', '',
  '- Model A: 38% by 31 Dec, 70% by 31 Mar', '',
  '## Weather', '', 'Sunny.', '',
].join('\n');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 820, height: 1200 } });
    await page.setContent(`<!doctype html><style>${web('styles.css')}</style><div class="mr-paper" id="out" style="--font: system-ui, sans-serif"></div>`);
    await page.addScriptTag({ content: web('cards.js') });
    await page.addScriptTag({ content: web('markdown.js') });
    const draw = (sw) => page.evaluate(([text, sw]) => {
      window.MorningCards.setSwitches(sw);
      const out = document.getElementById('out');
      out.replaceChildren(window.MorningMarkdown.render(text));
      const shown = (sel) => [...out.querySelectorAll(sel)].filter((n) => !n.closest('[hidden]')).map((n) => n.textContent.trim());
      return { li: shown('li'), p: shown('p'), pre: out.querySelectorAll('pre').length, bets: out.querySelectorAll('.mr-bets').length,
        odds: out.querySelectorAll('.mr-odds').length, raw: out.textContent.includes('"kind"') && !!shown('*').find((t) => t.includes('"kind"')) };
    }, [md, sw]);

    // Switch off (default, or anything but true): no card, no raw JSON, every text line as today.
    for (const sw of [undefined, {}, { 'polymarket-cards': false }, { 'polymarket-cards': 'yes' }]) {
      const r = await draw(sw);
      assert.equal(r.bets + r.odds + r.pre, 0, 'off: nothing drawn for bets/odds');
      assert.equal(r.raw, false, 'off: never the raw JSON');
      assert.equal(r.li.length, 3, 'off: every bullet line shows');
      assert.ok(r.p.includes('Track record: 17 of 23.') && r.p.includes('Sunny.'));
    }

    // Switch on: both cards, the text lines after each card are hidden, the intro above and other sections stay.
    const on = await draw({ 'polymarket-cards': true });
    assert.equal(on.bets, 1); assert.equal(on.odds, 1); assert.equal(on.pre, 0);
    assert.ok(on.p.includes('Big one-sided bets in the last day.'), 'intro line above the card stays');
    assert.ok(on.p.includes('Sunny.'), 'next section untouched');
    assert.ok(!on.p.includes('Track record: 17 of 23.'), 'note after the card is hidden');
    assert.ok(!on.li.some((t) => t.startsWith('Model A:') || t.startsWith('Will it rain on Mars? 32%')), 'bullet lines after the card are hidden');

    const d = await page.evaluate(() => {
      const b = document.querySelector('.mr-bets'), o = document.querySelector('.mr-odds');
      const rows = (c) => [...c.querySelectorAll('.mr-pm-row:not(.mr-pm-head)')];
      const w = (n) => n ? Math.round(parseFloat(n.style.width)) : null;
      const bar = (r) => [w(r.querySelector('.mr-pm-fill')), w(r.querySelector('.mr-pm-gain')), w(r.querySelector('.mr-pm-loss'))];
      return {
        heads: [b, o].map((c) => [...c.querySelectorAll('.mr-pm-head .mr-pm-n')].map((n) => n.textContent)),
        bets: rows(b).map((r) => [r.querySelector('.mr-pm-name').tagName, r.querySelector('.mr-pm-name').getAttribute('href'),
          r.querySelector('.mr-pm-name').textContent, ...[...r.querySelectorAll('.mr-pm-n')].map((n) => n.textContent)]),
        betBars: rows(b).map(bar),
        odds: rows(o).map((r) => [r.querySelector('.mr-pm-name').textContent, ...[...r.querySelectorAll('.mr-pm-n')].map((n) => n.textContent)]),
        oddBars: rows(o).map(bar),
        foot: b.querySelector('.mr-pm-foot')?.textContent, oddFoot: o.querySelector('.mr-pm-foot'),
        text: b.textContent + o.textContent,
        colours: [...b.querySelectorAll('*'), ...o.querySelectorAll('*')].map((n) => getComputedStyle(n).color + ' ' + getComputedStyle(n).backgroundColor),
        label: rows(b)[0].getAttribute('aria-label'),
        kinds: window.MorningCards.kinds,
      };
    });
    assert.deepEqual(d.heads, [['Yes', '24h', 'Bets'], ['31 Dec', '24h', '31 Mar']]);
    assert.deepEqual(d.bets, [
      ['A', 'https://polymarket.com/event/x', 'Will it rain on Mars?', '37%', '+5', '$70k'],
      ['SPAN', null, 'Will the thing ship by Friday?', '41%', '−19', '$1.3M'],
    ], 'only https links; sign-only direction');
    assert.deepEqual(d.betBars, [[32, 5, null], [41, null, 19]], 'filled = now, grey = gained, outline = lost');
    assert.deepEqual(d.odds, [['Model A', '38%', '+13', '70%'], ['Model B', '20%', '+1', '45%']], 'likeliest first');
    assert.deepEqual(d.oddBars, [[25, 13, null], [19, 1, null]]);
    assert.equal(d.foot, 'Past picks: 17 of 23 came true (odds expected 16)');
    assert.equal(d.oddFoot, null);
    for (const gone of ['not advice', '▲', '▼', 'For', 'Against', 'bettor', 'Big money']) assert.ok(!d.text.includes(gone), `no "${gone}"`);
    const rgb = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
    const tinted = d.colours.flatMap((s) => s.split(') ').map(rgb)).filter(([r, g, bl]) => r != null && Math.max(r, g, bl) - Math.min(r, g, bl) > 40);
    assert.deepEqual(tinted, [], 'no green/red: ink and greys only');
    assert.equal(d.label, 'Will it rain on Mars?: 37%, +5 in 24 hours, $70k of big bets');
    assert.ok(d.kinds.includes('bets') && d.kinds.includes('odds'));
    assert.ok(web('cards.js').includes('function bets(') && web('cards.js').includes('function odds('), 'generator probe strings');

    // Layout: nothing spills out of its card at desktop and phone width.
    for (const width of [820, 400]) {
      await page.setViewportSize({ width, height: 1200 });
      const spill = await page.evaluate(() => {
        const bad = [];
        for (const card of document.querySelectorAll('.mr-bets, .mr-odds')) {
          const c = card.getBoundingClientRect();
          for (const n of card.querySelectorAll('*')) {
            const r = n.getBoundingClientRect();
            if (r.width && (r.left < c.left - 8 || r.right > c.right + 8)) bad.push(n.className + ' ' + Math.round(r.left) + '-' + Math.round(r.right) + ' in ' + Math.round(c.left) + '-' + Math.round(c.right));
          }
        }
        return bad;
      });
      assert.deepEqual(spill, [], `no overflow at ${width}px`);
      const phone = await page.evaluate(() => {
        const r = document.querySelector('.mr-bets .mr-pm-row:not(.mr-pm-head)');
        const n = r.querySelector('.mr-pm-name').getBoundingClientRect(), bar = r.querySelector('.mr-pm-bar').getBoundingClientRect();
        return bar.top >= n.bottom - 1;
      });
      assert.equal(phone, width <= 520 + 40, `name on its own line only on a phone (${width}px)`);
      const wrapped = await page.evaluate(() => [...document.querySelectorAll('.mr-pm-n')]
        .filter((n) => n.getClientRects().length > 1 || n.getBoundingClientRect().height > 30).map((n) => n.textContent));
      assert.deepEqual(wrapped, [], `numbers stay on one line at ${width}px`);
    }
    // Bad JSON with the switch on falls back to <pre> (visible, never hidden) and keeps the text after it.
    const bad = await page.evaluate(() => {
      window.MorningCards.setSwitches({ 'polymarket-cards': true });
      const f = window.MorningMarkdown.render('## P\n\n```bets\n{not json\n```\n\n- line');
      return [f.querySelector('pre') ? 'PRE' : '', f.querySelector('li').hidden];
    });
    assert.deepEqual(bad, ['PRE', false]);
    console.log('polymarket cards: ok');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
