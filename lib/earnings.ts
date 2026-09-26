// What the seller actually made. Every figure here traces back to a settled lot;
// nothing is estimated, smoothed or invented. If nothing has sold, everything is zero.
import type { Lot, Sale } from '@/lib/types';

/** A lot counts as sold only when it settled AND recorded a real amount. */
export function isSold(lot: Lot): boolean {
  return lot.status === 'sold' && Number(lot.sold_for) > 0;
}

/** A lot has been offered once it has been on the block, won or not. */
export function isSettled(lot: Lot): boolean {
  return lot.status === 'sold' || lot.status === 'unsold';
}

export type BestLot = {
  id: string;
  name: string;
  image_url: string;
  amount: number;
  buyer: string | null;
};

/**
 * Did the room beat the valuation? Compared against the midpoint of each lot's
 * own estimate, over the sold lots that carried a real estimate.
 */
export type VsEstimate = {
  comparable: number; // lots this could be measured on
  achieved: number;
  expected: number;
  delta: number;      // achieved - expected, may be negative
  pct: number;        // delta as a share of expected
};

export type Earnings = {
  totalRaised: number;
  lotsSold: number;
  lotsOffered: number;  // settled lots: sold plus unsold
  sellThrough: number;  // 0..1, zero when nothing was offered
  averagePrice: number; // zero when nothing sold
  best: BestLot | null;
  vsEstimate: VsEstimate | null;
};

export type SaleSummary = {
  sale: Sale;
  lots: Lot[];
  raised: number;
  sold: number;
  offered: number;
};

export type DashboardResponse = {
  earnings: Earnings;
  sales: SaleSummary[];
};

export function computeEarnings(lots: Lot[]): Earnings {
  const sold = lots.filter(isSold);
  const offered = lots.filter(isSettled);

  const totalRaised = sold.reduce((sum, l) => sum + Number(l.sold_for), 0);
  const lotsSold = sold.length;
  const lotsOffered = offered.length;

  const best = sold.reduce<BestLot | null>((top, l) => {
    const amount = Number(l.sold_for);
    if (top && top.amount >= amount) return top;
    return { id: l.id, name: l.name, image_url: l.image_url, amount, buyer: l.sold_to };
  }, null);

  // Only lots that actually carried an estimate can be compared against one.
  const comparable = sold.filter((l) => Number(l.low) > 0 && Number(l.high) > 0);
  const expected = comparable.reduce((sum, l) => sum + (Number(l.low) + Number(l.high)) / 2, 0);
  const achieved = comparable.reduce((sum, l) => sum + Number(l.sold_for), 0);

  return {
    totalRaised,
    lotsSold,
    lotsOffered,
    sellThrough: lotsOffered > 0 ? lotsSold / lotsOffered : 0,
    averagePrice: lotsSold > 0 ? totalRaised / lotsSold : 0,
    best,
    vsEstimate:
      comparable.length > 0 && expected > 0
        ? {
            comparable: comparable.length,
            achieved: Math.round(achieved),
            expected: Math.round(expected),
            delta: Math.round(achieved - expected),
            pct: (achieved - expected) / expected,
          }
        : null,
  };
}

/** Group lots under their sale, newest sale first, lots in running order. */
export function summarise(sales: Sale[], lots: Lot[]): SaleSummary[] {
  return sales.map((sale) => {
    const mine = lots.filter((l) => l.sale_id === sale.id).sort((a, b) => a.sort_order - b.sort_order);
    return {
      sale,
      lots: mine,
      raised: mine.filter(isSold).reduce((sum, l) => sum + Number(l.sold_for), 0),
      sold: mine.filter(isSold).length,
      offered: mine.filter(isSettled).length,
    };
  });
}
