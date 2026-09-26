import { ok, fail } from '@/lib/api';
import { tick } from '@/lib/host';
import type { HostTickRequest } from '@/lib/types';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as HostTickRequest | null;
  if (!body?.showId) return fail('showId is required');
  try {
    return ok(await tick(body.showId));
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'tick failed', 500);
  }
}
