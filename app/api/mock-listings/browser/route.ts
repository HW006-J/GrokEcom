import { fail, ok } from '@/lib/api';
import { getBrowserJob, startBrowserJob } from '@/lib/browser-lister';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?id=<jobId> → progress of a browser listing job.
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const job = getBrowserJob(id);
  if (!job) return fail('Job not found. It may have expired after a server restart.', 404);
  return ok(job);
}

// POST {lotId, platform} → {jobId}. 503 {unavailable:true} when Chromium is not installed.
export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return fail('Expected a JSON request.'); }
  const { lotId, platform } = (body ?? {}) as Record<string, unknown>;
  if (typeof lotId !== 'string' || !lotId.trim() || lotId.length > 200) return fail('Choose a valid item.');
  if (platform !== 'ebay' && platform !== 'marketplace') return fail('Choose eBay or Marketplace.');
  let lot;
  try { lot = await db().getLot(lotId); }
  catch { return fail('Could not load this item. Please retry.', 500); }
  if (!lot) return fail('Item not found.', 404);
  if (lot.status !== 'unsold') return fail('Only unsold items can be listed.', 409);
  try {
    const job = await startBrowserJob(lot, platform, new URL(request.url).origin);
    return ok({ jobId: job.id });
  } catch {
    return ok({ error: 'The browser agent is not available on this server.', unavailable: true }, 503);
  }
}
