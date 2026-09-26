import type { NextRequest } from 'next/server';
import { ok, fail } from '@/lib/api';
import { supabaseServer } from '@/lib/supabase';

export const runtime = 'nodejs';

/** Keep or drop a lot from the sale. No database means the choice stays on the device. */
export async function POST(req: NextRequest, ctx: RouteContext<'/api/lots/[id]/pick'>) {
  const { id } = await ctx.params;
  const { picked } = (await req.json().catch(() => ({}))) as { picked?: boolean };
  if (typeof picked !== 'boolean') return fail('picked must be true or false');

  try {
    const { error } = await supabaseServer().from('lots').update({ picked }).eq('id', id);
    if (error) return fail(error.message, 500);
    return ok({ ok: true, picked });
  } catch {
    return ok({ ok: false, picked }); // local-only; the screen already updated
  }
}
