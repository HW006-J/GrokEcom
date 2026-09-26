import { ok, fail } from '@/lib/api';
import { prepareFrame } from '@/lib/vision';
import { scanGrounded } from '@/lib/grounded.mjs';
import type { Lot, ScanResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 120; // includes model loading on a cold process

export async function POST(req: Request) {
  const started = Date.now();
  try {
    const form = await req.formData();
    const file = form.get('frame');
    if (!(file instanceof File) || !file.size) return fail('Choose a photo to scan.');
    if (file.size > 15_000_000) return fail('Choose a photo smaller than 15 MB.', 413);
    let frame: Buffer;
    try { frame = await prepareFrame(Buffer.from(await file.arrayBuffer())); }
    catch { return fail('Please choose a readable JPEG, PNG or WebP photo.'); }
    if (req.signal.aborted) return fail('Scan cancelled.', 499);
    const found = await scanGrounded(frame);
    const frameUrl = `data:image/jpeg;base64,${frame.toString('base64')}`;
    // Suggestions stay local until the user chooses them; no pricing or writes on this path.
    const lots: Lot[] = found.map((item, index) => ({
      id: crypto.randomUUID(), sale_id: null, name: item.name, category: item.category,
      condition: 'Used — check condition', blurb: '', image_url: item.imageUrl,
      source_image_url: null, bbox: item.bbox, mask_url: item.maskUrl, cutout: true,
      confidence: item.confidence, low: 0, high: 0, reserve: 0, comps: [], picked: false,
      status: 'found', sort_order: index + 1, sold_to: null, sold_for: null, checkout_url: null,
      created_at: new Date().toISOString(),
    }));
    console.log(`grounded scan: ${lots.length} suggestions in ${Date.now() - started}ms`);
    return ok<ScanResponse>({ lots, frameUrl });
  } catch (e) {
    console.error('grounded scan failed', e);
    return fail('The object scanner is unavailable. Please try again shortly.', 503);
  }
}
