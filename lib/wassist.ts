// WhatsApp follow-up through Wassist. Optional: with no API key the app behaves
// identically and simply reports what it would have sent, so the UI can show it.
//
// Docs: https://docs.wassist.app/api-reference/introduction
// Auth is an X-API-Key header; a conversation can be opened and the first
// message delivered in a single POST /conversations/ call.

const BASE = process.env.WASSIST_API_BASE ?? 'https://backend.wassist.app/api/v1';

export type WhatsAppCta = {
  /** Recipient in international format, e.g. +447700900123. */
  to: string;
  body: string;
  buttonText: string;
  url: string;
  imageUrl?: string;
};

export type NotifyResult = {
  sent: boolean;
  /** What was, or would have been, delivered. Always present so the UI can show it. */
  preview: { to: string; body: string; buttonText: string; url: string };
  reason?: string;
};

export function wassistReady(): boolean {
  return Boolean(process.env.WASSIST_API_KEY);
}

/** Opens a conversation if needed and sends a message with a tappable button. */
export async function sendCta(msg: WhatsAppCta): Promise<NotifyResult> {
  const preview = { to: msg.to, body: msg.body, buttonText: msg.buttonText, url: msg.url };
  const apiKey = process.env.WASSIST_API_KEY;
  if (!apiKey) return { sent: false, preview, reason: 'WASSIST_API_KEY is not set' };

  try {
    const res = await fetch(`${BASE}/conversations/`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toNumber: msg.to,
        phoneNumber: process.env.WASSIST_FROM_NUMBER,
        agentId: process.env.WASSIST_AGENT_ID,
        message: {
          type: 'cta',
          cta: {
            body: msg.body,
            buttonText: msg.buttonText,
            url: msg.url,
            ...(msg.imageUrl ? { image: { url: msg.imageUrl } } : {}),
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return { sent: false, preview, reason: `Wassist responded ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    return { sent: true, preview };
  } catch (e) {
    return { sent: false, preview, reason: e instanceof Error ? e.message : 'Wassist request failed' };
  }
}

/** The message a winning bidder gets: what they won, for how much, and how to pay. */
export function winnerMessage(opts: {
  buyer: string;
  lotName: string;
  amount: number;
  checkoutUrl: string | null;
  imageUrl?: string;
  fallbackUrl: string;
}): WhatsAppCta | null {
  const url = opts.checkoutUrl ?? opts.fallbackUrl;
  if (!url) return null;
  const price = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(opts.amount);
  return {
    to: '',
    body: `${opts.buyer}, you won the ${opts.lotName.toLowerCase()} for ${price}. Tap below to pay and arrange collection.`,
    buttonText: 'Pay now',
    url,
    imageUrl: opts.imageUrl,
  };
}
