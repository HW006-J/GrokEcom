import type { Lot } from '@/lib/types';

export type MockPlatform = 'ebay' | 'marketplace';
/** Options on the demo sell form. */
export const CONDITIONS = ['New', 'Used – like new', 'Used – good', 'Used – fair'] as const;

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
export type MockListingForm = { title?: string; condition?: string; price?: number; imageUrl?: string; steps?: string[] };

/** Synchronous insertion makes repeated/concurrent submissions idempotent. */
export function publishMockListing(lot: Lot, platform: MockPlatform, form: MockListingForm = {}): MockListing {
  if (lot.status !== 'unsold') throw new Error('Only unsold items can be listed.');
  const key = `${lot.id}:${platform}`;
  const existing = listings.get(key);
  if (existing) return { ...existing, steps: [...existing.steps] };
  const id = crypto.randomUUID();
  const destination = platform === 'ebay' ? 'eBay demo' : 'Marketplace demo';
  const listing: MockListing = {
    id, lotId: lot.id, platform, title: form.title || lot.name,
    price: Math.max(1, Math.round(form.price || Number(lot.reserve) || Number(lot.low) || 1)),
    condition: form.condition || lot.condition || undefined,
    imageUrl: form.imageUrl || lot.image_url,
    status: 'published', demo: true,
    steps: form.steps?.length ? form.steps : [
      `Navigate to ${destination}`,
      'Fill item title, condition and asking price',
      'Upload item image to demo listing',
      'Submit simulated listing',
    ],
    mockUrl: `/mock-marketplace/${platform}?listing=${id}`,
    createdAt: new Date().toISOString(),
  };
  listings.set(key, listing);
  while (listings.size > MAX_LISTINGS) listings.delete(listings.keys().next().value!);
  return { ...listing, steps: [...listing.steps] };
}
