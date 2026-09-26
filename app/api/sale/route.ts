import { ok, fail } from '@/lib/api';
import { supabaseServer } from '@/lib/supabase';
import { makeCode } from '@/lib/sale';
import type { CreateSaleResponse, Lot, Sale } from '@/lib/types';

/**
 * POST /api/sale
 * Body: { lotIds?: string[], lots?: NewLot[], title?: string }
 *
 * `lotIds` attaches rows Track A already wrote. `lots` seeds rows from the client
 * for lots that are not in the database yet, which is how the demo runs today.
 */
type NewLot = {
  name: string;
  category?: string;
  condition?: string;
  blurb?: string;
  image_url?: string;
  low?: number;
  high?: number;
  reserve?: number;
};

type Body = { lotIds?: string[]; lots?: NewLot[]; title?: string };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null;
  const lotIds = body?.lotIds?.filter(Boolean) ?? [];
  const seeds = body?.lots ?? [];
  if (lotIds.length === 0 && seeds.length === 0) return fail('lotIds or lots are required');

  let db;
  try {
    db = supabaseServer();
  } catch {
    return fail('database is not configured', 503);
  }

  // Unique-ish code; retry a couple of times on collision.
  let sale: Sale | null = null;
  for (let attempt = 0; attempt < 4 && !sale; attempt++) {
    const { data, error } = await db
      .from('sales')
      .insert({ code: makeCode(), title: body?.title?.trim() || 'The Sellout', phase: 'idle', watchers: 0 })
      .select('*')
      .single<Sale>();
    if (data) sale = data;
    else if (error && !/duplicate|unique/i.test(error.message)) return fail(error.message, 500);
  }
  if (!sale) return fail('could not open a sale', 500);

  // Attach lots in the order they were given.
  const attached: Lot[] = [];

  if (lotIds.length) {
    const { data: rows } = await db.from('lots').select('*').in('id', lotIds);
    const byId = new Map((rows ?? []).map((r) => [(r as Lot).id, r as Lot]));
    const updates = lotIds
      .map((id, i) => ({ lot: byId.get(id), order: i + 1 }))
      .filter((u): u is { lot: Lot; order: number } => Boolean(u.lot));
    for (const u of updates) {
      const { data } = await db
        .from('lots')
        .update({ sale_id: sale.id, status: 'queued', sort_order: u.order, picked: true })
        .eq('id', u.lot.id)
        .select('*')
        .single<Lot>();
      if (data) attached.push(data);
    }
  }

  if (seeds.length) {
    const base = attached.length;
    const rows = seeds.map((s, i) => ({
      sale_id: sale.id,
      name: s.name,
      category: s.category ?? 'Other',
      condition: s.condition ?? null,
      blurb: s.blurb ?? null,
      image_url: s.image_url ?? null,
      low: s.low ?? null,
      high: s.high ?? null,
      reserve: s.reserve ?? (s.low ? Math.round(s.low * 0.55) : null),
      picked: true,
      status: 'queued',
      sort_order: base + i + 1,
    }));
    const { data, error } = await db.from('lots').insert(rows).select('*');
    if (error) return fail(error.message, 500);
    attached.push(...((data ?? []) as Lot[]));
  }

  if (attached.length === 0) return fail('none of those lots exist', 404);

  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  return ok<CreateSaleResponse>({ sale, shareUrl: `${base}/join/${sale.code}` });
}
