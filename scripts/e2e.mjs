import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const SHOTS = '/tmp/shots';
const log = [];
const errors = [];

const shot = async (page, name) => {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  log.push(`shot: ${name}`);
};

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    ...devices['iPhone 13 Pro'],
    permissions: [],
  });
  const page = await ctx.newPage();

  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url().replace(BASE, '')}`);
  });

  // 1. Scan screen, name gate
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await shot(page, '01-name-gate');
  const gate = await page.locator('input[placeholder="Your name"]').count();
  log.push(`name gate present: ${gate === 1}`);

  await page.fill('input[placeholder="Your name"]', 'Luka');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(900);
  await shot(page, '02-camera');

  // 2. Supply a real room photo through the hidden capture input
  const file = '/tmp/room.jpg';
  if (!fs.existsSync(file)) throw new Error('missing /tmp/room.jpg');
  await page.setInputFiles('input[type="file"]', file);
  log.push('photo submitted, waiting for the scan');
  await shot(page, '03-scanning');

  // wait for the reveal, then the found state
  await page.waitForFunction(
    () => /objects found|did not come back/i.test(document.body.innerText),
    { timeout: 90_000 }
  ).catch(() => log.push('WARN: never reached the found state'));
  await page.waitForTimeout(2200);
  await shot(page, '04-found');
  log.push(`found text: ${(await page.locator('body').innerText()).match(/\d+ objects found/)?.[0] ?? 'none'}`);

  // 3. Review screen
  await page.click('text=/objects found/').catch(() => {});
  await page.waitForURL('**/review', { timeout: 15_000 }).catch(() => log.push('WARN: did not reach /review'));
  await page.waitForTimeout(2500);
  await shot(page, '05-review');
  const cards = await page.locator('[data-card]').count();
  log.push(`review cards: ${cards}`);
  log.push(`review header: ${(await page.locator('h1').innerText().catch(() => '—'))}`);

  // let the live pricing land
  await page.waitForFunction(
    () => !/checking live prices/i.test(document.body.innerText),
    { timeout: 120_000 }
  ).catch(() => log.push('WARN: prices never settled'));
  await page.waitForTimeout(800);
  await shot(page, '06-review-priced');
  log.push(`priced header: ${(await page.locator('p.sub').first().innerText().catch(() => '—'))}`);

  // give the cutouts, started on this screen, time to land
  await page.waitForTimeout(45_000);
  await shot(page, '06b-review-cutouts');
  log.push(`cutouts ready on review: ${await page.evaluate(() => {
    try { return (JSON.parse(sessionStorage.getItem('sellout.objects')) || []).filter(o => o.cutout).length; } catch { return 'n/a'; }
  })}`);

  // 4. Into the cloud
  await page.click('text=/^Sell \\d+/').catch(() => log.push('WARN: no Sell button'));
  await page.waitForURL('**/objects', { timeout: 15_000 }).catch(() => log.push('WARN: did not reach /objects'));
  await page.waitForTimeout(3000);
  await shot(page, '07-cloud');
  log.push(`cloud objects: ${await page.locator('.obj').count()}`);

  // give cutouts a chance to swap in
  await page.waitForTimeout(12_000);
  await shot(page, '08-cloud-cutouts');
  log.push(`cloud placeholders: ${await page.locator('.obj-pending').count()}, images: ${await page.locator('.obj img').count()}`);

  // 5. The sale
  await page.click('text=/Start the sale/').catch(() => log.push('WARN: no Start the sale button'));
  await page.waitForURL('**/auction', { timeout: 15_000 }).catch(() => log.push('WARN: did not reach /auction'));
  await page.waitForTimeout(4000);
  await shot(page, '09-auction');
  log.push(`auction text: ${(await page.locator('body').innerText()).slice(0, 220).replace(/\n+/g, ' | ')}`);

  // 6. Dashboard
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await shot(page, '10-dashboard');
  log.push(`dashboard: ${(await page.locator('body').innerText()).slice(0, 160).replace(/\n+/g, ' | ')}`);

  await browser.close();
};

run()
  .catch((e) => errors.push(`FATAL: ${e.message}`))
  .finally(() => {
    console.log('--- LOG ---');
    log.forEach((l) => console.log(' ', l));
    console.log('--- PROBLEMS ---');
    if (!errors.length) console.log('  none');
    [...new Set(errors)].forEach((e) => console.log(' ', e));
  });
