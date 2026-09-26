import { endSale } from '@/lib/auctioneer';
import { ok, fail } from '@/lib/api';
export async function POST(_req:Request,{params}:{params:Promise<{code:string}>}) {
  try { await endSale((await params).code); return ok({ended:true}); }
  catch { return fail('Could not end the auction. Please retry.',503); }
}
