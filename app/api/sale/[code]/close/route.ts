import { ok, fail } from '@/lib/api';
import { closeLot } from '@/lib/auctioneer';

export async function POST(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  try {
    return ok(await closeLot(code));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'close failed';
    return fail(msg, /not found/i.test(msg) ? 404 : 503);
  }
}
