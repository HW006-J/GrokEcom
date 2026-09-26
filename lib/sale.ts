// Shared helpers for the sale routes (Track B).
// Persistence goes through db(), which is Supabase when configured and an
// in-memory store otherwise, so the sale runs with or without a database.
import { db } from '@/lib/db';
import type { Lot, Sale } from '@/lib/types';

// No O/0, I/1, S/5 — this gets read aloud and typed on a phone.
const ALPHABET = 'ACDEFGHJKLMNPQRTUVWXYZ2346789';

export function makeCode(len = 4): string {
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

export async function findSale(code: string): Promise<Sale | null> {
  return db().findSaleByCode(code);
}

export async function saleLots(saleId: string): Promise<Lot[]> {
  // Objects the seller did not pick ride along with the sale for the marketplace; the auction never sees them.
  return (await db().lotsForSale(saleId)).filter((lot) => lot.status !== 'found');
}

/** Bidding opens at the lot's reserve, or a little under the low estimate. */
export function openingBid(lot: Lot | null): number {
  if (!lot) return 0;
  const reserve = Number(lot.reserve ?? 0);
  if (reserve > 0) return Math.round(reserve);
  const low = Number(lot.low ?? 0);
  return low > 0 ? Math.round(low * 0.55) : 5;
}
