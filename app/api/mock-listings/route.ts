import { fail, ok } from '@/lib/api';
import { db } from '@/lib/db';
import { getBrowserJob } from '@/lib/browser-lister';
import { canList, listMockListings, publishMockListing, type MockListingForm } from '@/lib/mock-marketplaces';

export const dynamic = 'force-dynamic';

export async function GET() {
  return ok({ listings: listMockListings() });
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return fail('Expected a JSON request.'); }
  if (!body || typeof body !== 'object') return fail('Choose an item and a demo marketplace.');
  const { lotId, platform, title, condition, price, imageDataUrl, jobId } = body as Record<string, unknown>;
  if (typeof lotId !== 'string' || !lotId.trim() || lotId.length > 200) return fail('Choose a valid item.');
  if (platform !== 'ebay' && platform !== 'marketplace') return fail('Choose eBay or Marketplace.');
  // Optional fields come from the demo sell form; the instant path sends none.
  const form: MockListingForm = {};
  if (typeof title === 'string' && title.trim()) form.title = title.trim().slice(0, 120);
  if (typeof condition === 'string' && condition.trim()) form.condition = condition.trim().slice(0, 60);
  if (typeof price === 'number' && Number.isFinite(price) && price > 0 && price <= 100000) form.price = price;
  if (typeof imageDataUrl === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(imageDataUrl) && imageDataUrl.length < 4_000_000) form.imageUrl = imageDataUrl;
  // Submitted by the browser agent: carry its steps and what it found on the real site.
  const job = typeof jobId === 'string' ? getBrowserJob(jobId) : null;
  if (job && job.lotId === lotId && job.platform === platform) Object.assign(form, { jobId: job.id, steps: job.steps, found: job.found });
  try {
    const lot = await db().getLot(lotId);
    if (!lot) return fail('Item not found.', 404);
    if (!canList(lot)) return fail('Only unsold or unauctioned items can be listed.', 409);
    return ok({ listing: publishMockListing(lot, platform, form) });
  } catch {
    return fail('The demo listing could not be created. Please retry.', 500);
  }
}
