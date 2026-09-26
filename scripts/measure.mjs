import { chromium, devices } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['iPhone 13 Pro'] });
const p = await ctx.newPage();
// seed objects straight into sessionStorage so we land on the cloud
await p.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
const objs = JSON.parse(process.env.OBJS);
await p.evaluate((o) => sessionStorage.setItem('sellout.objects', JSON.stringify(o)), objs);
await p.goto('http://localhost:3000/objects', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);
const data = await p.evaluate(() => {
  const cloud = document.querySelector('.cloud').getBoundingClientRect();
  const objs = [...document.querySelectorAll('.obj')].map((el, i) => {
    const r = el.getBoundingClientRect();
    const img = el.querySelector('img');
    const ir = img.getBoundingClientRect();
    return {
      i,
      box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      img: [Math.round(ir.left), Math.round(ir.top), Math.round(ir.width), Math.round(ir.height)],
      natural: [img.naturalWidth, img.naturalHeight],
    };
  });
  return { cloud: [Math.round(cloud.left), Math.round(cloud.top), Math.round(cloud.width), Math.round(cloud.height)], objs };
});
console.log('cloud  x,y,w,h =', data.cloud.join(', '));
const [cx, cy, cw, ch] = data.cloud;
for (const o of data.objs) {
  const [x, y, w, h] = o.box;
  const out = [];
  if (x < cx) out.push('LEFT');
  if (y < cy) out.push('TOP');
  if (x + w > cx + cw) out.push('RIGHT');
  if (y + h > cy + ch) out.push('BOTTOM');
  console.log(`obj${o.i} box=${w}x${h} at ${x},${y}  img=${o.img[2]}x${o.img[3]}  natural=${o.natural.join('x')}  ${out.length ? 'OVERFLOWS ' + out.join('+') : 'inside'}`);
}
// overlaps
for (let i = 0; i < data.objs.length; i++)
  for (let j = i + 1; j < data.objs.length; j++) {
    const a = data.objs[i].img, c = data.objs[j].img;
    const ox = Math.min(a[0]+a[2], c[0]+c[2]) - Math.max(a[0], c[0]);
    const oy = Math.min(a[1]+a[3], c[1]+c[3]) - Math.max(a[1], c[1]);
    if (ox > 8 && oy > 8) console.log(`  images ${i} and ${j} overlap by ${ox}x${oy}px`);
  }
await b.close();
