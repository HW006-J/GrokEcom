// Drives a real headless Chromium through our own demo sell form so the seller
// can watch an agent list an unsold item. Never touches a real marketplace.
//
// Playwright is imported lazily: when it or its Chromium build is missing
// (e.g. on a slim Railway image) startBrowserJob throws and the caller falls
// reports an error. Jobs live in memory, like mock listings.
import { CONDITIONS, getMockListing, type MockListing, type MockPlatform } from '@/lib/mock-marketplaces';
import type { Lot } from '@/lib/types';

export type BrowserJob = {
  id: string;
  lotId: string;
  platform: MockPlatform;
  steps: string[];
  /** Index of the step in progress; equals steps.length when finished. */
  step: number;
  screenshot: string | null;
  url: string;
  done: boolean;
  listing?: MockListing;
  error?: string;
  createdAt: number;
};

export function browserSteps(platform: MockPlatform): string[] {
  return [
    `Open demo ${platform === 'ebay' ? 'eBay' : 'Marketplace'} sell page`,
    'Type the item title',
    'Choose the condition',
    'Enter the asking price',
    'Attach the item photo',
    'Click Publish',
    'Confirm the listing is live',
  ];
}

const state = globalThis as typeof globalThis & { __selloutBrowserJobs?: Map<string, BrowserJob> };
const jobs = state.__selloutBrowserJobs ??= new Map<string, BrowserJob>();
const MAX_JOBS = 30;

export function getBrowserJob(id: string): BrowserJob | null {
  const job = jobs.get(id);
  return job ? { ...job, steps: [...job.steps] } : null;
}

/** Launches Chromium before returning, so a missing browser fails fast. */
export async function startBrowserJob(lot: Lot, platform: MockPlatform, origin: string): Promise<BrowserJob> {
  const running = [...jobs.values()].find((job) => job.lotId === lot.id && job.platform === platform && !job.done);
  if (running) return getBrowserJob(running.id)!;

  if ([...jobs.values()].filter(job => !job.done).length >= 2) throw new Error('Two browser agents are already working. Try again shortly.');
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const job: BrowserJob = {
    id: crypto.randomUUID(), lotId: lot.id, platform, steps: browserSteps(platform),
    step: 0, screenshot: null, url: '', done: false, createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value!);
  void run(job, browser, lot, origin);
  return getBrowserJob(job.id)!;
}

type Browser = Awaited<ReturnType<typeof import('playwright').chromium.launch>>;
type Locator = ReturnType<Awaited<ReturnType<Browser['newPage']>>['locator']>;

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

// Headless pages have no pointer, so draw one that follows mouse events.
const CURSOR_SCRIPT = `addEventListener('DOMContentLoaded', () => {
  const dot = document.createElement('div');
  dot.style.cssText = 'position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(10,108,255,.35);border:2px solid #0a6cff;z-index:99999;pointer-events:none;transition:transform .12s;transform:translate(-40px,-40px)';
  document.body.appendChild(dot);
  let x = -40, y = -40;
  addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; dot.style.transform = 'translate(' + x + 'px,' + y + 'px)'; }, true);
  addEventListener('mousedown', () => { dot.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(.7)'; }, true);
  addEventListener('mouseup', () => { dot.style.transform = 'translate(' + x + 'px,' + y + 'px)'; }, true);
});`;

async function run(job: BrowserJob, browser: Browser, lot: Lot, origin: string) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1, locale: 'en-GB' });
  await context.addInitScript(CURSOR_SCRIPT);
  const page = await context.newPage();

  let shooting: Promise<void> | null = null;
  const shoot = () => shooting ??= page.screenshot({ type: 'jpeg', quality: 60 })
    .then((buffer) => { job.screenshot = `data:image/jpeg;base64,${buffer.toString('base64')}`; job.url = page.url(); })
    .catch(() => {})
    .finally(() => { shooting = null; });
  const ticker = setInterval(() => void shoot(), 300);

  const step = async (index: number, action: () => Promise<void>) => {
    job.step = index;
    await action();
    await shoot();
  };
  const moveTo = async (target: Locator) => {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 });
    await pause(150);
  };
  const type = async (target: Locator, text: string, delay: number) => {
    await moveTo(target);
    await target.click();
    await target.pressSequentially(text, { delay });
    await pause(350);
  };

  try {
    const price = Math.max(1, Math.round(Number(lot.reserve) || Number(lot.low) || 1));
    await step(0, async () => {
      await page.goto(`${origin}/mock-marketplace/${job.platform}/sell?lot=${encodeURIComponent(lot.id)}`, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.getByRole('button', { name: /publish/i }).waitFor({ timeout: 15_000 });
      await pause(700);
    });
    await step(1, () => type(page.getByLabel('Title'), lot.name.slice(0, 120), 55));
    await step(2, async () => {
      const select = page.getByLabel('Condition');
      await moveTo(select);
      await select.selectOption(pickCondition(`${lot.condition} ${lot.blurb}`));
      await pause(400);
    });
    await step(3, () => type(page.getByLabel(/price/i), String(price), 160));
    await step(4, async () => {
      const file = await loadImage(lot.image_url, origin);
      await moveTo(page.getByText(/add photo/i).first());
      if (!file) throw new Error('The item photo could not be loaded.');
      await page.locator('input[type=file]').setInputFiles(file);
      await pause(900);
    });
    await step(5, async () => {
      const publish = page.getByRole('button', { name: /publish/i });
      await moveTo(publish);
      await publish.click();
      await page.waitForURL(/listing=/, { timeout: 20_000 });
    });
    await step(6, async () => {
      await page.getByText(/published in demo/i).waitFor({ timeout: 15_000 });
      await pause(900);
    });
    const id = new URL(page.url()).searchParams.get('listing');
    job.listing = (id && getMockListing(id)) || undefined;
    if (!job.listing || job.listing.lotId !== lot.id || job.listing.platform !== job.platform) throw new Error('Published listing could not be verified.');
    job.step = job.steps.length;
  } catch (error) {
    job.error = error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : 'The browser agent stopped.';
    await shoot();
  } finally {
    clearInterval(ticker);
    if (shooting) await shooting;
    job.done = true;
    await browser.close().catch(() => {});
  }
}
