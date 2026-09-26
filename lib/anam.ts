// Anam session token, minted server-side only. The key never reaches the browser.
// Custom-LLM mode: Anam's own brain is off and we drive every line with talk().
const API_BASE = process.env.ANAM_API_BASE ?? 'https://api.anam.ai';

export async function createAnamSessionToken(): Promise<string> {
  const apiKey = process.env.ANAM_API_KEY;
  if (!apiKey) throw new Error('ANAM_API_KEY is not set');

  const res = await fetch(`${API_BASE}/v1/auth/session-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      personaConfig: {
        name: process.env.ANAM_PERSONA_NAME ?? 'Martin',
        avatarId: process.env.ANAM_AVATAR_ID ?? '91e9e4d4-f0a2-49da-bad9-1d9bf77e62e7',
        voiceId: process.env.ANAM_VOICE_ID ?? '91b4ce0f-4fc0-11f1-84b0-52bacf74fa75',
        // Required whenever personaConfig is inline, or the token is rejected as legacy.
        llmId: 'CUSTOMER_CLIENT_V1',
      },
    }),
  });

  if (!res.ok) throw new Error(`Anam session token failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { sessionToken?: string };
  if (!json.sessionToken) throw new Error('Anam response had no sessionToken');
  return json.sessionToken;
}
