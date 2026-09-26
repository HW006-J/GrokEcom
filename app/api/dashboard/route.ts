import { ok } from '@/lib/api';
import { db } from '@/lib/db';
import { computeEarnings, summarise, type DashboardResponse } from '@/lib/earnings';

// Reads live sale state, so never prerender or cache this.
export const dynamic = 'force-dynamic';

const MAX_SALES = 20;

/**
 * GET /api/dashboard
 * Everything the seller has run, and what it earned. Real settled lots only.
 */
export async function GET() {
  const store = db();
  const sales = await store.recentSales(MAX_SALES);
  const lots = await store.lotsForSales(sales.map((s) => s.id));

  const body: DashboardResponse = {
    earnings: computeEarnings(lots),
    sales: summarise(sales, lots),
  };
  return ok(body);
}
