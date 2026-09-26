import { ok, fail } from '@/lib/api';
import { supabaseServer } from '@/lib/supabase';
import { findSale } from '@/lib/sale';
import type { BidResponse } from '@/lib/types';

type Body = { bidder?: string; amount?: number };

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const body = (await request.json().catch(() => null)) as Body | null;
  const amount = Number(body?.amount);
  const bidder = body?.bidder?.trim().slice(0, 40);
  if (!bidder || !Number.isFinite(amount) || amount <= 0) {
    return fail('bidder and a positive amount are required');
  }

  let db;
  try {
    db = supabaseServer();
  } catch {
    return fail('database is not configured', 503);
  }

  const sale = await findSale(code);
  if (!sale) return fail('sale not found', 404);
  if (sale.phase !== 'bidding' || !sale.current_lot_id) return fail('bidding is not open', 409);
  if (sale.lot_ends_at && new Date(sale.lot_ends_at).getTime() <= Date.now()) {
    return fail('the hammer has fallen on this lot', 409);
  }

  const current = Number(sale.high_bid ?? 0);
  if (amount <= current) return fail(`bid must beat £${current}`, 409);

  // Optimistic guard: only win the update if the high bid is still what we read,
  // so two people tapping at the same instant cannot both become the leader.
  const update = db.from('sales').update({ high_bid: amount, high_bidder: bidder }).eq('id', sale.id);
  const guarded = sale.high_bid === null ? update.is('high_bid', null) : update.eq('high_bid', sale.high_bid);
  const { data: updated, error: updErr } = await guarded.select('high_bid, high_bidder');
  if (updErr) return fail(updErr.message, 500);
  if (!updated || updated.length === 0) return fail('outbid, try again', 409);

  const { error: bidErr } = await db.from('sale_bids').insert({
    sale_id: sale.id,
    lot_id: sale.current_lot_id,
    bidder,
    amount,
  });
  if (bidErr) return fail(bidErr.message, 500);

  return ok<BidResponse>({ ok: true, highBid: amount, highBidder: bidder });
}
