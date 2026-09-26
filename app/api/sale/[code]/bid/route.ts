import { ok, fail } from '@/lib/api';
import { db } from '@/lib/db';
import { findSale, openingBid } from '@/lib/sale';
import type { BidResponse } from '@/lib/types';

type Body = { bidder?: string; amount?: number };

/** Bids are whole pounds, and nobody is bidding a trillion for a lamp. */
const MAX_BID = 1_000_000;

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const body = (await request.json().catch(() => null)) as Body | null;
  const amount = Number(body?.amount);
  const bidder = body?.bidder?.trim().slice(0, 40);
  if (!bidder || !Number.isFinite(amount) || amount <= 0) {
    return fail('bidder and a positive amount are required');
  }
  if (!Number.isInteger(amount)) return fail('bids are in whole pounds');
  if (amount > MAX_BID) return fail(`the most you can bid is £${MAX_BID.toLocaleString('en-GB')}`);

  const store = db();

  const sale = await findSale(code);
  if (!sale) return fail('sale not found', 404);
  if (sale.phase !== 'bidding' || !sale.current_lot_id) return fail('bidding is not open', 409);
  if (sale.lot_ends_at && new Date(sale.lot_ends_at).getTime() <= Date.now()) {
    return fail('the hammer has fallen on this lot', 409);
  }

  const current = sale.high_bid === null || sale.high_bid === undefined ? null : Number(sale.high_bid);

  if (current === null) {
    // First bid on this lot: it has to meet the opening the auctioneer announced.
    const lot = await store.getLot(sale.current_lot_id);
    const opening = openingBid(lot);
    if (amount < opening) return fail(`bidding opens at £${opening}`, 409);
  } else if (amount <= current) {
    return fail(`bid must beat £${current}`, 409);
  }

  // Compare-and-set: only win if the high bid is still what we read, so two
  // people tapping at the same instant cannot both become the leader.
  try {
    const won = await store.casHighBid(sale.id, current, amount, bidder);
    if (!won) return fail('outbid, try again', 409);
    await store.insertBid({ sale_id: sale.id, lot_id: sale.current_lot_id, bidder, amount });
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'bid failed', 500);
  }

  return ok<BidResponse>({ ok: true, highBid: amount, highBidder: bidder });
}
