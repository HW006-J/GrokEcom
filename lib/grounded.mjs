// Real detection + segmentation. No language-model coordinates or generated pixels.
import { pipeline, Sam2Model, AutoProcessor, RawImage, env } from '@huggingface/transformers';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import path from 'node:path';

env.cacheDir = process.env.VISION_CACHE_DIR || path.join(process.cwd(), '.cache/vision');
const DETECTOR = 'onnx-community/grounding-dino-tiny-ONNX';
const SEGMENTER = 'onnx-community/sam2.1-hiera-tiny-ONNX';
const QUERY = 'person. chair. table. lamp. framed picture. cabinet. sofa. television. laptop. bag. vase. mug. book. shoes. clock.';
// Retain one model instance across Next development reloads; bound per-photo memory.
const key = Symbol.for('sellout.grounded.v5');
const state = globalThis[key] ??= { models: null, frames: new Map(), tail: Promise.resolve() };

export function warmupVision() {
  if (!state.models) {
    const options = { dtype: 'q8', session_options: { intraOpNumThreads: 4 } };
    state.models = Promise.all([
      pipeline('zero-shot-object-detection', DETECTOR, options),
      Sam2Model.from_pretrained(SEGMENTER, options),
      AutoProcessor.from_pretrained(SEGMENTER),
    ]).then(([detector, sam, processor]) => ({ detector, sam, processor })).catch(e => { state.models = null; throw e; });
  }
  return state.models;
}

// Native inference is asynchronous, but parallel photos would compete for CPU/RAM.
async function serial(fn) {
  const result = state.tail.then(fn, fn);
  state.tail = result.catch(() => {});
  return result;
}

async function context(frame) {
  const hash = createHash('sha256').update(frame).digest('hex');
  let value = state.frames.get(hash);
  if (value) { state.frames.delete(hash); state.frames.set(hash, value); return value; }
  const { data, info } = await sharp(frame).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  value = { image: new RawImage(new Uint8Array(data), info.width, info.height, 3), frame, embeddings: null, inputs: null, detections: null };
  if (state.frames.size >= 2) state.frames.delete(state.frames.keys().next().value);
  state.frames.set(hash, value);
  return value;
}

const taxonomy = [
  [/cabinet/, 'Cabinet', 'Furniture'], [/chair/, 'Chair', 'Furniture'], [/sofa/, 'Sofa', 'Furniture'],
  [/table/, 'Table', 'Furniture'], [/lamp/, 'Lamp', 'Lighting'], [/framed|picture/, 'Framed picture', 'Decor'],
  [/shirt/, 'Shirt', 'Clothing'], [/hat|cap/, 'Hat', 'Clothing'], [/phone/, 'Phone', 'Tech'], [/television/, 'Television', 'Tech'], [/laptop/, 'Laptop', 'Tech'], [/bag/, 'Bag', 'Clothing'],
  [/vase/, 'Vase', 'Decor'], [/mug/, 'Mug', 'Kitchen'], [/book/, 'Book', 'Other'], [/shoes/, 'Shoes', 'Footwear'], [/clock/, 'Clock', 'Decor'],
];

function intersect(a, b) {
  return Math.max(0, Math.min(a.xmax, b.xmax) - Math.max(a.xmin, b.xmin))
    * Math.max(0, Math.min(a.ymax, b.ymax) - Math.max(a.ymin, b.ymin));
}
const area = b => Math.max(0, b.xmax - b.xmin) * Math.max(0, b.ymax - b.ymin);

async function maskRegion(ctx, box) {
  const { sam, processor } = await warmupVision();
  if (!ctx.embeddings) {
    ctx.inputs = await processor(ctx.image);
    ctx.embeddings = await sam.get_image_embeddings(ctx.inputs);
  }
  const { width, height } = ctx.image;
  const prompts = await processor(ctx.image, { input_boxes: [[[box.xmin, box.ymin, box.xmax, box.ymax]]] });
  const output = await sam({ ...ctx.inputs, ...prompts, ...ctx.embeddings });
  const masks = await processor.post_process_masks(output.pred_masks, ctx.inputs.original_sizes, ctx.inputs.reshaped_input_sizes);
  const scores = Array.from(output.iou_scores.data);
  const best = scores.indexOf(Math.max(...scores));
  if (scores[best] < .65) return null;
  const mask = masks[0].data.subarray(best * width * height, (best + 1) * width * height);
  const rgba = await sharp(ctx.frame).ensureAlpha().raw().toBuffer();
  const overlay = Buffer.alloc(width * height * 4);
  let left = width, top = height, right = 0, bottom = 0, count = 0;
  for (let i = 0; i < mask.length; i++) {
    const x = i % width, y = Math.floor(i / width);
    // Never let a decoder leak into a neighbouring product outside the supplied box.
    const on = mask[i] && x >= box.xmin - 2 && x <= box.xmax + 2 && y >= box.ymin - 2 && y <= box.ymax + 2;
    if (on) {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
      overlay[i * 4] = overlay[i * 4 + 1] = overlay[i * 4 + 2] = overlay[i * 4 + 3] = 255;
    }
    rgba[i * 4 + 3] = on ? 255 : 0;
    // Clear invisible RGB too: no background or people hidden in transparent pixels.
    if (!on) rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 0;
  }
  if (count < Math.max(200, area(box) * .06) || right <= left || bottom <= top) return null;
  const raw = { width, height, channels: 4 };
  const [cutout, maskPng] = await Promise.all([
    sharp(rgba, { raw }).extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
      .resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true }).webp({ lossless: true }).toBuffer(),
    sharp(overlay, { raw }).resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true }).png().toBuffer(),
  ]);
  return { imageUrl: `data:image/webp;base64,${cutout.toString('base64')}`, maskUrl: `data:image/png;base64,${maskPng.toString('base64')}`,
    bbox: { x: left / width, y: top / height, w: (right - left + 1) / width, h: (bottom - top + 1) / height } };
}

export async function scanGrounded(frame) {
  return serial(async () => {
    const { detector } = await warmupVision();
    const ctx = await context(frame);
    const { width, height } = ctx.image;
    if (!ctx.detections) {
      const room = await detector(ctx.image, [QUERY], { threshold: .24 });
      // A focused prompt catches handheld phones diluted by a long room query.
      const handheld = await detector(ctx.image, ['cell phone. smartphone.'], { threshold: .3 });
      const clothing = await detector(ctx.image, ['shirt.'], { threshold: .3 });
      const hats = await detector(ctx.image, ['hat.'], { threshold: .3 });
      ctx.detections = [...hats, ...clothing, ...handheld, ...room].sort((a, b) => b.score - a.score);
    }
    const people = ctx.detections.filter(d => /person/.test(d.label));
    const candidates = [];
    for (const d of ctx.detections) {
      if (/person/.test(d.label) || area(d.box) < width * height * .007) continue;
      const kind = taxonomy.find(([pattern]) => pattern.test(d.label));
      if (!kind) continue;
      // Held products naturally overlap a person; do not discard their detections.
      const handheld = /shirt|hat|cap|phone|mug|book|bag|laptop/.test(d.label);
      if (!handheld && people.some(p => intersect(d.box, p.box) / area(d.box) > .35)) continue;
      if (candidates.some(c => intersect(c.box, d.box) / Math.min(area(c.box), area(d.box)) > .8)) continue;
      candidates.push({ ...d, name: kind[1], category: kind[2] });
      if (candidates.length >= 8) break;
    }
    const results = [];
    for (const d of candidates) {
      const isolated = await maskRegion(ctx, d.box);
      if (isolated) results.push({ ...isolated, name: d.name, category: d.category, confidence: d.score });
    }
    return results;
  });
}

export async function segmentGrounded(frame, bbox) {
  return serial(async () => {
    const ctx = await context(frame);
    const { width, height } = ctx.image;
    const result = await maskRegion(ctx, { xmin: bbox.x * width, ymin: bbox.y * height, xmax: (bbox.x + bbox.w) * width, ymax: (bbox.y + bbox.h) * height });
    if (!result) throw new Error('No clear outline in that area. Try a tighter box or a closer photo.');
    return result;
  });
}
