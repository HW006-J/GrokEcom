// Shared types for ClosetLive. Mirrors supabase/schema.sql. Both agents import from here.

export type ShowPhase = 'idle' | 'intro' | 'qa' | 'auction' | 'closed' | 'ended';

export type Item = {
  id: string;
  show_id: string;
  title: string;
  brand: string | null;
  size: string | null;
  condition: string | null; // e.g. "4/5 - light wear on cuffs"
  description: string | null;
  price_estimate: number | null; // market comp, GBP
  buy_now_price: number | null; // GBP
  shopify_product_id: string | null;
  shopify_variant_id: string | null; // numeric id as string, used in cart permalink
  image_urls: string[];
  status: 'listed' | 'live' | 'sold' | 'unsold';
  sold_to: string | null;
  invoice_url: string | null;
  sort_order: number;
  created_at: string;
};

export type Show = {
  id: string;
  title: string;
  phase: ShowPhase;
  current_item_id: string | null;
  auction_ends_at: string | null; // ISO
  high_bid: number | null;
  high_bidder_name: string | null;
  created_at: string;
};

export type Bid = {
  id: string;
  show_id: string;
  item_id: string;
  bidder_name: string;
  amount: number;
  created_at: string;
};

export type Message = {
  id: string;
  show_id: string;
  name: string;
  text: string;
  answered: boolean;
  created_at: string;
};

// ---- API contract ----

export type HostAction = 'none' | 'start_auction' | 'close_auction' | 'next_item';

export type HostTickRequest = { showId: string };
export type HostTickResponse = {
  say: string;
  action: HostAction;
  answeredMessageIds: string[];
};

export type BidRequest = { showId: string; name: string; amount: number };
export type BidResponse = { ok: boolean; highBid: number; highBidder: string | null };

export type MessageRequest = { showId: string; name: string; text: string };
export type MessageResponse = { ok: boolean };

export type SessionTokenResponse = { sessionToken: string };

export type AuctionCloseRequest = { showId: string };
export type AuctionCloseResponse = {
  winner: string | null;
  amount: number | null;
  invoiceUrl: string | null;
};

export type ListingResponse = { item: Item };

export type ApiError = { error: string };

// Shopify cart permalink for Buy Now.
export function buyNowUrl(variantId: string | null): string | null {
  const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  if (!variantId || !domain) return null;
  return `https://${domain}/cart/${variantId}:1`;
}
