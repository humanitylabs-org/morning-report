'use strict';
// Report sections (docs/report-section.md) in a real Chromium page against the real app server with a synthetic
// report: invisible mr: notes, heading links, "so far", the Chats · Badge · Morning report · Off picker under each
// app section (Chats/Badge locked), the Turned off list, Overnight pickers kept. Every write is captured and mocked.
//   REPORTS_DIR=tests/fixtures-sections PORT=<p> BIND=127.0.0.1 python3 app/server.py &
//   MR_STAGE_URL=http://127.0.0.1:<p> SHOTS=<dir> node tests/sections.browser.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/home/oscar/wizard-mobile/node_modules/playwright');
const base = process.env.MR_STAGE_URL || 'http://127.0.0.1:18813';
const shots = process.env.SHOTS || '';
const ROUTES = {
  routes: { 'report:wizard-health': 'daily', 'report:example-news': 'off' },
  defaults: { notifications: 'chats', 'system:app-updates': 'daily' },
  names: { notifications: 'Notifications', 'system:app-updates': 'App updates' },
  report: { prefix: 'report:', default: 'daily', allowed: ['daily', 'off'] }, saved: true,
};
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    for (const [name, vp] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
      const ctx = await browser.newContext({ viewport: vp, isMobile: name === 'phone', hasTouch: name === 'phone', serviceWorkers: 'block' });
      const posts = [], blocked = [], errors = [];
      await ctx.route('**/*', async (route) => {
        const req = route.request(), url = req.url();
        if (url.endsWith('/notifications/api/routes')) {
          if (req.method() === 'POST') {
            const body = JSON.parse(req.postData() || '{}'); posts.push(body);
            Object.assign(ROUTES.routes, body.routes || {});
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, routes: ROUTES.routes, saved: true }) });
          }
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(ROUTES) });
        }
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { blocked.push(req.method() + ' ' + url); return route.abort(); }
        if (url.endsWith('/wizard-os-home/core/app-client.js')) return route.fulfill({ contentType: 'text/javascript', body: '/* no shell */' });
        if (!url.startsWith(base + '/')) return route.abort();
        return route.continue();
      });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(base + '/', { waitUntil: 'networkidle' });
      await page.waitForSelector('#paper h2.mr-sec + .mr-route');
      await page.waitForSelector('#paper .mr-off .mr-route');
      const r = await page.evaluate(() => {
        const paper = document.getElementById('paper');
        const secs = [...paper.querySelectorAll('h2.mr-sec')];
        const pick = (h) => { const n = h.nextElementSibling; return n && n.classList.contains('mr-route') ? n : null; };
        const state = (seg) => [...seg.querySelectorAll('button')].map((b) => [b.dataset.to, b.getAttribute('aria-checked'), b.disabled]);
        const watch = [...paper.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Watch list');
        const night = [...paper.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Overnight');
        return {
          text: paper.innerText,
          secs: secs.map((h) => [h.querySelector('.mr-sec-link')?.textContent, h.querySelector('.mr-sec-link')?.getAttribute('href'),
                                 h.querySelector('.mr-sec-state')?.textContent || '', pick(h) ? state(pick(h)) : null]),
          watchPicker: !!(watch && pick(watch)),
          nightPicker: !!(night && night.nextElementSibling.querySelector('.mr-route')),
          off: [...paper.querySelectorAll('.mr-off-row')].map((r) => [r.querySelector('strong').textContent, state(r.querySelector('.mr-route-seg'))]),
          overflow: document.scrollingElement.scrollWidth - innerWidth,
          rightEdge: Math.max(...[...paper.querySelectorAll('.mr-route-seg')].map((s) => s.getBoundingClientRect().right)) - paper.getBoundingClientRect().right,
        };
      });
      assert.ok(!/<!--|mr:section|mr:edition|mr:off|just a comment/.test(r.text), 'notes stay invisible');
      const allFour = (cur) => [['chats', 'false', true], ['badge', 'false', true], ['daily', String(cur === 'daily'), false], ['off', String(cur === 'off'), false]];
      assert.deepEqual(r.secs, [['Today', '/wizard-calendar/', '', allFour('daily')], ['Health', '/wizard-health/', 'so far', allFour('daily')]]);
      assert.equal(r.watchPicker, false, 'a section without a note has no picker');
      assert.equal(r.nightPicker, true, 'Overnight pickers stay');
      assert.deepEqual(r.off, [['News', allFour('off')]]);
      assert.ok(r.overflow <= 0, name + ': no sideways scroll (' + r.overflow + ')');
      assert.ok(r.rightEdge <= 1, name + ': pickers stay on the paper (' + r.rightEdge + ')');
      if (shots) await page.screenshot({ path: path.join(shots, `sections-${name}.png`), fullPage: true });
      // Locked Chats does nothing; Off saves report:wizard-health once and says when it applies.
      const health = page.locator('h2.mr-sec', { hasText: 'Health' }).locator('xpath=following-sibling::div[1]');
      await health.locator('button[data-to="chats"]').click({ force: true });
      await health.locator('button[data-to="off"]').click();
      await page.waitForFunction(() => /next edition/.test(document.querySelector('h2.mr-sec:nth-of-type(2) + .mr-route .mr-route-note')?.textContent || ''));
      const after = await health.locator('button[data-to="off"]').getAttribute('aria-checked');
      assert.equal(after, 'true');
      assert.deepEqual(posts, [{ routes: { 'report:wizard-health': 'off' } }], 'one mocked save, nothing for the locked choice');
      if (shots) await health.screenshot({ path: path.join(shots, `sections-${name}-health-off.png`) });
      ROUTES.routes['report:wizard-health'] = 'daily';
      assert.deepEqual(blocked, [], 'no other writes');
      assert.deepEqual(errors, [], 'no page errors');
      console.log(name, 'ok', JSON.stringify({ overflow: r.overflow, rightEdge: r.rightEdge }));
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log('sections browser test: ok');
})().catch((e) => { console.error(e); process.exit(1); });
