// True cutouts: lift one object off its background so it floats in the cloud
// as a clean product shot rather than a rectangle of someone's living room.
import sharp, { type Sharp } from 'sharp';
import { toFile } from 'openai';
import { openai } from './llm';

/**
 * The 2.5 models reproduce what is actually in the photo. The older mini model is
 * faster but invents detail that was never there, which is not acceptable when the
 * cutout is the thing a buyer bids on. Faithfulness wins over speed here.
 */
const MODEL = process.env.IMAGE_MODEL ?? 'gpt-image-2.5-sunburst';
const FALLBACK_MODEL = 'gpt-image-1-mini';

const PROMPT =
  "Isolate the single main object from this photo as a clean product cutout on a fully transparent background. " +
  "Keep the object's exact shape, colour, material and proportions. " +
  'Remove every trace of the room, floor, wall and shadow.';

/** Sunburst takes about twenty seconds, so leave real headroom before giving up. */
const TIMEOUT_MS = 45_000;

/** How large the finished cutout sits in the cloud. */
const LONG_EDGE = 700;

/**
 * Six objects are cut out at once from the browser. This caps how many actually
 * reach the image API together, so one scan cannot trip a rate limit.
 */
const MAX_IN_FLIGHT = Number(process.env.CUTOUT_CONCURRENCY ?? 3);

export type CutoutFormat = 'png' | 'webp';

// ── A minimal gate. Module-level, so it spans concurrent requests. ──
let inFlight = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight++;
    return;
  }
  // release() hands the slot straight over, so the count is already correct
  // by the time this resolves. Incrementing again here would over-admit.
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function release(): void {
  const next = waiting.shift();
  if (next) next();
  else inFlight--;
}

function isModelRejected(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /model|does not exist|not found|unsupported|invalid/i.test(msg) && !/rate limit/i.test(msg);
}

/**
 * Turn a cropped photo into a transparent PNG of just the object.
 * Never throws: returns null so the caller can keep whatever it already had.
 */
export async function makeCutout(crop: Buffer): Promise<Buffer | null> {
  await acquire();
  try {
    // The edit endpoint wants a real PNG, and the crop may arrive as webp or jpeg.
    const png = await sharp(crop, { failOn: 'none' }).png().toBuffer();

    const edit = async (model: string) => {
      const file = await toFile(png, 'crop.png', { type: 'image/png' });
      const res = await openai().images.edit(
        {
          model,
          image: [file],
          prompt: PROMPT,
          background: 'transparent',
          output_format: 'png',
          size: '1024x1024',
          // Only the older model gets pushed for speed. 2.5 runs at its default
          // fidelity, which is the whole reason we are using it.
          ...(model === FALLBACK_MODEL ? { quality: 'low' as const } : {}),
        },
        { timeout: TIMEOUT_MS }
      );
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw new Error('no image returned');
      return Buffer.from(b64, 'base64');
    };

    let square: Buffer;
    try {
      square = await edit(MODEL);
    } catch (e) {
      if (MODEL === FALLBACK_MODEL || !isModelRejected(e)) throw e;
      console.warn(`cutout: ${MODEL} rejected, falling back to ${FALLBACK_MODEL}:`, e instanceof Error ? e.message : e);
      square = await edit(FALLBACK_MODEL);
    }

    return await tighten(square);
  } catch (e) {
    console.warn('cutout failed:', e instanceof Error ? e.message : e);
    return null;
  } finally {
    release();
  }
}

/**
 * The model returns a square canvas with the object floating in the middle.
 * Trim the empty margin so the object fills its frame, and keep the alpha channel:
 * flattening here would put the background straight back.
 */
async function tighten(square: Buffer): Promise<Buffer> {
  const base = sharp(square, { failOn: 'none' }).ensureAlpha();

  let trimmed: Sharp;
  try {
    // Threshold 2 rather than 0: the edges feather slightly into transparency.
    trimmed = sharp(await base.trim({ threshold: 2 }).toBuffer(), { failOn: 'none' });
  } catch {
    // A fully transparent result has nothing to trim against.
    trimmed = sharp(square, { failOn: 'none' }).ensureAlpha();
  }

  return encode(trimmed, LONG_EDGE, 'png');
}

/** Bound the long edge and write out, alpha intact. */
export function encode(img: Sharp, longEdge: number, format: CutoutFormat, quality = 82): Promise<Buffer> {
  const sized = img.clone().resize(longEdge, longEdge, { fit: 'inside', withoutEnlargement: true });
  return format === 'png'
    ? sized.png({ compressionLevel: 9 }).toBuffer()
    : sized.webp({ quality, alphaQuality: 90 }).toBuffer();
}

/**
 * Shrink a cutout until its base64 data URL fits the budget.
 * WebP keeps the alpha channel and is a fraction of the size of PNG, so it is the
 * fallback. The budget is per object and six of them share sessionStorage, so it
 * is deliberately far below the one megabyte the response itself allows.
 */
export async function toDataUrl(cutout: Buffer, maxBytes = 300_000): Promise<string> {
  const png = `data:image/png;base64,${cutout.toString('base64')}`;
  if (png.length <= maxBytes) return png;

  const steps: Array<{ edge: number; quality: number }> = [
    { edge: 700, quality: 82 },
    { edge: 560, quality: 75 },
    { edge: 440, quality: 68 },
    { edge: 340, quality: 60 },
  ];

  let last = '';
  for (const { edge, quality } of steps) {
    const webp = await encode(sharp(cutout, { failOn: 'none' }), edge, 'webp', quality);
    last = `data:image/webp;base64,${webp.toString('base64')}`;
    if (last.length <= maxBytes) return last;
  }
  return last;
}
