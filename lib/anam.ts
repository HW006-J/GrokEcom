// Anam session token in custom-LLM mode (we drive speech with talk(); Anam's brain is disabled).
export async function createAnamSessionToken(): Promise<string> {
  const apiKey = process.env.ANAM_API_KEY;
  if (!apiKey) throw new Error('ANAM_API_KEY is not set');
  const res = await fetch('https://api.anam.ai/v1/auth/session-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      personaConfig: {
        name: 'Cara',
        avatarId: process.env.ANAM_AVATAR_ID ?? '30fa96d0-26c4-4e55-94a0-517025942e18',
        avatarModel: 'cara-4',
        voiceId: process.env.ANAM_VOICE_ID ?? '6bfbe25a-979d-40f3-a92b-5394170af54b',
        llmId: 'CUSTOMER_CLIENT_V1',
      },
    }),
  });
  if (!res.ok) throw new Error(`Anam session token failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { sessionToken?: string };
  if (!json.sessionToken) throw new Error('Anam response had no sessionToken');
  return json.sessionToken;
}
