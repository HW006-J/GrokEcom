import { ok, fail } from '@/lib/api';
import { closeAuction } from '@/lib/host';
import type { AuctionCloseRequest } from '@/lib/types';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as AuctionCloseRequest | null;
  if (!body?.showId) return fail('showId is required');
  try {
    return ok(await closeAuction(body.showId));
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'close failed', 500);
  }
}
