// The shape the three screens render, filled from real `Lot` rows by a scan.
// There is deliberately no sample set: nothing in this app may be fabricated.
import type { BBox, Comp, Lot, LotStatus } from './types';

export type ScannedObject = {
  id: string;
  name: string;
  category: string;
  image: string;        // cutout or light-background product shot
  low: number;          // GBP estimate range
  high: number;
  condition: string;
  blurb: string;
  picked: boolean;
  // Present once the object came from a real scan.
  reserve?: number;
  comps?: Comp[];
  bbox?: BBox | null;
  sale_id?: string | null;
  status?: LotStatus;
  source_image_url?: string | null;
};

/** A lot row as the screens want it. `image` mirrors `image_url`. */
export function lotToObject(lot: Lot): ScannedObject {
  return {
    id: lot.id,
    name: lot.name,
    category: lot.category,
    image: lot.image_url,
    low: Number(lot.low ?? 0),
    high: Number(lot.high ?? 0),
    condition: lot.condition ?? 'Used',
    blurb: lot.blurb ?? '',
    picked: lot.picked,
    reserve: Number(lot.reserve ?? 0),
    comps: lot.comps ?? [],
    bbox: lot.bbox,
    sale_id: lot.sale_id,
    status: lot.status,
    source_image_url: lot.source_image_url,
  };
}

export const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);
