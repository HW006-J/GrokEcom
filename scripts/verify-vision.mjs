// Real detector/masks plus browser flow. No auction is opened.
// node scripts/verify-vision.mjs /path/to/room.jpg [/path/to/people-scene.jpg]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, devices } from 'playwright';
import sharp from 'sharp';

const photo = process.argv[2];
assert(photo, 'Pass a room photo.');
const base = process.env.BASE ?? 'http://localhost:3000';
const output = process.env.OUTPUT ?? '/tmp/grokecom-grounded-e2e';
await fs.mkdir(output, { recursive: true });
const oriented = path.join(output, 'oriented.jpg');
await sharp(photo).rotate(270).withMetadata({ orientation: 6 }).jpeg().toFile(oriented);
const browser = await chromium.launch();
const page = await browser.newPage({ ...devices['iPhone 13 Pro'] });
const errors = [], requests = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { if (r.url().includes('/api/')) requests.push(new URL(r.url()).pathname); });
try {
  await page.goto(base);
  await page.getByPlaceholder('Your name').fill('Vision test');
  await page.locator('button[type="submit"]').click();
  const scan = page.waitForResponse(r => r.url().endsWith('/api/scan'), { timeout: 120_000 });
  const started = Date.now();
  await page.locator('input[type=file]').setInputFiles(oriented);
  await page.getByRole('button', { name: 'Cancel scan' }).waitFor();
  const response = await scan;
  assert.equal(response.status(), 200);
  const data = await response.json();
  const scanMs = Date.now() - started;
  assert(data.lots.length > 0);
  assert(data.lots.every(o => !o.picked && o.cutout && o.mask_url && o.low === 0));
  assert(!requests.includes('/api/price') && !requests.includes('/api/cutout'), 'Scan must not price or generate images');
  await page.waitForURL('**/review');
  await page.locator('[data-card]').first().waitFor();
  assert.equal(await page.locator('[data-card]').count(), data.lots.length);
  assert(await page.getByRole('button', { name: 'Select the items you want to sell' }).isDisabled());
  await page.getByAltText('Your room').evaluate(img => img.decode());
  const shape = await page.getByAltText('Your room').evaluate(img => [img.naturalWidth, img.naturalHeight]);
  const src = Buffer.from(data.frameUrl.split(',')[1], 'base64');
  const meta = await sharp(src).metadata();
  assert.deepEqual(shape, [meta.width, meta.height]);
  const originalSize = await sharp(photo).metadata();
  assert(Math.abs(shape[0]/shape[1] - originalSize.width/originalSize.height) < .01);
  // The displayed cutout must contain source pixels, not an AI repaint.
  const original = await sharp(src).ensureAlpha().raw().toBuffer();
  for (const lot of data.lots) {
    const b = lot.bbox;
    assert(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1.00001 && b.y + b.h <= 1.00001);
    const { data: cut, info } = await sharp(Buffer.from(lot.image_url.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert(info.channels === 4);
    const left = Math.round(b.x * meta.width), top = Math.round(b.y * meta.height);
    if (Math.round(b.w * meta.width) === info.width && Math.round(b.h * meta.height) === info.height) {
      let foreground = 0;
      for (let y=0; y<info.height; y++) for (let x=0; x<info.width; x++) {
        const i=(y*info.width+x)*4, j=((y+top)*meta.width+x+left)*4;
        if (cut[i+3] === 255) { foreground++; assert.deepEqual([...cut.subarray(i,i+3)], [...original.subarray(j,j+3)], `${lot.name} source pixel changed`); }
      }
      assert(foreground > 200);
    }
  }
  await page.screenshot({ path: path.join(output, 'review.png'), fullPage: true });
  const first = data.lots[0];
  const price = page.waitForResponse(r => r.url().endsWith('/api/price'), { timeout: 60000 });
  await page.getByRole('button', { name: `Select ${first.name}`, exact: true }).click();
  assert.equal(await page.getByRole('button', { name: `Deselect ${first.name}`, exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal((await price).status(), 200);
  await page.getByRole('button', { name: 'Continue with 1 item', exact: true }).click({ timeout: 5000 });
  await page.waitForURL('**/objects');
  await page.locator('.sale-tile img').waitFor();
  assert.equal(await page.locator('.sale-tile').count(), 1);
  await page.reload();
  await page.locator('.sale-tile img').waitFor();
  assert.equal(await page.locator('.sale-tile').count(), 1);
  await page.screenshot({ path: path.join(output, 'sale.png'), fullPage: true });
  // Manual correction: point to a known object through the real segmentation API.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.waitForURL('**/review');
  await page.getByRole('button', { name: '+ Add missed item', exact: true }).click();
  const rect = await page.locator('.review-photo').boundingBox();
  const b = first.bbox;
  const segment = page.waitForResponse(r => r.url().endsWith('/api/segment'), { timeout: 40000 });
  await page.mouse.move(rect.x + b.x*rect.width, rect.y + b.y*rect.height);
  await page.mouse.down();
  await page.mouse.move(rect.x+(b.x+b.w)*rect.width,rect.y+(b.y+b.h)*rect.height,{steps:8});
  await page.mouse.up();
  assert.equal((await segment).status(), 200);
  await page.getByText('Item added. Give it a name, then select it.').waitFor();
  assert.equal(await page.locator('[data-card]').count(), data.lots.length+1);
  if (process.argv[3]) {
    await page.getByRole('button', { name: 'Retake photo' }).click();
    await page.waitForURL(base+'/');
    const people = page.waitForResponse(r=>r.url().endsWith('/api/scan'),{timeout:60000});
    await page.locator('input[type=file]').setInputFiles(process.argv[3]);
    const p=await people; assert.equal(p.status(),200); assert.deepEqual((await p.json()).lots,[],'Crowded regression scene must not invent sale items');
    await page.waitForURL('**/review');
    await page.getByText('No clear items found').waitFor();
    await page.screenshot({path:path.join(output,'people-empty.png'),fullPage:true});
  }
  // A deliberately slow response must remain cancelable and cannot navigate afterward.
  await page.goto(base);
  let release;
  const held = new Promise(resolve => { release=resolve; });
  await page.route('**/api/scan', async route => { await held; await route.fulfill({json:data}).catch(()=>{}); });
  await page.locator('input[type=file]').setInputFiles(photo);
  await page.getByText(/Still working/).waitFor({timeout:15000});
  await page.screenshot({path:path.join(output,'slow-scan.png'),fullPage:true});
  await page.getByRole('button',{name:'Cancel scan'}).click();
  release();
  await page.waitForTimeout(500);
  assert.equal(new URL(page.url()).pathname,'/');
  assert(await page.getByRole('button',{name:'Scan the room'}).isEnabled());
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify({scanMs,lots:data.lots.map(({name,bbox})=>({name,bbox})),errors},null,2));
  console.log(`PASS: ${data.lots.length} real masks in ${scanMs}ms; source pixel fidelity, EXIF, opt-in pricing, selection, persistence, manual segmentation, crowded-scene rejection, slow cancellation. ${output}`);
} finally { await browser.close(); }
