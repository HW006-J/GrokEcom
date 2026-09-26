import { chromium, devices } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:3000/';
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await b.newContext({ ...devices['iPhone 13 Pro'], permissions: ['camera'] });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 140)));

await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);

if (await p.locator('input[placeholder="Your name"]').count()) {
  await p.fill('input[placeholder="Your name"]', 'Luka');
  await p.click('button[type="submit"]');
}
await p.waitForTimeout(3500);

const s = await p.evaluate(() => {
  const v = document.querySelector('video');
  return {
    srcObjectAttached: !!v?.srcObject,
    readyState: v?.readyState ?? null,
    videoSize: v ? `${v.videoWidth}x${v.videoHeight}` : null,
    playing: v ? !v.paused : null,
    opacity: v ? getComputedStyle(v).opacity : null,
  };
});
console.log('CAMERA:', JSON.stringify(s));
await p.screenshot({ path: '/tmp/shots/cam-verify.png' });
console.log('errors:', errs.length ? errs : 'none');
await b.close();
