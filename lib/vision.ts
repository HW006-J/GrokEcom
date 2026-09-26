import sharp from 'sharp';
import type { BBox } from './types';

/** One canonical pixel space for the detector, masks, cutouts and browser. */
export async function prepareFrame(frame: Buffer): Promise<Buffer> {
  return sharp(frame, { limitInputPixels: 40_000_000 }).rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#fff' }).jpeg({ quality: 90 }).toBuffer();
}

export function validBox(value: unknown): value is BBox {
  if (!value || typeof value !== 'object') return false;
  const b = value as BBox;
  return [b.x, b.y, b.w, b.h].every(v => typeof v === 'number' && Number.isFinite(v))
    && b.x >= 0 && b.y >= 0 && b.w >= .025 && b.h >= .025
    && b.x + b.w <= 1.000001 && b.y + b.h <= 1.000001;
}
