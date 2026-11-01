'use strict';
// Server-side read state, end to end: real app server on synthetic reports, two browser "devices".
// Badge (WizardApp.badge stub), the inbox feed and both devices must agree. Run: node tests/inbox.browser.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), {spawn} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/home/oscar/wizard-mobile/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const port = 18873, base = `http://127.0.0.1:${port}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-inbox-b-'));
const reports = path.join(tmp, 'reports'), data = path.join(tmp, 'data');
fs.mkdirSync(reports);
for (const f of ['synthetic-2026-01-01.md', 'synthetic-2026-01-02.md']) fs.copyFileSync(path.join(__dirname, 'fixtures', f), path.join(reports, f));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p) => (await fetch(base + '/morning-report/' + p)).json();
const seenFile = () => JSON.parse(fs.readFileSync(path.join(data, 'seen.json'), 'utf8')).seen;

(async () => {
  const srv = spawn('python3', [path.join(root, 'app/server.py')], {env: {...process.env, PORT: String(port), BIND: '127.0.0.1', REPORTS_DIR: reports, DATA_DIR: data}, stdio: 'inherit'});
  const browser = await chromium.launch({headless: true});
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(base + '/healthz'); break; } catch (e) { await sleep(100); } }
    // Startup seeding: newest existing edition counts as read, so no stale item after an upgrade.
    assert.equal(seenFile(), '2026-01-02');
    assert.deepEqual((await api('api/inbox')).items, []);
    fs.writeFileSync(path.join(reports, 'synthetic-2026-01-03.md'), '# Synthetic edition three\n\nHello.\n');
    assert.equal((await api('api/inbox')).items[0].key, 'edition:2026-01-03');

    async function device(visible) {
      const ctx = await browser.newContext();
      const writes = [];
      await ctx.route('**/*', (route) => {
        const req = route.request();
        if (!req.url().startsWith(base + '/')) return route.abort();
        if (req.method() !== 'GET' && req.method() !== 'HEAD') writes.push(`${req.method()} ${new URL(req.url()).pathname} ${req.postData()}`);
        return route.continue();
      });
      await ctx.addInitScript((v) => { window.__badge = []; window.__visible = v;
        window.WizardApp = {badge: {set(n) { window.__badge.push(n); }}, view: {isVisible: () => window.__visible}}; }, visible);
      const page = await ctx.newPage();
      await page.goto(base + '/morning-report/', {waitUntil: 'domcontentloaded'});
      await page.waitForFunction(() => window.__badge.length > 0, null, {timeout: 10000}); await sleep(300);
      return {ctx, page, writes, badge: () => page.evaluate(() => window.__badge.at(-1))};
    }
    // Device B: app open but not on screen. Unread stays unread; badge 1 matches the inbox item.
    const b = await device(false);
    assert.equal(await b.badge(), 1); assert.deepEqual(b.writes, []);
    assert.equal(seenFile(), '2026-01-02');
    // Device A looks at the newest edition: marks it seen on the server via the inbox act endpoint.
    const a = await device(true);
    assert.equal(seenFile(), '2026-01-03');
    assert.deepEqual(a.writes, ['POST /morning-report/api/inbox/act {"key":"edition:2026-01-03","action":"done"}']);
    assert.equal(await a.badge(), 0);
    assert.deepEqual((await api('api/inbox')).items, []);
    // Device B catches up on its next refresh (it comes back into view) without marking anything itself.
    await b.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await sleep(400);
    assert.equal(await b.badge(), 0); assert.deepEqual(b.writes, []);
    // Looking at an older edition never moves read state backwards.
    await a.page.selectOption('#pick', '2026-01-01'); await sleep(2500);
    assert.equal(seenFile(), '2026-01-03'); assert.equal(a.writes.length, 1);

    // Migration: no server value yet (e.g. data volume just added). A device seeds it with the newest edition.
    fs.rmSync(path.join(data, 'seen.json'));
    const c = await device(false);
    assert.equal(seenFile(), '2026-01-03'); assert.equal(await c.badge(), 0);
    assert.deepEqual((await api('api/inbox')).items, []);
    for (const d of [a, b, c]) await d.ctx.close();
    console.log('PASS inbox browser: badge = inbox across two devices, read only when on screen, never backwards, seed on migration');
  } finally {
    await browser.close(); srv.kill(); fs.rmSync(tmp, {recursive: true, force: true});
  }
})().catch((e) => { console.error(e); process.exit(1); });
