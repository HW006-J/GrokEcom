// The Sellout — shared domain + API contract.
// Track A owns detection/pricing. Track B owns the sale/auction. Change nothing here without telling the other track.

// ── Domain ──────────────────────────────────────────────────

/** One thing found in a room scan and, if picked, sold as a lot. */
export type Lot = {
  id: string;
  sale_id: string | null;
  name: string;                 // "Ceramic table lamp"
  category: string;             // Lighting | Furniture | Tech | Clothing | Footwear | Other
  condition: string;            // short human phrase, e.g. "Very good, light wear"
  blurb: string;                // one or two sentences the auctioneer can riff on
  image_url: string;            // cutout on transparent/white, used in the cloud and the sale
  source_image_url: string | null; // the original room frame
  mask_url?: string;           // exact foreground mask in source image coordinates
  cutout?: boolean;
  preview_generated?: boolean;
  confidence?: number;
  bbox: BBox | null;            // where it sat in the frame, 0..1 relative
  low: number;                  // GBP estimate range from comps
  high: number;
  reserve: number;              // where bidding opens
  comps: Comp[];                // evidence behind the estimate
  picked: boolean;              // selected for the sale
  status: LotStatus;
  sold_to: string | null;
  sold_for: number | null;
  checkout_url: string | null;
  sort_order: number;
  created_at: string;
};

export type LotStatus = 'found' | 'queued' | 'live' | 'sold' | 'unsold';

export type BBox = { x: number; y: number; w: number; h: number }; // 0..1 of the frame

export type Comp = { title: string; price: number; url: string; source: string };

/** A live sale: an ordered queue of lots with one on the block at a time. */
export type Sale = {
  bidding_seconds?: number;
  starts_at?: string | null;    // ISO, when the host scheduled bidding to begin; null until scheduled
  id: string;
  code: string;                 // short join code used in the share link
  title: string;
  phase: SalePhase;
  current_lot_id: string | null;
  lot_ends_at: string | null;   // ISO
  high_bid: number | null;
  high_bidder: string | null;
  watchers: number;
  created_at: string;
};

export type SalePhase = 'idle' | 'presenting' | 'bidding' | 'sold' | 'ended';

export type SaleBid = {
  id: string;
  sale_id: string;
  lot_id: string;
  bidder: string;
  amount: number;
  created_at: string;
};

export type SaleMessage = {
  id: string;
  sale_id: string;
  name: string;
  text: string;
  answered: boolean;
  created_at: string;
};

// ── API contract ────────────────────────────────────────────
// Every route returns JSON. Failures return { error } with a 4xx/5xx status.

export type ApiError = { error: string };

/** TRACK A — POST /api/scan  (multipart: frame=File, saleId?) */
export type ScanResponse = { lots: Lot[]; frameUrl: string };

/** TRACK A — POST /api/lots/[id]/price → refresh the estimate from live comps */
export type PriceResponse = { low: number; high: number; reserve: number; comps: Comp[] };

/** TRACK B — POST /api/sale  { lotIds: string[], title? } → opens a sale */
export type CreateSaleResponse = { sale: Sale; shareUrl: string };

/** TRACK B — POST /api/sale/[code]/tick  → drives the auctioneer and the phase machine */
export type TickResponse = {
  say: string;                        // the line to speak
  action: 'none' | 'open_bidding' | 'close_lot' | 'next_lot' | 'end_sale';
  answeredMessageIds: string[];
};

/** TRACK B — POST /api/sale/[code]/bid  { bidder, amount } */
export type BidResponse = { ok: boolean; highBid: number; highBidder: string | null };

/** TRACK B — POST /api/sale/[code]/message  { name, text } */
export type MessageResponse = { ok: boolean };

/** TRACK B — POST /api/sale/[code]/close → settles the current lot */
export type CloseLotResponse = { winner: string | null; amount: number | null; checkoutUrl: string | null };

/** TRACK B — GET /api/sale/[code] → full state for the bidder page */
export type SaleStateResponse = { sale: Sale; lot: Lot | null; bids: SaleBid[]; messages: SaleMessage[]; lots?: Lot[] };

/** Avatar session for the auctioneer. */
export type SessionTokenResponse = { sessionToken: string };

// ── Helpers ─────────────────────────────────────────────────

export const gbp = (n: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);

export function shareUrlFor(code: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? '';
  return `${base}/join/${code}`;
}
