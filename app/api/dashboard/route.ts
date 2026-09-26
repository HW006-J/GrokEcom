import { ok } from '@/lib/api';
import { db } from '@/lib/db';
import { computeEarnings, summarise, type DashboardResponse } from '@/lib/earnings';

// Reads live sale state, so never prerender or cache this.
export const dynamic = 'force-dynamic';

// Look back over plenty of sales, because most of them are rehearsals that
// never put a lot on the block and get filtered out, then show the real ones.
const LOOK_BACK = 200;
const MAX_SHOWN = 20;

/**
 * GET /api/dashboard
 * Everything the seller has run, and what it earned. Real settled lots only.
 */
export async function GET() {
  const store = db();
  const sales = await store.recentSales(LOOK_BACK);
  const lots = await store.lotsForSales(sales.map((s) => s.id));

  const body: DashboardResponse = {
    earnings: computeEarnings(lots),
    sales: summarise(sales, lots).slice(0, MAX_SHOWN),
  };
  return ok(body);
}
