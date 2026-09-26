import { ok, fail } from '@/lib/api';
import { supabaseServer } from '@/lib/supabase';
import { findSale } from '@/lib/sale';
import type { MessageResponse } from '@/lib/types';

type Body = { name?: string; text?: string };

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const body = (await request.json().catch(() => null)) as Body | null;
  const name = body?.name?.trim().slice(0, 40);
  const text = body?.text?.trim().slice(0, 280);
  if (!name || !text) return fail('name and text are required');

  let db;
  try {
    db = supabaseServer();
  } catch {
    return fail('database is not configured', 503);
  }

  const sale = await findSale(code);
  if (!sale) return fail('sale not found', 404);

  const { error } = await db.from('sale_messages').insert({ sale_id: sale.id, name, text });
  if (error) return fail(error.message, 500);
  return ok<MessageResponse>({ ok: true });
}
