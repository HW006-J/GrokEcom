import { NextRequest } from 'next/server';
import { ok, fail } from '@/lib/api';
import { priceObject } from '@/lib/pricing';

export const maxDuration = 60;

/**
 * Live web-search valuation for one object. Body-driven so it works before the
 * object has a database row, which is the case during a scan.
 */
export async function POST(req: NextRequest) {
  let body: { name?: string; category?: string; condition?: string };
  try {
    body = await req.json();
  } catch {
    return fail('Body must be JSON');
  }
  if (!body.name) return fail('name is required');

  const estimate = await priceObject({
    name: body.name,
    category: body.category,
    condition: body.condition,
  });
  return ok(estimate);
}
