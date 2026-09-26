"use client";

import { gbp, type SaleBid } from "@/lib/types";

/** Keyed by accepted bid ID: polling never replays the same bubble animation. */
export function LiveBids({ bids, lotId, now, hasCaption }: {
  bids: SaleBid[]; lotId: string | null; now: number; hasCaption: boolean;
}) {
  const recent = bids.filter(b => b.lot_id === lotId && now - Date.parse(b.created_at) < 10_000)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.amount - b.amount)
    .slice(-3);

  return <div className="live-bids" data-caption={hasCaption} role="log" aria-label="Live bids" aria-live="polite" aria-relevant="additions" aria-atomic="false">
    {recent.map(bid => <div className="bid-bubble" key={bid.id} data-bid-id={bid.id}>
      <span className="bid-avatar" aria-hidden="true">{bid.bidder.trim().slice(0, 1).toUpperCase()}</span>
      <span className="bid-copy"><strong>{bid.bidder}</strong><span>placed a bid</span></span>
      <span className="bid-amount">{gbp(Number(bid.amount))}</span>
    </div>)}
  </div>;
}
