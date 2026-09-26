// What is it worth? A live web search of UK resale listings, turned into a GBP range.
import { structured, searchStructured } from './llm';
import { searchComps, HOUSEHOLD_MARKETS, type Comp as TavilyResult } from './tavily';
import type { Comp } from './types';

export type Estimate = { low: number; high: number; reserve: number; comps: Comp[] };
export type PriceInput = { name: string; category?: string; condition?: string };

/** Bidding opens well under the low estimate so the room has somewhere to go. */
export const reserveFor = (low: number) => Math.max(1, Math.round(low * 0.55));

// Last-resort ranges, by category, when both search and the model fail.
const FLOORS: Record<string, [number, number]> = {
  Lighting: [25, 60], Furniture: [60, 180], Tech: [40, 140], Clothing: [15, 45],
  Footwear: [20, 55], Kitchen: [15, 50], Decor: [15, 45], Sport: [30, 90], Other: [20, 60],
};

const SYSTEM = `You price used household goods for a quick private sale in the UK.

Search the live web for what this exact item, or the closest match, is actually selling for second-hand in the UK right now. Prefer eBay UK sold listings, Gumtree, Facebook Marketplace, Vinted and specialist resale sites. Two searches is usually enough.

Then return:
- low and high: whole pounds that bracket the likely selling price. Keep the gap sensible, roughly 30 to 60 percent of low.
- Adjust down for the stated condition, and for the fact that a live auction is a fast private sale, not retail.
- comps: up to four real listings you actually found and used. price is a whole number of pounds, url is the real link, source is the site's domain. Return an empty list only if you found nothing relevant.
- Never return zero or a negative number. Never invent a listing or a URL.`;

const SCHEMA = {
  properties: {
    low: { type: 'number' },
    high: { type: 'number' },
    comps: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          title: { type: 'string' },
          price: { type: 'number' },
          url: { type: 'string' },
          source: { type: 'string' },
        },
        required: ['title', 'price', 'url', 'source'],
      },
    },
  },
  required: ['low', 'high', 'comps'],
};

type Priced = { low: number; high: number; comps: Comp[] };

function normalise(low: number, high: number, fallback: [number, number]) {
  let lo = Math.round(Number(low));
  let hi = Math.round(Number(high));
  if (!Number.isFinite(lo) || lo <= 0) lo = fallback[0];
  if (!Number.isFinite(hi) || hi <= 0) hi = fallback[1];
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi === lo) hi = Math.round(lo * 1.4);
  return { low: lo, high: hi };
}

const describe = (i: PriceInput) =>
  `Item: ${i.name}\nCategory: ${i.category ?? 'Other'}\nCondition: ${i.condition ?? 'Used'}\nMarket: United Kingdom, second-hand, sold quickly.`;

/** Primary path: the model searches the live web itself, then prices from what it found. */
async function priceByWebSearch(item: PriceInput): Promise<Priced> {
  return searchStructured<Priced>({
    system: SYSTEM,
    input: describe(item),
    schema: SCHEMA,
    name: 'estimate',
    maxTokens: 2500,
    timeoutMs: 28_000,
  });
}

/** Secondary path: Tavily finds listings, the model reads them. Used when a Tavily key exists. */
async function priceByTavily(item: PriceInput): Promise<Priced> {
  let results: TavilyResult[] = [];
  try {
    results = await searchComps(`${item.name} used second hand price UK`, HOUSEHOLD_MARKETS);
  } catch { /* fall through to a model-only read */ }
  const listings = results.length
    ? results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content ?? ''}`).join('\n')
    : 'No listings found. Price it from what you know about the UK second-hand market.';
  return structured<Priced>({
    system: SYSTEM.replace(/^Search the live web.*$/m, 'You are given live marketplace listings below.'),
    content: `${describe(item)}\n\nListings:\n${listings}`,
    schema: SCHEMA,
    name: 'estimate',
    maxTokens: 900,
  });
}

/**
 * Fast path for the scan itself: no web search, model knowledge only.
 * Gets a number on screen in about two seconds; the cloud refines it afterwards.
 */
export async function priceObjectFast(item: PriceInput): Promise<Estimate> {
  const floor = FLOORS[item.category ?? 'Other'] ?? FLOORS.Other;
  try {
    const out = await priceByTavily(item); // no Tavily key means a model-only read
    const { low, high } = normalise(out.low, out.high, floor);
    return { low, high, reserve: reserveFor(low), comps: [] };
  } catch {
    return { low: floor[0], high: floor[1], reserve: reserveFor(floor[0]), comps: [] };
  }
}

/** Never throws. Always returns a usable range. */
export async function priceObject(item: PriceInput): Promise<Estimate> {
  const floor = FLOORS[item.category ?? 'Other'] ?? FLOORS.Other;

  const attempts: Array<() => Promise<Priced>> = [() => priceByWebSearch(item)];
  if (process.env.TAVILY_API_KEY) attempts.push(() => priceByTavily(item));
  attempts.push(() => priceByTavily(item)); // model-only read, no search

  for (const attempt of attempts) {
    try {
      const out = await attempt();
      const { low, high } = normalise(out.low, out.high, floor);
      const comps = (out.comps ?? [])
        .filter((c) => c && Number(c.price) > 0 && typeof c.url === 'string')
        .slice(0, 4)
        .map((c) => ({ title: String(c.title), price: Math.round(Number(c.price)), url: c.url, source: String(c.source) }));
      return { low, high, reserve: reserveFor(low), comps };
    } catch (e) {
      console.warn('pricing attempt failed:', e instanceof Error ? e.message : e);
    }
  }

  return { low: floor[0], high: floor[1], reserve: reserveFor(floor[0]), comps: [] };
}
