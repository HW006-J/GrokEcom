import { ok, fail } from '@/lib/api';
import { db, type NewLot as NewLotRow } from '@/lib/db';
import { makeCode } from '@/lib/sale';
import type { Comp, CreateSaleResponse, Lot, Sale } from '@/lib/types';

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
  comps?: Comp[];
};

type Body = { lotIds?: string[]; lots?: NewLot[]; title?: string };

/** A lot name is read aloud and printed on a card; keep it sane. */
const NAME_MAX = 80;

const cleanName = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const n = v.trim().slice(0, NAME_MAX);
  return n.length ? n : null;
};

/** The evidence behind a price travels with the lot so bidders can see it. */
const cleanComps = (v: unknown): Comp[] => !Array.isArray(v) ? [] : v
  .filter((c): c is Comp => !!c && typeof c.url === 'string' && /^https?:\/\//.test(c.url) && Number(c.price) > 0)
  .slice(0, 4)
  .map(c => ({ title: String(c.title ?? '').slice(0, 120), price: Math.round(Number(c.price)), url: c.url, source: String(c.source ?? '').slice(0, 40) }));

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null;

  const rawIds = body?.lotIds;
  const rawSeeds = body?.lots;
  if (rawIds !== undefined && !Array.isArray(rawIds)) return fail('lotIds must be an array');
  if (rawSeeds !== undefined && !Array.isArray(rawSeeds)) return fail('lots must be an array');

  const lotIds = (rawIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0);
  const seeds = (rawSeeds ?? []).filter((s): s is NewLot => Boolean(s) && typeof s === 'object');
  if (lotIds.length === 0 && seeds.length === 0) return fail('lotIds or lots are required');

  // Every seeded lot needs a name: the auctioneer says it out loud, and a
  // nameless lot can throw inside the LLM-failure fallback and go silent.
  const named = seeds.map((s) => ({ ...s, name: cleanName(s.name) }));
  if (named.some((s) => s.name === null)) return fail('every lot needs a name');

  const store = db();

  // Resolve existing lots BEFORE opening a sale. Creating the sale first meant a
  // request that ended in 404 still consumed a slot and evicted a live auction.
  let existing: Lot[] = [];
  try {
    if (lotIds.length) existing = await store.lotsByIds(lotIds);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'could not read those lots', 500);
  }
  if (existing.length === 0 && named.length === 0) return fail('none of those lots exist', 404);

  // Unique-ish code; retry a couple of times on collision, including when the
  // store signals one by throwing a unique violation rather than returning null.
  let sale: Sale | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4 && !sale; attempt++) {
    try {
      sale = await store.createSale({ code: makeCode(), title: body?.title?.trim().slice(0, 120) || 'The Sellout' });
    } catch (e) {
      lastError = e;
    }
  }
  if (!sale) return fail(lastError instanceof Error ? lastError.message : 'could not open a sale', 500);

  // Attach lots in the order they were given.
  const attached: Lot[] = [];

  try {
    if (existing.length) {
      const byId = new Map(existing.map((r) => [r.id, r]));
      let order = 0;
      for (const id of lotIds) {
        const row = byId.get(id);
        if (!row) continue;
        order += 1;
        const updated = await store.updateLot(row.id, {
          sale_id: sale.id,
          status: 'queued',
          sort_order: order,
          picked: true,
        });
        if (updated) attached.push(updated);
      }
    }

    if (named.length) {
      const base = attached.length;
      const rows: NewLotRow[] = named.map((s, i) => ({
        sale_id: sale.id,
        name: s.name as string,
        category: s.category ?? 'Other',
        condition: s.condition,
        blurb: s.blurb,
        image_url: s.image_url,
        low: s.low,
        high: s.high,
        reserve: s.reserve ?? (s.low ? Math.round(s.low * 0.55) : undefined),
        comps: cleanComps(s.comps),
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
