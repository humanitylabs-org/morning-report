'use strict';
// Issue #27: a long-lived window follows new editions. Real app server on synthetic reports; the shell reuses an
// open window (no reload), so the page must move to a newly arrived edition on its own, unless the owner picked an
// edition by hand in the last ten minutes. Run: node tests/follow.browser.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), {spawn} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/home/oscar/wizard-mobile/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const port = 18874, base = `http://127.0.0.1:${port}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-follow-'));
const reports = path.join(tmp, 'reports'), data = path.join(tmp, 'data');
fs.mkdirSync(reports);
for (const f of ['synthetic-2026-01-01.md', 'synthetic-2026-01-02.md']) fs.copyFileSync(path.join(__dirname, 'fixtures', f), path.join(reports, f));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const add = (date) => fs.writeFileSync(path.join(reports, `synthetic-${date}.md`), `# Edition ${date}\n\nHello.\n`);

async function shown(page) { return page.evaluate(() => document.getElementById('pick').value); }
async function waitShown(page, date, ms = 5000) {
  for (let t = 0; t < ms; t += 100) { if (await shown(page) === date) return; await sleep(100); }
  assert.equal(await shown(page), date);
}

(async () => {
  const srv = spawn('python3', [path.join(root, 'app/server.py')], {env: {...process.env, PORT: String(port), BIND: '127.0.0.1', REPORTS_DIR: reports, DATA_DIR: data}, stdio: 'inherit'});
  const browser = await chromium.launch({headless: true});
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(base + '/healthz'); break; } catch (e) { await sleep(100); } }
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => { window.WizardApp = {badge: {set() {}}}; });

    // A: the owner browses back by hand, a new edition arrives. Within ten minutes of the pick it stays put;
    // after that the window moves to the new edition (before the fix it stayed on the old one for good).
    const a = await ctx.newPage();
    await a.clock.install();
    await a.goto(base + '/morning-report/', {waitUntil: 'domcontentloaded'});
    await waitShown(a, '2026-01-02');
    await a.click('#older');
    await waitShown(a, '2026-01-01');
    add('2026-01-03');
    await a.evaluate(() => dispatchEvent(new Event('focus')));
    await sleep(600);
    assert.equal(await shown(a), '2026-01-01', 'a fresh hand pick is kept');
    assert.ok(await a.evaluate(() => [...document.getElementById('pick').options].some((o) => o.value === '2026-01-03')), 'the picker lists the new edition');
    await a.clock.fastForward('11:00');
    await a.evaluate(() => dispatchEvent(new Event('focus')));
    await waitShown(a, '2026-01-03');
    assert.match(await a.textContent('#paper'), /Edition 2026-01-03/);

    // B: a window left on an older edition (not picked by hand) jumps to a new edition as soon as it is focused,
    // and a focus with nothing new never moves the owner off the edition they are reading.
    const b = await ctx.newPage();
    await b.goto(base + '/morning-report/?date=2026-01-02', {waitUntil: 'domcontentloaded'});
    await waitShown(b, '2026-01-02');
    await b.evaluate(() => dispatchEvent(new Event('focus')));
    await sleep(600);
    assert.equal(await shown(b), '2026-01-02', 'nothing new: stays');
    add('2026-01-04');
    await b.evaluate(() => dispatchEvent(new Event('focus')));
    await waitShown(b, '2026-01-04');

    // C: on the newest edition, the 5-minute check alone follows the next edition.
    add('2026-01-05');
    await a.clock.fastForward('11:00');
    await waitShown(a, '2026-01-05', 8000);
    console.log('follow.browser.test.js: ok');
  } finally { await browser.close(); srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
