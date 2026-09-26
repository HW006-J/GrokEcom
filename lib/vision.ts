// Room scan: find the sellable objects in a photo and cut each one out.
import sharp from 'sharp';
import { structured } from './llm';
import type { BBox } from './types';

export type Detection = {
  name: string;
  category: string;
  condition: string;
  blurb: string;
  bbox: BBox;
};

export const CATEGORIES = [
  'Lighting',
  'Furniture',
  'Tech',
  'Clothing',
  'Footwear',
  'Kitchen',
  'Decor',
  'Sport',
  'Other',
] as const;

export const MAX_OBJECTS = 6;

const SYSTEM = `You value second-hand household goods for a live auction.

Look at the room photo and pick out the individual objects someone could realistically sell.
Rules:
- At most ${MAX_OBJECTS} objects, best first. Fewer is fine.
- Only free-standing, sellable things: furniture, lamps, electronics, cameras, instruments, bikes, clothing, shoes, bags, kitchen kit, framed art, decor.
- Never return walls, floors, ceilings, carpets, curtains, radiators, doors, windows, built-in units, houseplants, food, or people.
- Skip anything too small, too cheap, or too obscured to sell.
- name: what a buyer would search for, specific but short, e.g. "Ceramic table lamp", "Mid-century lounge chair".
- category: the closest of ${CATEGORIES.join(', ')}.
- condition: a short honest phrase from what you can actually see, e.g. "Very good", "Good, light wear on the arms". Never invent damage you cannot see.
- blurb: one or two warm, concrete sentences an auctioneer could say out loud. Materials, colour, shape. No prices, no hype, no emoji.
- x, y, w, h: the object's box as a fraction of the image, where x,y is the top-left corner. Keep the box tight around the object.`;

type RawDetection = {
  name: string;
  category: string;
  condition: string;
  blurb: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/** Ask the model what is worth selling in this room. Never throws; returns [] on failure. */
export async function detectObjects(frame: Buffer, mediaType = 'image/jpeg'): Promise<Detection[]> {
  try {
    const dataUrl = `data:${mediaType};base64,${frame.toString('base64')}`;
    const out = await structured<{ objects: RawDetection[] }>({
      name: 'room_objects',
      system: SYSTEM,
      // High detail matters here: the boxes are useless at 512px.
      content: [
        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        { type: 'text', text: 'Find the sellable objects in this room.' },
      ],
      schema: {
        properties: {
          objects: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                category: { type: 'string', enum: [...CATEGORIES] },
                condition: { type: 'string' },
                blurb: { type: 'string' },
                x: { type: 'number' },
                y: { type: 'number' },
                w: { type: 'number' },
                h: { type: 'number' },
              },
              required: ['name', 'category', 'condition', 'blurb', 'x', 'y', 'w', 'h'],
            },
          },
        },
        required: ['objects'],
      },
      maxTokens: 2000,
    });

    return (out.objects ?? [])
      .slice(0, MAX_OBJECTS)
      .map((d) => {
        const x = clamp01(d.x);
        const y = clamp01(d.y);
        return {
          name: d.name.trim(),
          category: d.category || 'Other',
          condition: (d.condition || 'Used').trim(),
          blurb: (d.blurb || '').trim(),
          bbox: { x, y, w: clamp01(Math.min(d.w, 1 - x)), h: clamp01(Math.min(d.h, 1 - y)) },
        };
      })
      .filter((d) => d.name && d.bbox.w > 0.02 && d.bbox.h > 0.02);
  } catch (e) {
    console.warn('detectObjects failed:', e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * Cut one object out of the frame. The cloud blends with multiply over white,
 * so a tight crop on a bright room reads as a cutout.
 */
export async function cropCutout(
  frame: Buffer,
  bbox: BBox,
  opts: { pad?: number; longEdge?: number; format?: 'png' | 'webp'; quality?: number } = {}
): Promise<Buffer> {
  const { pad = 0.06, longEdge = 700, format = 'png', quality = 80 } = opts;

  // Apply EXIF orientation into a real buffer FIRST, then measure that.
  // metadata() on the source reports pre-rotation dimensions, so a phone photo
  // held in portrait (EXIF orientation 5-8) transposes the pipeline and every
  // extract region computed from those numbers is invalid.
  const upright = await sharp(frame, { failOn: 'none' }).rotate().toBuffer();
  const img = sharp(upright, { failOn: 'none' });
  const meta = await img.metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error('unreadable frame');

  const padX = bbox.w * pad;
  const padY = bbox.h * pad;
  const left = Math.round(clamp01(bbox.x - padX) * W);
  const top = Math.round(clamp01(bbox.y - padY) * H);
  const width = Math.max(16, Math.min(W - left, Math.round((bbox.w + padX * 2) * W)));
  const height = Math.max(16, Math.min(H - top, Math.round((bbox.h + padY * 2) * H)));

  const cut = img.extract({ left, top, width, height }).resize({
    width: width >= height ? longEdge : undefined,
    height: height > width ? longEdge : undefined,
    fit: 'inside',
    withoutEnlargement: true,
  });

  return format === 'png' ? cut.png({ compressionLevel: 8 }).toBuffer() : cut.webp({ quality }).toBuffer();
}
