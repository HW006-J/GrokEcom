import type { Lot } from '@/lib/types';

export type MockPlatform = 'ebay' | 'marketplace';
/** Options on the demo sell form. */
export const CONDITIONS = ['New', 'Used – like new', 'Used – good', 'Used – fair'] as const;

/** A real listing (or a real search) on the actual marketplace, for comparison. */
export type SimilarItem = { title: string; price?: number; url: string; search?: boolean };

export const platformName = (platform: MockPlatform) => platform === 'ebay' ? 'eBay' : 'Marketplace';

export function realSearchUrl(platform: MockPlatform, query: string): string {
  const q = encodeURIComponent(query.trim().slice(0, 80));
  return platform === 'ebay'
    ? `https://www.ebay.co.uk/sch/i.html?_nkw=${q}`
    : `https://www.facebook.com/marketplace/search/?query=${q}`;
}

/** Real listings from pricing comps (and anything the agent found), then a real search link. */
export function similarFor(lot: Pick<Lot, 'name' | 'comps'>, platform: MockPlatform, found: SimilarItem[] = []): SimilarItem[] {
  const host = platform === 'ebay' ? /^https:\/\/(www\.)?ebay\.[a-z.]+\/itm\// : /^https:\/\/(www\.|m\.)?facebook\.com\/marketplace\/item\//;
  const fromComps = (lot.comps ?? []).filter((comp) => host.test(comp.url)).map((comp) => ({ title: comp.title, price: comp.price, url: comp.url }));
  const seen = new Set<string>();
  const real = [...fromComps, ...found].filter((item) => host.test(item.url) && !seen.has(item.url) && seen.add(item.url)).slice(0, 4);
  return [...real, { title: `Search ${platformName(platform)} for “${lot.name}”`, url: realSearchUrl(platform, lot.name), search: true }];
}

/** Unsold at auction, or scanned but never put in the sale. */
export const canList = (lot: Pick<Lot, 'status' | 'picked'>) => lot.status === 'unsold' || (lot.status === 'found' && !lot.picked);

/** Reserve, else the low estimate; £5 while background pricing is still running. */
export const askingPrice = (lot: Pick<Lot, 'reserve' | 'low'>) => Math.max(1, Math.round(Number(lot.reserve) || Number(lot.low) || 5));

export type MockListing = {
  id: string;
  lotId: string;
  platform: MockPlatform;
  title: string;
  price: number;
  condition?: string;
  imageUrl: string;
  status: 'published';
  steps: string[];
  similar: SimilarItem[];
  /** The browser-agent run that created it, for the replay screen. */
  jobId?: string;
  mockUrl: string;
  demo: true;
  createdAt: string;
};

// A local simulation only: no marketplace credentials, network or real listings.
// Survives development module reloads; intentionally resets on server restart.
const state = globalThis as typeof globalThis & {
  __selloutMockListings?: Map<string, MockListing>;
};
const listings = state.__selloutMockListings ??= new Map<string, MockListing>();
const MAX_LISTINGS = 200;

export function listMockListings(): MockListing[] {
  return [...listings.values()].reverse().map((listing) => ({ ...listing, steps: [...listing.steps] }));
}

export function getMockListing(id: string): MockListing | null {
  const listing = [...listings.values()].find((entry) => entry.id === id);
  return listing ? { ...listing, steps: [...listing.steps] } : null;
}

/** What the demo sell form submits; each field falls back to the lot. */
export type MockListingForm = { title?: string; condition?: string; price?: number; imageUrl?: string; steps?: string[]; jobId?: string; found?: SimilarItem[] };

/** Synchronous insertion makes repeated/concurrent submissions idempotent. */
export function publishMockListing(lot: Lot, platform: MockPlatform, form: MockListingForm = {}): MockListing {
  if (!canList(lot)) throw new Error('Only unsold or unauctioned items can be listed.');
  const key = `${lot.id}:${platform}`;
  const existing = listings.get(key);
  if (existing) return { ...existing, steps: [...existing.steps] };
  const id = crypto.randomUUID();
  const destination = platform === 'ebay' ? 'eBay demo' : 'Marketplace demo';
  const listing: MockListing = {
    id, lotId: lot.id, platform, title: form.title || lot.name,
    price: form.price ? Math.max(1, Math.round(form.price)) : askingPrice(lot),
    condition: form.condition || lot.condition || undefined,
    imageUrl: form.imageUrl || lot.image_url,
    status: 'published', demo: true,
    steps: form.steps?.length ? form.steps : [
      `Navigate to ${destination}`,
      'Fill item title, condition and asking price',
      'Upload item image to demo listing',
      'Submit simulated listing',
    ],
    similar: similarFor(lot, platform, form.found),
    jobId: form.jobId,
    mockUrl: `/mock-marketplace/${platform}?listing=${id}`,
    createdAt: new Date().toISOString(),
  };
  listings.set(key, listing);
  while (listings.size > MAX_LISTINGS) listings.delete(listings.keys().next().value!);
  return { ...listing, steps: [...listing.steps] };
}
