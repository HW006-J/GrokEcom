import { ok, fail } from '@/lib/api';
import { createAnamSessionToken } from '@/lib/anam';
import type { SessionTokenResponse } from '@/lib/types';

export async function POST() {
  try {
    const sessionToken = await createAnamSessionToken();
    return ok<SessionTokenResponse>({ sessionToken });
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'anam error', 502);
  }
}
