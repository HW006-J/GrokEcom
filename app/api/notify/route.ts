import { NextRequest } from 'next/server';
import { ok, fail } from '@/lib/api';
import { sendCta, winnerMessage, wassistReady } from '@/lib/wassist';

/**
 * Tell a winning bidder on WhatsApp what they won and how to pay.
 * Works without a Wassist key: it returns the exact message it would send,
 * so the interface can show it rather than pretending it went out.
 */
export async function POST(req: NextRequest) {
  let body: {
    phone?: string;
    buyer?: string;
    lotName?: string;
    amount?: number;
    checkoutUrl?: string | null;
    imageUrl?: string;
    saleUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return fail('Body must be JSON');
  }

  if (!body.buyer || !body.lotName || typeof body.amount !== 'number') {
    return fail('buyer, lotName and amount are required');
  }

  const msg = winnerMessage({
    buyer: body.buyer,
    lotName: body.lotName,
    amount: body.amount,
    checkoutUrl: body.checkoutUrl ?? null,
    imageUrl: body.imageUrl,
    fallbackUrl: body.saleUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? '',
  });
  if (!msg) return fail('Nothing to link to: no checkout url and no sale url');

  // No number means the caller only wants the message to show on screen.
  if (!body.phone) {
    return ok({ sent: false, preview: { ...msg, to: '' }, reason: 'No phone number given' });
  }

  return ok(await sendCta({ ...msg, to: body.phone }));
}

export async function GET() {
  return ok({ ready: wassistReady() });
}
