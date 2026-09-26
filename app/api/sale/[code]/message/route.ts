import { ok, fail } from '@/lib/api';
import { db } from '@/lib/db';
import { findSale } from '@/lib/sale';
import type { MessageResponse } from '@/lib/types';

type Body = { name?: string; text?: string };

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const body = (await request.json().catch(() => null)) as Body | null;
  const name = body?.name?.trim().slice(0, 40);
  const text = body?.text?.trim().slice(0, 280);
  if (!name || !text) return fail('name and text are required');

  const sale = await findSale(code);
  if (!sale) return fail('sale not found', 404);

  try {
    await db().insertMessage({ sale_id: sale.id, name, text });
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'message failed', 500);
  }
  return ok<MessageResponse>({ ok: true });
}
