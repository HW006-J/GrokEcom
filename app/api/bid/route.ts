import { ok, fail } from '@/lib/api';
import { supabaseServer } from '@/lib/supabase';
import type { BidRequest, BidResponse, Show } from '@/lib/types';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as BidRequest | null;
  const amount = Number(body?.amount);
  if (!body?.showId || !body.name?.trim() || !Number.isFinite(amount) || amount <= 0) {
    return fail('showId, name and a positive amount are required');
  }
  const db = supabaseServer();
  const { data: show, error } = await db.from('shows').select('*').eq('id', body.showId).single<Show>();
  if (error || !show) return fail('show not found', 404);
  if (show.phase !== 'auction' || !show.current_item_id) return fail('auction is not open', 409);
  if (show.auction_ends_at && new Date(show.auction_ends_at).getTime() <= Date.now()) {
    return fail('auction has ended', 409);
  }
  const current = Number(show.high_bid ?? 0);
  if (amount <= current) return fail(`bid must beat £${current}`, 409);

  const name = body.name.trim().slice(0, 40);
  // Optimistic guard against races: only update if high_bid is still what we read.
  const update = db
    .from('shows')
    .update({ high_bid: amount, high_bidder_name: name })
    .eq('id', show.id);
  const guarded = show.high_bid === null ? update.is('high_bid', null) : update.eq('high_bid', show.high_bid);
  const { data: updated, error: updErr } = await guarded.select('high_bid, high_bidder_name');
  if (updErr) return fail(updErr.message, 500);
  if (!updated || updated.length === 0) return fail('outbid, try again', 409);

  const { error: bidErr } = await db.from('bids').insert({
    show_id: show.id,
    item_id: show.current_item_id,
    bidder_name: name,
    amount,
  });
  if (bidErr) return fail(bidErr.message, 500);

  return ok<BidResponse>({ ok: true, highBid: amount, highBidder: name });
}
