import { POST as generate } from '@/app/api/object-image/route';
import { findSale, saleLots } from '@/lib/sale';
import { waitingPreviews, previewJobs } from '@/lib/waiting-previews';
import { ok, fail } from '@/lib/api';
export const maxDuration = 300;
export async function POST(req: Request, { params }: { params: Promise<{code:string}> }) {
  const {code} = await params;
  const sale = await findSale(code);
  if (!sale) return fail('Room not found',404);

  let job = previewJobs.get(sale.id);
  if (!job) {
    job = (async () => {
      for (const lot of await saleLots(sale.id)) {
        if (waitingPreviews.has(lot.id)) continue;
        if (!lot.image_url) throw new Error('Missing captured image');
        const result = await generate(new Request(new URL('/api/object-image',req.url), {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:lot.name,image:lot.image_url})}));
        const data = await result.json();
        if (!result.ok) throw new Error(data.error);
        if (waitingPreviews.size >= 100) waitingPreviews.delete(waitingPreviews.keys().next().value!);
        waitingPreviews.set(lot.id,data.imageUrl);
      }
    })();
    previewJobs.set(sale.id,job);
  }
  try { await job; return ok({ready:true}); }
  catch { previewJobs.delete(sale.id); return fail('Some previews could not be generated. Original photos are still available.',503); }
}
