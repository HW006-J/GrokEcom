// What is it worth? Live comps from resale marketplaces, turned into a GBP range.
import { structured } from './llm';
import { searchComps, HOUSEHOLD_MARKETS, type Comp as TavilyResult } from './tavily';
import type { Comp } from './types';

export type Estimate = { low: number; high: number; reserve: number; comps: Comp[] };

export type PriceInput = { name: string; category?: string; condition?: string };

/** Bidding opens well under the low estimate so the room has somewhere to go. */
export const reserveFor = (low: number) => Math.max(1, Math.round(low * 0.55));

// Last-resort ranges, by category, when both search and the model fail.
const FLOORS: Record<string, [number, number]> = {
  Lighting: [25, 60],
  Furniture: [60, 180],
  Tech: [40, 140],
  Clothing: [15, 45],
  Footwear: [20, 55],
  Kitchen: [15, 50],
  Decor: [15, 45],
  Sport: [30, 90],
  Other: [20, 60],
};

const SYSTEM = `You price used household goods for a UK private sale.

You get an item and, usually, a handful of live marketplace listings.
Return what this item would realistically fetch second-hand in the UK, in pounds.
- low and high are whole pounds and bracket the likely selling price. Keep the gap sensible, roughly 30 to 60 percent of low.
- Lean on the listings when they match the item. Ignore listings for a different thing, for parts, or in another currency.
- Adjust down for the stated condition, and for the fact that a live auction is a quick private sale, not retail.
- comps: up to four of the listings you actually used. price is a whole number of pounds. source is the site's domain. Return an empty list if none were useful.
- Never return zero or a negative number.`;

function normalise(low: number, high: number, fallback: [number, number]): { low: number; high: number } {
  let lo = Math.round(Number(low));
  let hi = Math.round(Number(high));
  if (!Number.isFinite(lo) || lo <= 0) lo = fallback[0];
  if (!Number.isFinite(hi) || hi <= 0) hi = fallback[1];
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi === lo) hi = Math.round(lo * 1.4);
  return { low: lo, high: hi };
}

/** Never throws. Always returns a usable range. */
export async function priceObject(item: PriceInput): Promise<Estimate> {
  const category = item.category ?? 'Other';
  const condition = item.condition ?? 'Used';
  const floor = FLOORS[category] ?? FLOORS.Other;

  let results: TavilyResult[] = [];
  try {
    results = await searchComps(`${item.name} used second hand price UK`, HOUSEHOLD_MARKETS);
  } catch (e) {
    console.warn('comps search failed:', e instanceof Error ? e.message : e);
  }

  const listings = results.length
    ? results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content}`).join('\n')
    : '(no listings found — estimate from your own knowledge of the UK second-hand market)';

  try {
    const out = await structured<{ low: number; high: number; comps: Comp[] }>({
      name: 'price_estimate',
      system: SYSTEM,
      content: `Item: ${item.name}\nCategory: ${category}\nCondition: ${condition}\n\nLive listings:\n${listings}`,
      schema: {
        properties: {
          low: { type: 'number' },
          high: { type: 'number' },
          comps: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
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
      },
      maxTokens: 900,
    });

    const { low, high } = normalise(out.low, out.high, floor);
    const comps = (out.comps ?? [])
      .slice(0, 4)
      .filter((c) => c.url && Number.isFinite(c.price) && c.price > 0)
      .map((c) => ({ ...c, price: Math.round(c.price) }));

    return { low, high, reserve: reserveFor(low), comps };
  } catch (e) {
    console.warn('priceObject fell back to category floor:', e instanceof Error ? e.message : e);
    return { low: floor[0], high: floor[1], reserve: reserveFor(floor[0]), comps: [] };
  }
}
