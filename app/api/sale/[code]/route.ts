import { ok, fail } from '@/lib/api';
import { supabaseServer } from '@/lib/supabase';
import { findSale } from '@/lib/sale';
import type { Lot, SaleBid, SaleMessage, SaleStateResponse } from '@/lib/types';

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  try {
    const sale = await findSale(code);
    if (!sale) return fail('sale not found', 404);
    const db = supabaseServer();

    const [lotRes, bidRes, msgRes] = await Promise.all([
      sale.current_lot_id
        ? db.from('lots').select('*').eq('id', sale.current_lot_id).maybeSingle<Lot>()
        : Promise.resolve({ data: null }),
      db.from('sale_bids').select('*').eq('sale_id', sale.id).order('created_at', { ascending: false }).limit(20),
      db.from('sale_messages').select('*').eq('sale_id', sale.id).order('created_at', { ascending: false }).limit(20),
    ]);

    return ok<SaleStateResponse>({
      sale,
      lot: (lotRes.data as Lot) ?? null,
      bids: ((bidRes.data ?? []) as SaleBid[]).reverse(),
      messages: ((msgRes.data ?? []) as SaleMessage[]).reverse(),
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'sale lookup failed', 503);
  }
}
