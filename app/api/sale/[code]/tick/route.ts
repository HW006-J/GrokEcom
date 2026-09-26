import { ok, fail } from '@/lib/api';
import { tick } from '@/lib/auctioneer';

export async function POST(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  try {
    return ok(await tick(code));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'tick failed';
    return fail(msg, /not found/i.test(msg) ? 404 : 503);
  }
}
