import { ok, fail } from '@/lib/api';
import { db } from '@/lib/db';
import { findSale, saleLots } from '@/lib/sale';
import type { SaleStateResponse } from '@/lib/types';

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  try {
    const sale = await findSale(code);
    if (!sale) return fail('sale not found', 404);
    const store = db();

    const [lot, bids, messages, lots] = await Promise.all([
      sale.current_lot_id ? store.getLot(sale.current_lot_id) : Promise.resolve(null),
      store.recentBids(sale.id, 20),
      store.recentMessages(sale.id, 20),
      saleLots(sale.id),
    ]);

    return ok<SaleStateResponse>({ sale, lot, bids, messages, lots });
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'sale lookup failed', 500);
  }
}
