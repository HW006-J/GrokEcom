import type { NextRequest } from 'next/server';
import { ok, fail } from '@/lib/api';
import { supabaseServer } from '@/lib/supabase';
import { priceObject } from '@/lib/pricing';
import type { PriceResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** Re-run the estimate for one lot against live comps. */
export async function POST(req: NextRequest, ctx: RouteContext<'/api/lots/[id]/price'>) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    category?: string;
    condition?: string;
  };

  let item = body.name ? { name: body.name, category: body.category, condition: body.condition } : null;
  let client = null;

  try {
    client = supabaseServer();
  } catch {
    // no database configured; the body has to carry the item
  }

  if (client && !item) {
    const { data, error } = await client.from('lots').select('name, category, condition').eq('id', id).single();
    if (error || !data) return fail('lot not found', 404);
    item = { name: data.name, category: data.category, condition: data.condition };
  }

  if (!item) return fail('a lot id backed by a database, or a name in the body, is required');

  const est = await priceObject(item);

  if (client) {
    const { error } = await client
      .from('lots')
      .update({ low: est.low, high: est.high, reserve: est.reserve, comps: est.comps })
      .eq('id', id);
    if (error) console.warn('price update failed:', error.message);
  }

  return ok<PriceResponse>(est);
}
