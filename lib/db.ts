// Persistence for the sale layer, behind one interface with two backends.
//
// Supabase when credentials exist, otherwise an in-process memory store so the
// whole auction — opening a sale, the QR link, bidding from other phones —
// works with no database at all. Callers cannot tell which one they got.
//
// The memory store lives in module scope. It survives navigation and every
// request the running server handles, but NOT a server restart or a dev hot
// reload, and it is per-instance, so do not scale the app past one Railway
// instance while relying on it.
import { supabaseServer } from '@/lib/supabase';
import type { Lot, Sale, SaleBid, SaleMessage } from '@/lib/types';

export type NewSale = { code: string; title: string };
/** `id` is optional: pass one to preserve a client-side id, omit it to mint a fresh one. */
export type NewLot = Partial<Omit<Lot, 'created_at'>> & { name: string };
export type NewBid = { sale_id: string; lot_id: string; bidder: string; amount: number };
export type NewMessage = { sale_id: string; name: string; text: string };

export interface SaleStore {
  createSale(row: NewSale): Promise<Sale | null>;
  findSaleByCode(code: string): Promise<Sale | null>;
  updateSale(id: string, patch: Partial<Sale>): Promise<Sale | null>;

  /**
   * Compare-and-set on the leading bid. Succeeds only if the high bid is still
   * `expected`, so two people tapping at the same instant cannot both lead.
   */
  casHighBid(id: string, expected: number | null, amount: number, bidder: string): Promise<boolean>;

  insertLots(rows: NewLot[]): Promise<Lot[]>;
  lotsForSale(saleId: string): Promise<Lot[]>;
  lotsByIds(ids: string[]): Promise<Lot[]>;
  getLot(id: string): Promise<Lot | null>;
  updateLot(id: string, patch: Partial<Lot>): Promise<Lot | null>;

  insertBid(row: NewBid): Promise<void>;
  recentBids(saleId: string, limit: number): Promise<SaleBid[]>;
  bidsForLotSince(lotId: string, sinceIso: string): Promise<SaleBid[]>;

  insertMessage(row: NewMessage): Promise<void>;
  recentMessages(saleId: string, limit: number): Promise<SaleMessage[]>;
  unansweredMessages(saleId: string, limit: number): Promise<SaleMessage[]>;
  markAnswered(ids: string[]): Promise<void>;
}

// ── Supabase backend ────────────────────────────────────────

class SupabaseStore implements SaleStore {
  private db() {
    return supabaseServer();
  }

  async createSale(row: NewSale): Promise<Sale | null> {
    const { data, error } = await this.db()
      .from('sales')
      .insert({ ...row, phase: 'idle', watchers: 0 })
      .select('*')
      .single<Sale>();
    if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
    return data ?? null;
  }

  async findSaleByCode(code: string): Promise<Sale | null> {
    const { data } = await this.db()
      .from('sales')
      .select('*')
      .eq('code', code.toUpperCase())
      .maybeSingle<Sale>();
    return data ?? null;
  }

  async updateSale(id: string, patch: Partial<Sale>): Promise<Sale | null> {
    const { data } = await this.db().from('sales').update(patch).eq('id', id).select('*').single<Sale>();
    return data ?? null;
  }

  async casHighBid(id: string, expected: number | null, amount: number, bidder: string): Promise<boolean> {
    const update = this.db().from('sales').update({ high_bid: amount, high_bidder: bidder }).eq('id', id);
    const guarded = expected === null ? update.is('high_bid', null) : update.eq('high_bid', expected);
    const { data, error } = await guarded.select('high_bid');
    if (error) throw new Error(error.message);
    return Boolean(data && data.length > 0);
  }

  async insertLots(rows: NewLot[]): Promise<Lot[]> {
    if (rows.length === 0) return [];
    const { data, error } = await this.db().from('lots').insert(rows).select('*');
    if (error) throw new Error(error.message);
    return (data ?? []) as Lot[];
  }

  async lotsForSale(saleId: string): Promise<Lot[]> {
    const { data } = await this.db().from('lots').select('*').eq('sale_id', saleId).order('sort_order');
    return (data ?? []) as Lot[];
  }

  async lotsByIds(ids: string[]): Promise<Lot[]> {
    if (ids.length === 0) return [];
    const { data } = await this.db().from('lots').select('*').in('id', ids);
    return (data ?? []) as Lot[];
  }

  async getLot(id: string): Promise<Lot | null> {
    const { data } = await this.db().from('lots').select('*').eq('id', id).maybeSingle<Lot>();
    return data ?? null;
  }

  async updateLot(id: string, patch: Partial<Lot>): Promise<Lot | null> {
    const { data } = await this.db().from('lots').update(patch).eq('id', id).select('*').single<Lot>();
    return data ?? null;
  }

  async insertBid(row: NewBid): Promise<void> {
    const { error } = await this.db().from('sale_bids').insert(row);
    if (error) throw new Error(error.message);
  }

  async recentBids(saleId: string, limit: number): Promise<SaleBid[]> {
    const { data } = await this.db()
      .from('sale_bids')
      .select('*')
      .eq('sale_id', saleId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return ((data ?? []) as SaleBid[]).reverse();
  }

  async bidsForLotSince(lotId: string, sinceIso: string): Promise<SaleBid[]> {
    const { data } = await this.db()
      .from('sale_bids')
      .select('*')
      .eq('lot_id', lotId)
      .gt('created_at', sinceIso)
      .order('created_at');
    return (data ?? []) as SaleBid[];
  }

  async insertMessage(row: NewMessage): Promise<void> {
    const { error } = await this.db().from('sale_messages').insert(row);
    if (error) throw new Error(error.message);
  }

  async recentMessages(saleId: string, limit: number): Promise<SaleMessage[]> {
    const { data } = await this.db()
      .from('sale_messages')
      .select('*')
      .eq('sale_id', saleId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return ((data ?? []) as SaleMessage[]).reverse();
  }

  async unansweredMessages(saleId: string, limit: number): Promise<SaleMessage[]> {
    const { data } = await this.db()
      .from('sale_messages')
      .select('*')
      .eq('sale_id', saleId)
      .eq('answered', false)
      .order('created_at')
      .limit(limit);
    return (data ?? []) as SaleMessage[];
  }

  async markAnswered(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db().from('sale_messages').update({ answered: true }).in('id', ids);
  }
}

// ── Memory backend ──────────────────────────────────────────

const MAX_SALES = 20;

type Mem = {
  sales: Map<string, Sale>;
  byCode: Map<string, string>;
  lots: Map<string, Lot>;
  bids: SaleBid[];
  messages: SaleMessage[];
  lastStamp: number;
};

// Survives navigation and every request this process serves. Not a restart.
const globalMem = globalThis as unknown as { __selloutMem?: Mem };
const mem: Mem =
  globalMem.__selloutMem ??
  (globalMem.__selloutMem = {
    sales: new Map(),
    byCode: new Map(),
    lots: new Map(),
    bids: [],
    messages: [],
    lastStamp: 0,
  });

/** Strictly increasing so `created_at` ordering and "since" comparisons hold. */
function stamp(): string {
  const now = Math.max(Date.now(), mem.lastStamp + 1);
  mem.lastStamp = now;
  return new Date(now).toISOString();
}

function evict() {
  while (mem.sales.size > MAX_SALES) {
    let oldestId: string | null = null;
    let oldestAt = Infinity;
    for (const s of mem.sales.values()) {
      const at = new Date(s.created_at).getTime();
      if (at < oldestAt) {
        oldestAt = at;
        oldestId = s.id;
      }
    }
    if (!oldestId) return;
    const sale = mem.sales.get(oldestId)!;
    mem.sales.delete(oldestId);
    mem.byCode.delete(sale.code);
    for (const [id, lot] of mem.lots) if (lot.sale_id === oldestId) mem.lots.delete(id);
    mem.bids = mem.bids.filter((b) => b.sale_id !== oldestId);
    mem.messages = mem.messages.filter((m) => m.sale_id !== oldestId);
  }
}

class MemoryStore implements SaleStore {
  async createSale(row: NewSale): Promise<Sale | null> {
    const code = row.code.toUpperCase();
    if (mem.byCode.has(code)) return null; // collision, caller retries with a new code
    const sale: Sale = {
      id: crypto.randomUUID(),
      code,
      title: row.title,
      phase: 'idle',
      current_lot_id: null,
      lot_ends_at: null,
      high_bid: null,
      high_bidder: null,
      watchers: 0,
      created_at: stamp(),
    };
    mem.sales.set(sale.id, sale);
    mem.byCode.set(code, sale.id);
    evict();
    return { ...sale };
  }

  async findSaleByCode(code: string): Promise<Sale | null> {
    const id = mem.byCode.get(code.toUpperCase());
    const sale = id ? mem.sales.get(id) : null;
    return sale ? { ...sale } : null;
  }

  async updateSale(id: string, patch: Partial<Sale>): Promise<Sale | null> {
    const sale = mem.sales.get(id);
    if (!sale) return null;
    Object.assign(sale, patch);
    return { ...sale };
  }

  async casHighBid(id: string, expected: number | null, amount: number, bidder: string): Promise<boolean> {
    const sale = mem.sales.get(id);
    if (!sale) return false;
    // Single-threaded: read and write land together, so this is genuinely atomic.
    const current = sale.high_bid === null || sale.high_bid === undefined ? null : Number(sale.high_bid);
    if (current !== expected) return false;
    sale.high_bid = amount;
    sale.high_bidder = bidder;
    return true;
  }

  async insertLots(rows: NewLot[]): Promise<Lot[]> {
    return rows.map((r) => {
      const lot: Lot = {
        id: r.id ?? crypto.randomUUID(),
        sale_id: r.sale_id ?? null,
        name: r.name,
        category: r.category ?? 'Other',
        condition: r.condition ?? '',
        blurb: r.blurb ?? '',
        image_url: r.image_url ?? '',
        source_image_url: r.source_image_url ?? null,
        bbox: r.bbox ?? null,
        low: r.low ?? 0,
        high: r.high ?? 0,
        reserve: r.reserve ?? (r.low ? Math.round(r.low * 0.55) : 0),
        comps: r.comps ?? [],
        picked: r.picked ?? true,
        status: r.status ?? 'queued',
        sold_to: r.sold_to ?? null,
        sold_for: r.sold_for ?? null,
        checkout_url: r.checkout_url ?? null,
        sort_order: r.sort_order ?? 0,
        created_at: stamp(),
      };
      mem.lots.set(lot.id, lot);
      return { ...lot };
    });
  }

  async lotsForSale(saleId: string): Promise<Lot[]> {
    return [...mem.lots.values()]
      .filter((l) => l.sale_id === saleId)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((l) => ({ ...l }));
  }

  async lotsByIds(ids: string[]): Promise<Lot[]> {
    return ids.map((id) => mem.lots.get(id)).filter((l): l is Lot => Boolean(l)).map((l) => ({ ...l }));
  }

  async getLot(id: string): Promise<Lot | null> {
    const lot = mem.lots.get(id);
    return lot ? { ...lot } : null;
  }

  async updateLot(id: string, patch: Partial<Lot>): Promise<Lot | null> {
    const lot = mem.lots.get(id);
    if (!lot) return null;
    Object.assign(lot, patch);
    return { ...lot };
  }

  async insertBid(row: NewBid): Promise<void> {
    mem.bids.push({ id: crypto.randomUUID(), ...row, created_at: stamp() });
  }

  async recentBids(saleId: string, limit: number): Promise<SaleBid[]> {
    return mem.bids.filter((b) => b.sale_id === saleId).slice(-limit).map((b) => ({ ...b }));
  }

  async bidsForLotSince(lotId: string, sinceIso: string): Promise<SaleBid[]> {
    return mem.bids
      .filter((b) => b.lot_id === lotId && b.created_at > sinceIso)
      .map((b) => ({ ...b }));
  }

  async insertMessage(row: NewMessage): Promise<void> {
    mem.messages.push({ id: crypto.randomUUID(), ...row, answered: false, created_at: stamp() });
  }

  async recentMessages(saleId: string, limit: number): Promise<SaleMessage[]> {
    return mem.messages.filter((m) => m.sale_id === saleId).slice(-limit).map((m) => ({ ...m }));
  }

  async unansweredMessages(saleId: string, limit: number): Promise<SaleMessage[]> {
    return mem.messages
      .filter((m) => m.sale_id === saleId && !m.answered)
      .slice(0, limit)
      .map((m) => ({ ...m }));
  }

  async markAnswered(ids: string[]): Promise<void> {
    const set = new Set(ids);
    for (const m of mem.messages) if (set.has(m.id)) m.answered = true;
  }
}

// ── Picking one ─────────────────────────────────────────────

export function hasSupabase(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let store: SaleStore | null = null;
let announced = false;

export function db(): SaleStore {
  const supabase = hasSupabase();
  if (!announced) {
    announced = true;
    console.log(`[sellout] sale store: ${supabase ? 'supabase' : 'memory (no database configured)'}`);
  }
  if (!store) store = supabase ? new SupabaseStore() : new MemoryStore();
  return store;
}
