import { pauseSale } from '@/lib/auctioneer';
import { ok, fail } from '@/lib/api';
export async function POST(req:Request,{params}:{params:Promise<{code:string}>}) {
  const body=await req.json().catch(()=>null);
  if(typeof body?.paused !== 'boolean') return fail('Choose pause or resume.');
  try { await pauseSale((await params).code,body.paused); return ok({paused:body.paused}); }
  catch { return fail('Could not change auction playback.',409); }
}
