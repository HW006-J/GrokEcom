import { ok, fail } from '@/lib/api';
import { db, type NewLot as NewLotRow } from '@/lib/db';
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

  const store = db();

  // Unique-ish code; retry a couple of times on collision.
  let sale: Sale | null = null;
  try {
    for (let attempt = 0; attempt < 4 && !sale; attempt++) {
      sale = await store.createSale({ code: makeCode(), title: body?.title?.trim() || 'The Sellout' });
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'could not open a sale', 500);
  }
  if (!sale) return fail('could not open a sale', 500);

  // Attach lots in the order they were given.
  const attached: Lot[] = [];

  try {
    if (lotIds.length) {
      const rows = await store.lotsByIds(lotIds);
      const byId = new Map(rows.map((r) => [r.id, r]));
      let order = 0;
      for (const id of lotIds) {
        const existing = byId.get(id);
        if (!existing) continue;
        order += 1;
        const updated = await store.updateLot(existing.id, {
          sale_id: sale.id,
          status: 'queued',
          sort_order: order,
          picked: true,
        });
        if (updated) attached.push(updated);
      }
    }

    if (seeds.length) {
      const base = attached.length;
      const rows: NewLotRow[] = seeds.map((s, i) => ({
        sale_id: sale.id,
        name: s.name,
        category: s.category ?? 'Other',
        condition: s.condition,
        blurb: s.blurb,
        image_url: s.image_url,
        low: s.low,
        high: s.high,
        reserve: s.reserve ?? (s.low ? Math.round(s.low * 0.55) : undefined),
        picked: true,
        status: 'queued',
        sort_order: base + i + 1,
      }));
      attached.push(...(await store.insertLots(rows)));
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'could not attach lots', 500);
  }

  if (attached.length === 0) return fail('none of those lots exist', 404);

  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  return ok<CreateSaleResponse>({ sale, shareUrl: `${base}/join/${sale.code}` });
}
