import { ok, fail } from '@/lib/api';
import { validBox } from '@/lib/vision';
import { segmentGrounded } from '@/lib/grounded.mjs';
import sharp from 'sharp';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!validBox(body.bbox)) return fail('Draw a box inside the photo, around the whole item.');
    if (typeof body.frame !== 'string' || body.frame.length > 12_000_000
      || !/^data:image\/(jpeg|png|webp);base64,/.test(body.frame)) return fail('The original photo is required. Take a new photo and try again.');
    const frame = Buffer.from(body.frame.split(',')[1], 'base64');
    const meta = await sharp(frame, { limitInputPixels: 4_000_000 }).metadata();
    if (!meta.width || !meta.height || meta.width > 1600 || meta.height > 1600 || (meta.orientation && meta.orientation !== 1)) return fail('Please scan this photo again first.');
    return ok(await segmentGrounded(frame, body.bbox));
  } catch (e) {
    console.warn('segmentation failed', e);
    return fail('Could not separate this area. Try a tighter box or a closer photo.', 422);
  }
}
