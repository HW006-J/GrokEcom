import { findSale } from '@/lib/sale';
import { setStartsAt } from '@/lib/sale-timing';
import { ok, fail } from '@/lib/api';

/** Schedule the start: POST { inSeconds } → everyone in the room sees the same countdown. */
export async function POST(req:Request,{params}:{params:Promise<{code:string}>}) {
  const body = await req.json().catch(()=>null);
  const inSeconds = Number(body?.inSeconds);
  if (![0,30,60,120,300].includes(inSeconds)) return fail('Choose now, 30 seconds, 1, 2 or 5 minutes.');
  const sale = await findSale((await params).code);
  if (!sale) return fail('Room not found',404);
  if (sale.phase !== 'idle') return fail('The auction has already started.',409);
  const startsAt = new Date(Date.now() + inSeconds * 1000).toISOString();
  setStartsAt(sale.id, startsAt);
  return ok({ startsAt });
}
