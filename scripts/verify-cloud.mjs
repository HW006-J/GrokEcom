import { chromium, devices } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:3000';
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['iPhone 13 Pro'] });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
await p.goto(URL + '/', { waitUntil: 'domcontentloaded' });
await p.evaluate((o) => {
  localStorage.setItem('sellout.name', 'Luka');
  sessionStorage.setItem('sellout.objects', JSON.stringify(o));
}, JSON.parse(process.env.OBJS));
await p.goto(URL + '/objects', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

const sample = () => p.evaluate(() => {
  const c = document.querySelector('.cloud').getBoundingClientRect();
  return {
    cloud: { w: Math.round(c.width), h: Math.round(c.height), left: c.left, top: c.top },
    objs: [...document.querySelectorAll('.obj')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
    }),
  };
});

const a = await sample();
await p.waitForTimeout(2500);
const bb = await sample();

let moved = 0;
for (let i = 0; i < a.objs.length; i++) {
  const d = Math.hypot(bb.objs[i].x - a.objs[i].x, bb.objs[i].y - a.objs[i].y);
  if (d > 1.5) moved++;
}
console.log(`objects: ${a.objs.length}, moved over 2.5s: ${moved}`);

const out = bb.objs.filter((o) =>
  o.x < -1 || o.y < -1 || o.x + o.w > bb.cloud.w + 1 || o.y + o.h > bb.cloud.h + 1);
console.log('outside the frame:', out.length);

let overlaps = 0;
for (let i = 0; i < bb.objs.length; i++)
  for (let j = i + 1; j < bb.objs.length; j++) {
    const A = bb.objs[i], B = bb.objs[j];
    const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
    const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
    if (ox > 10 && oy > 10) overlaps++;
  }
console.log('overlapping pairs:', overlaps);

const chip = await p.evaluate(() => {
  const c = document.querySelector('.chip');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(window.innerWidth) };
});
console.log('chip:', JSON.stringify(chip), chip && (chip.left < 0 || chip.right > chip.width) ? 'OFF SCREEN' : 'on screen');
console.log('errors:', errs.length ? errs : 'none');
await p.screenshot({ path: '/tmp/shots/cloud-verify.png' });
await b.close();
