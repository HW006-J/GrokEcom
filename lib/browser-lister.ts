// Drives a real headless Chromium through our own demo sell form so the seller
// can watch an agent list an unsold item. The only real site it touches is an
// eBay search results page, read-only, to find similar live listings.
//
// Playwright is imported lazily: when it or its Chromium build is missing
// (e.g. on a slim Railway image) startBrowserJob throws and the caller falls
// back to the instant mock publish. Jobs live in memory, like mock listings.
import { askingPrice, CONDITIONS, getMockListing, platformName, realSearchUrl, type MockListing, type MockPlatform, type SimilarItem } from '@/lib/mock-marketplaces';
import type { Lot } from '@/lib/types';

/** A kept screenshot, so a finished run can be replayed. */
export type BrowserFrame = { step: number; screenshot: string; url: string };

export type BrowserJob = {
  id: string;
  lotId: string;
  lotName: string;
  platform: MockPlatform;
  steps: string[];
  /** Index of the step in progress; equals steps.length when finished. */
  step: number;
  /** Steps that could not run (e.g. eBay blocked the headless check). */
  skipped: number[];
  screenshot: string | null;
  url: string;
  done: boolean;
  listing?: MockListing;
  error?: string;
  /** Real listings the agent read off the live eBay results page. */
  found: SimilarItem[];
  frames: BrowserFrame[];
  frameCount: number;
  createdAt: number;
};

const CHECK_STEP = 'Checking eBay for similar items';

export function browserSteps(platform: MockPlatform): string[] {
  return [
    ...(platform === 'ebay' ? [CHECK_STEP] : []),
    `Open demo ${platformName(platform)} sell page`,
    'Type the item title',
    'Choose the condition',
    'Enter the asking price',
    'Attach the item photo',
    platform === 'ebay' ? 'Click List it' : 'Click Publish',
    'Confirm the listing is live',
  ];
}

const state = globalThis as typeof globalThis & { __selloutBrowserJobs?: Map<string, BrowserJob> };
const jobs = state.__selloutBrowserJobs ??= new Map<string, BrowserJob>();
const MAX_JOBS = 20;
const MAX_FRAMES = 24;

/** Frames are heavy, so polls leave them out unless asked. */
export function getBrowserJob(id: string, withFrames = false): BrowserJob | null {
  const job = jobs.get(id);
  if (!job) return null;
  return { ...job, steps: [...job.steps], skipped: [...job.skipped], found: [...job.found], frames: withFrames ? [...job.frames] : [], frameCount: job.frames.length };
}

/** Launches Chromium before returning, so a missing browser fails fast. */
export async function startBrowserJob(lot: Lot, platform: MockPlatform, origin: string): Promise<BrowserJob> {
  const running = [...jobs.values()].find((job) => job.lotId === lot.id && job.platform === platform && !job.done);
  if (running) return getBrowserJob(running.id)!;

  const { chromium } = await import('playwright');
  // On Railway the image carries Debian's Chromium (RAILPACK_DEPLOY_APT_PACKAGES) rather than Playwright's download.
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });
  // In production, browse our own pages over loopback: no proxy, no TLS, no public round trip.
  if (process.env.NODE_ENV === 'production' && process.env.PORT) origin = `http://127.0.0.1:${process.env.PORT}`;
  const job: BrowserJob = {
    id: crypto.randomUUID(), lotId: lot.id, lotName: lot.name, platform, steps: browserSteps(platform),
    step: 0, skipped: [], screenshot: null, url: '', done: false, found: [], frames: [], frameCount: 0, createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value!);
  void run(job, browser, lot, origin);
  return getBrowserJob(job.id)!;
}

type Browser = Awaited<ReturnType<typeof import('playwright').chromium.launch>>;
type Page = Awaited<ReturnType<Browser['newPage']>>;
type Locator = ReturnType<Page['locator']>;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function pickCondition(text: string): string {
  const t = text.toLowerCase();
  if (/\b(new|unused|sealed|mint)\b/.test(t) && !/like new|as new/.test(t)) return CONDITIONS[0];
  if (/like new|as new|excellent|very good/.test(t)) return CONDITIONS[1];
  if (/fair|worn|scuff|damage|heavy/.test(t)) return CONDITIONS[3];
  return CONDITIONS[2];
}

async function loadImage(url: string, origin: string): Promise<{ name: string; mimeType: string; buffer: Buffer } | null> {
  if (!url) return null;
  try {
    const data = /^data:(image\/[a-z+]+);base64,(.*)$/.exec(url);
    if (data) return { name: 'item.' + data[1].split('/')[1], mimeType: data[1], buffer: Buffer.from(data[2], 'base64') };
    const response = await fetch(new URL(url, origin), { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/png';
    if (!mimeType.startsWith('image/')) return null;
    return { name: 'item.' + mimeType.split('/')[1], mimeType, buffer: Buffer.from(await response.arrayBuffer()) };
  } catch {
    return null;
  }
}

// Headless pages have no pointer. Draw one, ripple on every click, and ring
// whichever field the agent is typing into, so the screenshots show intent.
const OVERLAY_SCRIPT = `addEventListener('DOMContentLoaded', () => {
  const css = document.createElement('style');
  css.textContent = '@keyframes agent-ripple{from{transform:translate(-50%,-50%) scale(.3);opacity:.9}to{transform:translate(-50%,-50%) scale(2.6);opacity:0}}'
    + 'input:focus,select:focus,textarea:focus{outline:none!important;box-shadow:0 0 0 3px #fff,0 0 0 6px rgba(10,108,255,.85)!important}';
  document.head.appendChild(css);
  const dot = document.createElement('div');
  dot.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(10,108,255,.3);border:2.5px solid #0a6cff;box-shadow:0 2px 8px rgba(0,0,0,.25);z-index:2147483647;pointer-events:none;transition:transform .12s;transform:translate(-60px,-60px)';
  const chip = document.createElement('div');
  chip.textContent = 'Agent typing';
  chip.style.cssText = 'position:fixed;display:none;z-index:2147483647;pointer-events:none;background:#0a6cff;color:#fff;font:600 11px/1 -apple-system,Helvetica,Arial,sans-serif;padding:5px 8px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.2)';
  document.body.append(dot, chip);
  let x = -60, y = -60;
  const place = (scale) => { dot.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')'; };
  addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; place(1); }, true);
  addEventListener('mousedown', (e) => {
    place(.7);
    const ring = document.createElement('div');
    ring.style.cssText = 'position:fixed;left:' + e.clientX + 'px;top:' + e.clientY + 'px;width:34px;height:34px;border-radius:50%;border:3px solid #0a6cff;background:rgba(10,108,255,.18);z-index:2147483646;pointer-events:none;animation:agent-ripple .7s ease-out forwards';
    document.body.appendChild(ring);
    setTimeout(() => ring.remove(), 800);
  }, true);
  addEventListener('mouseup', () => place(1), true);
  addEventListener('focusin', (e) => {
    const el = e.target;
    if (!el.matches || !el.matches('input:not([type=file]),select,textarea')) return;
    const box = el.getBoundingClientRect();
    chip.style.left = box.left + 'px';
    chip.style.top = Math.max(4, box.top - 24) + 'px';
    chip.textContent = el.tagName === 'SELECT' ? 'Agent choosing' : 'Agent typing';
    chip.style.display = 'block';
  });
  addEventListener('focusout', () => { chip.style.display = 'none'; });
  addEventListener('scroll', () => { chip.style.display = 'none'; }, true);
});`;

/** Read-only: open the real eBay results for the item and note a few live listings. */
async function checkEbay(page: Page, query: string): Promise<SimilarItem[]> {
  const url = realSearchUrl('ebay', query);
  // eBay often serves an error page to a cold session; the retry carries its cookies.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    if (!/error/i.test(await page.title())) break;
    await pause(600);
  }
  if (/error/i.test(await page.title())) throw new Error('eBay did not serve results to a headless browser.');
  // Hide the consent banner rather than answering it: nothing is ever submitted to eBay.
  await page.addStyleTag({ content: '#gdpr-banner, .gdpr-banner { display: none !important; }' });
  await pause(1200);
  const found = await page.evaluate(() => [...document.querySelectorAll('li')].map((li) => {
    const link = li.querySelector<HTMLAnchorElement>('a[href*="/itm/"]');
    const title = li.querySelector('.s-card__title, .s-item__title, [role=heading]')?.textContent?.trim() ?? '';
    const price = li.querySelector('.s-card__price, .s-item__price')?.textContent?.trim() ?? '';
    return { title: title.replace(/^New listing/i, '').replace(/Opens in a new window or tab$/i, '').trim(), price, url: link?.href.split('?')[0] ?? '' };
  }));
  return found
    .filter((item) => /^https:\/\/www\.ebay\.co\.uk\/itm\/\d+$/.test(item.url) && item.title && !/^shop on ebay$/i.test(item.title) && /^£/.test(item.price))
    .filter((item, index, all) => all.findIndex((other) => other.url === item.url) === index)
    .slice(0, 4)
    .map((item) => ({ title: item.title.slice(0, 120), price: Math.round(Number(item.price.replace(/[^0-9.]/g, ''))) || undefined, url: item.url }));
}

async function run(job: BrowserJob, browser: Browser, lot: Lot, origin: string) {
  const context = await browser.newContext({
    viewport: { width: 420, height: 600 }, deviceScaleFactor: 2, locale: 'en-GB',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  });
  await context.addInitScript(OVERLAY_SCRIPT);
  const page = await context.newPage();

  let shooting: Promise<void> | null = null;
  const shoot = () => shooting ??= page.screenshot({ type: 'jpeg', quality: 55, caret: 'initial' })
    .then((buffer) => { job.screenshot = `data:image/jpeg;base64,${buffer.toString('base64')}`; job.url = page.url(); })
    .catch(() => {})
    .finally(() => { shooting = null; });
  /** A fresh screenshot (not one already in flight), kept for the replay. */
  const keep = async () => {
    if (shooting) await shooting;
    await shoot();
    if (job.screenshot && job.frames.length < MAX_FRAMES) job.frames.push({ step: job.step, screenshot: job.screenshot, url: job.url });
  };
  const ticker = setInterval(() => void shoot(), 300);

  const moveTo = async (target: Locator) => {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 16 });
    await pause(180);
  };
  const click = async (target: Locator) => {
    await moveTo(target);
    await target.click();
    await pause(110);
    await keep();
  };
  const type = async (target: Locator, text: string, delay: number) => {
    await click(target);
    await target.pressSequentially(text, { delay });
    await pause(350);
  };

  const price = askingPrice(lot);
  const actions: Record<string, () => Promise<void>> = {
    [CHECK_STEP]: async () => {
      job.found = await checkEbay(page, lot.name);
      for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 260); await pause(450); }
      await keep();
    },
    [`Open demo ${platformName(job.platform)} sell page`]: async () => {
      await page.goto(`${origin}/mock-marketplace/${job.platform}/sell?lot=${encodeURIComponent(lot.id)}&job=${job.id}`, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.locator('#publish').waitFor({ timeout: 15_000 });
      await pause(700);
    },
    'Type the item title': () => type(page.getByLabel('Title'), lot.name.slice(0, 80), 55),
    'Choose the condition': async () => {
      const select = page.getByLabel('Condition');
      await click(select);
      await select.selectOption(pickCondition(`${lot.condition} ${lot.blurb}`));
      await pause(400);
    },
    'Enter the asking price': () => type(page.getByLabel(/price/i), String(price), 160),
    'Attach the item photo': async () => {
      const file = await loadImage(lot.image_url, origin);
      await click(page.getByText(/add photos/i).first());
      if (file) await page.locator('input[type=file]').setInputFiles(file);
      await pause(900);
    },
    [job.steps[job.steps.length - 2]]: async () => {
      await click(page.locator('#publish'));
      await page.waitForURL(/listing=/, { timeout: 20_000 });
    },
    'Confirm the listing is live': async () => {
      await page.locator('[data-listing-live]').waitFor({ timeout: 15_000 });
      await pause(900);
    },
  };

  try {
    for (const [index, label] of job.steps.entries()) {
      job.step = index;
      try {
        await actions[label]();
      } catch (error) {
        if (label !== CHECK_STEP) throw error;
        job.skipped.push(index); // eBay blocked or changed; the demo carries on.
      }
      await keep();
    }
    const id = new URL(page.url()).searchParams.get('listing');
    job.listing = (id && getMockListing(id)) || undefined;
    job.step = job.steps.length;
  } catch (error) {
    job.error = error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : 'The browser agent stopped.';
    await keep();
  } finally {
    clearInterval(ticker);
    if (shooting) await shooting;
    job.done = true;
    await browser.close().catch(() => {});
  }
}
