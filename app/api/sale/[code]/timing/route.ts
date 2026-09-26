import { findSale } from '@/lib/sale';
import { setStartsAt } from '@/lib/sale-timing';
import { ok, fail } from '@/lib/api';

/** Schedule the start: POST { inSeconds } → everyone in the room sees the same countdown. */
export async function POST(req:Request,{params}:{params:Promise<{code:string}>}) {
  const body = await req.json().catch(()=>null);
  const inSeconds = body?.inSeconds;
  if (typeof inSeconds !== 'number' || !Number.isInteger(inSeconds) || inSeconds < 0 || inSeconds > 3600) return fail('Choose a delay from 0 to 3,600 seconds.');
  const sale = await findSale((await params).code);
  if (!sale) return fail('Room not found',404);
  if (sale.phase !== 'idle') return fail('The auction has already started.',409);
  const startsAt = new Date(Date.now() + inSeconds * 1000).toISOString();
  setStartsAt(sale.id, startsAt);
  return ok({ startsAt });
}
