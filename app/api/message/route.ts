import { ok, fail } from '@/lib/api';
import { supabaseServer } from '@/lib/supabase';
import type { MessageRequest, MessageResponse } from '@/lib/types';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as MessageRequest | null;
  if (!body?.showId || !body.name?.trim() || !body.text?.trim()) {
    return fail('showId, name and text are required');
  }
  const db = supabaseServer();
  const { error } = await db.from('messages').insert({
    show_id: body.showId,
    name: body.name.trim().slice(0, 40),
    text: body.text.trim().slice(0, 280),
  });
  if (error) return fail(error.message, 500);
  return ok<MessageResponse>({ ok: true });
}
