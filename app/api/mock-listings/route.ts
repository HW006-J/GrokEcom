import { fail, ok } from '@/lib/api';
import { db } from '@/lib/db';
import { browserSteps } from '@/lib/browser-lister';
import { listMockListings, publishMockListing, type MockListingForm } from '@/lib/mock-marketplaces';

export const dynamic = 'force-dynamic';

export async function GET() {
  return ok({ listings: listMockListings() });
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return fail('Expected a JSON request.'); }
  if (!body || typeof body !== 'object') return fail('Choose an item and a demo marketplace.');
  const { lotId, platform, title, condition, price, imageDataUrl, via } = body as Record<string, unknown>;
  if (typeof lotId !== 'string' || !lotId.trim() || lotId.length > 200) return fail('Choose a valid item.');
  if (platform !== 'ebay' && platform !== 'marketplace') return fail('Choose eBay or Marketplace.');
  // Optional fields come from the demo sell form; the instant path sends none.
  const form: MockListingForm = {};
  if (typeof title === 'string' && title.trim()) form.title = title.trim().slice(0, 120);
  if (typeof condition === 'string' && condition.trim()) form.condition = condition.trim().slice(0, 60);
  if (typeof price === 'number' && Number.isFinite(price) && price > 0 && price <= 100000) form.price = price;
  if (typeof imageDataUrl === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(imageDataUrl) && imageDataUrl.length < 4_000_000) form.imageUrl = imageDataUrl;
  if (via === 'browser') form.steps = browserSteps(platform);
  try {
    const lot = await db().getLot(lotId);
    if (!lot) return fail('Item not found.', 404);
    if (lot.status !== 'unsold') return fail('Only unsold items can be listed.', 409);
    return ok({ listing: publishMockListing(lot, platform, form) });
  } catch {
    return fail('The demo listing could not be created. Please retry.', 500);
  }
}
