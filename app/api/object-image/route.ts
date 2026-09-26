import { openai } from '@/lib/llm';
import { toFile } from 'openai';
import sharp from 'sharp';
import { scanGrounded } from '@/lib/grounded.mjs';
import { ok, fail } from '@/lib/api';
export const runtime = 'nodejs';
export const maxDuration = 180;
export async function POST(req: Request) {
  try {
    const { image, name } = await req.json();
    if (typeof image !== 'string' || image.length > 8_000_000 || !/^data:image\/(webp|png|jpeg);base64,/.test(image) || typeof name !== 'string' || name.length > 80) return fail('An item image and name are required.');
    const input = await sharp(Buffer.from(image.split(',')[1], 'base64'), { limitInputPixels: 4_000_000 }).png().toBuffer();
    const result = await openai().images.edit({ model: 'gpt-image-2', image: await toFile(input, 'item.png', { type: 'image/png' }),
      prompt: `Create one premium ecommerce studio packshot of the ${name} shown in the reference. The reference may be an incomplete cutout: reconstruct the complete standalone object, including its silhouette and missing lower portions. Match visible color, pattern, proportions, materials and distinctive details; do not substitute a different product. For shirts: show the entire unworn garment neatly shaped, with sleeves and hem, no body or mannequin. For hats: show the complete crown and brim, no head. For furniture: include the whole item and its legs. Remove every person, hand, skin fragment, room detail and unrelated object. Center one object at a natural three-quarter product angle, entirely inside the canvas with 12 percent breathing room on every side. Fully transparent background with a clean alpha channel. Soft even studio lighting, crisp natural edges, realistic material texture. No ground plane or cast shadow. No floor line, scenery, labels, captions, added logos, framing or decorative props. The result is an AI product visualization, not documentary evidence of hidden details.`,
      background: 'transparent', output_format: 'png', size: '1024x1024', quality: 'medium', n: 1 }, { timeout: 150000, maxRetries: 0 });
    if (!result.data?.[0]?.b64_json) throw new Error('No image returned');
    const generated = await sharp(Buffer.from(result.data[0].b64_json, 'base64')).resize(900,900, { fit: 'inside' }).png().toBuffer();
    const stats = await sharp(generated).stats();
    if (stats.isOpaque) {
      const candidates = await scanGrounded(generated);
      const isolated = candidates.find(item => item.name.toLowerCase() === name.toLowerCase()) ?? candidates[0];
      if (!isolated) throw new Error('Could not isolate generated object');
      return ok({ imageUrl: isolated.imageUrl });
    }
    const output = await sharp(generated).resize(600,600, {fit: 'inside'}).webp({lossless:true}).toBuffer();
    return ok({ imageUrl: `data:image/webp;base64,${output.toString('base64')}` });
  } catch { return fail('Image generation unavailable. Your original image is kept. Try again.', 503); }
}
