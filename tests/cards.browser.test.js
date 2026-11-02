'use strict';
// cards.js `health` block: tiles, tones, strip, link safety and the <pre> fallback, in a real Chromium page.
// node tests/cards.browser.test.js   (PLAYWRIGHT_MODULE / CHROMIUM_PATH as in reply.browser.test.js)
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'cards.js'), 'utf8');
const block = {
  kind: 'health', v: 1, day: '2026-01-02', label: 'Last night', link: '/some-app/',
  tiles: [{ name: 'Alpha', value: '50%', word: 'Fine', tone: 'green', note: 'note a' },
          { name: 'Beta', value: '1h 2m', word: 'Low', tone: 'red' },
          { name: 'Gamma', value: '3', tone: 'purple' }],
  line: 'One plain line.',
  strip: { days: ['2025-12-27', '2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'],
           rows: [{ name: 'Alpha', tones: ['green', 'yellow', 'red', null, 'grey', 'green', 'green'] }, { name: 'Beta', tones: ['red'] }] },
};
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><div id="out"></div>');
    await page.addScriptTag({ content: src });
    const r = await page.evaluate((b) => {
      const put = (lang, text) => { const n = window.MorningCards.render(lang, text); document.getElementById('out').append(n); return n; };
      const card = put('health', JSON.stringify(b));
      const tiles = [...card.querySelectorAll('.mr-hl-tile')];
      const evil = ['javascript:void(0)', '//evil.example/', 'http://plain.example/', '/ok path/'].map((link) => {
        const c = put('health', JSON.stringify({ ...b, link })); return c.querySelector('a') ? c.querySelector('a').getAttribute('href') : null;
      });
      return {
        cls: card.className, k: card.querySelector('.mr-hl-tiles').style.getPropertyValue('--k'),
        tiles: tiles.map((t) => [t.className, t.querySelector('.mr-hl-num').textContent, t.querySelector('.mr-hl-chip').textContent, t.querySelector('.mr-hl-note')?.textContent || '']),
        head: card.querySelector('.mr-hl-day').textContent, href: card.querySelector('a.mr-hl-link').getAttribute('href'),
        line: card.querySelector('.mr-hl-line').textContent,
        squares: [...card.querySelectorAll('.mr-hl-sq')].map((q) => q.className),
        now: card.querySelectorAll('.mr-hl-now').length, dnames: card.querySelectorAll('.mr-hl-dname').length,
        evil, bad: put('health', '{not json').tagName, unknown: put('nope', '{}').tagName,
        kinds: window.MorningCards.kinds,
      };
    }, block);
    assert.equal(r.cls, 'mr-card mr-health');
    assert.equal(r.k, '3');
    assert.deepEqual(r.tiles, [
      ['mr-hl-tile mr-t-green', '50%', 'Fine', 'note a'],
      ['mr-hl-tile mr-t-red', '1h 2m', 'Low', ''],
      ['mr-hl-tile mr-t-grey', '3', 'no data', ''],
    ]);
    assert.equal(r.head, 'Last night · Fri 2 Jan');
    assert.equal(r.href, '/some-app/');
    assert.equal(r.line, 'One plain line.');
    assert.equal(r.squares.length, 14);
    assert.deepEqual(r.squares.slice(0, 7).map((c) => c.split(' ')[1]), ['mr-t-green', 'mr-t-yellow', 'mr-t-red', 'mr-t-grey', 'mr-t-grey', 'mr-t-green', 'mr-t-green']);
    assert.equal(r.squares[7], 'mr-hl-sq mr-t-red');
    assert.ok(r.squares.slice(8).every((c) => c.startsWith('mr-hl-sq mr-t-grey')), 'missing tones are grey');
    assert.equal(r.now, 2);
    assert.equal(r.dnames, 7);
    assert.deepEqual(r.evil, [null, null, null, null]);
    assert.equal(r.bad, 'PRE');
    assert.equal(r.unknown, 'PRE');
    assert.ok(r.kinds.includes('health'));
    // selling: no total line, "N interested" + "M messages · ±0/+n", never "buyer"
    const sell = await page.evaluate(() => {
      const c = window.MorningCards.render('selling', JSON.stringify({ kind: 'selling', v: 1, currency: '฿', usdRate: 0.03, items: [
        { name: 'A', price: 1200, market: 1950, state: 'for_sale', buyers: 0, newBuyers: 0, messages: 0, newMessages: 0 },
        { name: 'B', price: 31500, market: 24900, state: 'for_sale', buyers: 1, newBuyers: 0, messages: 1, newMessages: 0 },
        { name: 'C', price: 100, state: 'for_sale', buyers: 2, newBuyers: 1, messages: 5, newMessages: 3 },
        { name: 'D', price: 100, state: 'for_sale', buyers: 1, newBuyers: 1 },
        { name: 'E', price: 100, state: 'sold', soldPrice: 90 }] }));
      document.getElementById('out').append(c);
      return { rows: c.querySelectorAll('li').length, total: c.querySelectorAll('.mr-pf-total').length,
        st: [...c.querySelectorAll('.mr-sl-st')].map((s) => [...s.children].map((x) => x.textContent)),
        fresh: c.querySelectorAll('.mr-sl-new').length, text: c.textContent, aria: c.querySelector('li:nth-child(2)').getAttribute('aria-label') };
    });
    assert.equal(sell.rows, 5);
    assert.equal(sell.total, 0);
    assert.deepEqual(sell.st, [['No one yet', '0 messages · ±0'], ['1 interested', '1 message · ±0'], ['2 interested', '5 messages · +3'], ['1 interested', '+1'], ['Sold ฿90']]);
    assert.equal(sell.fresh, 2);
    assert.ok(!/buyer/i.test(sell.text), 'never says buyer');
    assert.match(sell.aria, /1 interested, 1 message, no change since yesterday/);
    console.log('cards.browser.test: ok');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
