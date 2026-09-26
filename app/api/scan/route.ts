import type { NextRequest } from 'next/server';
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ok, fail } from '@/lib/api';
import { supabaseServer } from '@/lib/supabase';
import { detectObjects, cropCutout, MAX_OBJECTS, type Detection } from '@/lib/vision';
import { priceObjectFast, type Estimate } from '@/lib/pricing';
import type { Lot, ScanResponse } from '@/lib/types';

export const runtime = 'nodejs'; // sharp
export const maxDuration = 60;

const BUCKET = 'scans';

/** Supabase is optional: without it the scan still works, just held in memory. */
function db(): SupabaseClient | null {
  try {
    return supabaseServer();
  } catch {
    return null;
  }
}

async function upload(client: SupabaseClient, path: string, body: Buffer, contentType: string): Promise<string | null> {
  const { error } = await client.storage.from(BUCKET).upload(path, body, { contentType, upsert: true });
  if (error) {
    console.warn('upload failed', path, error.message);
    return null;
  }
  return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const form = await req.formData();

    // Either a captured frame, or the URL of the demo room when there is no camera.
    let frame: Buffer;
    let mediaType = 'image/jpeg';
    const file = form.get('frame');
    const sampleUrl = form.get('sampleUrl');

    if (file instanceof File && file.size > 0) {
      frame = Buffer.from(await file.arrayBuffer());
      mediaType = file.type || mediaType;
    } else if (typeof sampleUrl === 'string' && sampleUrl.startsWith('http')) {
      const res = await fetch(sampleUrl);
      if (!res.ok) return fail('could not load the sample room', 502);
      frame = Buffer.from(await res.arrayBuffer());
      mediaType = res.headers.get('content-type') ?? mediaType;
    } else {
      return fail('a frame or a sampleUrl is required');
    }

    const saleId = typeof form.get('saleId') === 'string' ? (form.get('saleId') as string) : null;
    const client = db();
    const stamp = Date.now();

    // The room frame itself, so a lot can show where it came from.
    const frameUrl = client ? ((await upload(client, `frames/${stamp}.jpg`, frame, 'image/jpeg')) ?? '') : '';

    const detections = (await detectObjects(frame, mediaType)).slice(0, MAX_OBJECTS);
    if (detections.length === 0) return ok<ScanResponse>({ lots: [], frameUrl });

    // Cut out and price every object at once; a slow comp search must not hold up the rest.
    const built = await Promise.all(
      detections.map(async (d, i): Promise<{ d: Detection; image: string; est: Estimate }> => {
        const [image, est] = await Promise.all([cutout(client, frame, d, stamp, i), priceObjectFast(d)]);
        return { d, image, est };
      })
    );

    const rows = built.map(({ d, image, est }, i) => ({
      sale_id: saleId,
      name: d.name,
      category: d.category,
      condition: d.condition,
      blurb: d.blurb,
      image_url: image,
      source_image_url: frameUrl || null,
      bbox: d.bbox,
      low: est.low,
      high: est.high,
      reserve: est.reserve,
      comps: est.comps,
      picked: true,
      status: 'found' as const,
      sort_order: i + 1,
    }));

    if (client) {
      const { data, error } = await client.from('lots').insert(rows).select();
      if (!error && data) {
        console.log(`scan: ${data.length} lots in ${Date.now() - started}ms`);
        return ok<ScanResponse>({ lots: data as Lot[], frameUrl });
      }
      console.warn('lot insert failed, returning in-memory lots:', error?.message);
    }

    // No database, or the insert failed: hand the lots straight back.
    const lots: Lot[] = rows.map((r) => ({
      ...r,
      id: crypto.randomUUID(),
      sold_to: null,
      sold_for: null,
      checkout_url: null,
      created_at: new Date().toISOString(),
    }));
    console.log(`scan: ${lots.length} lots in ${Date.now() - started}ms (no db)`);
    return ok<ScanResponse>({ lots, frameUrl });
  } catch (e) {
    console.error('scan failed', e);
    return fail(e instanceof Error ? e.message : 'scan failed', 500);
  }
}

/**
 * Upload the plain crop, or inline a small one when there is nowhere to put it.
 *
 * This is deliberately just a crop: it keeps the scan at around nine seconds so the
 * outlines appear straight away. The client then posts this same `image_url` to
 * /api/cutout, which lifts the object off its background and hands back a
 * transparent replacement. No extra field is needed for that round trip.
 */
async function cutout(
  client: SupabaseClient | null,
  frame: Buffer,
  d: Detection,
  stamp: number,
  i: number
): Promise<string> {
  try {
    if (client) {
      const png = await cropCutout(frame, d.bbox);
      const url = await upload(client, `cutouts/${stamp}-${i}.png`, png, 'image/png');
      if (url) return url;
    }
    // Small enough to sit in sessionStorage alongside five siblings.
    const webp = await cropCutout(frame, d.bbox, { longEdge: 420, format: 'webp', quality: 72 });
    return `data:image/webp;base64,${webp.toString('base64')}`;
  } catch (e) {
    console.warn('cutout failed for', d.name, e instanceof Error ? e.message : e);
  }

  // Never hand back an empty string: the browser resolves <img src=""> to the
  // page itself and renders a broken image, and /api/cutout rejects it, so the
  // lot can never recover. Fall back to the whole frame instead.
  try {
    const whole = await sharp(frame, { failOn: 'none' })
      .rotate()
      .resize({ width: 420, height: 420, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer();
    return `data:image/webp;base64,${whole.toString('base64')}`;
  } catch {
    return FALLBACK_IMAGE;
  }
}

/** Last resort: a plain neutral tile, so nothing ever renders as a broken image. */
const FALLBACK_IMAGE =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420"><rect width="420" height="420" fill="#f2f2f0"/></svg>'
  ).toString('base64');
