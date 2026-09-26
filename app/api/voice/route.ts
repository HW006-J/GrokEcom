import { fail } from '@/lib/api';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const body = await req.json().catch(()=>null);
  if (typeof body?.text !== 'string' || !body.text.trim() || body.text.length > 1800) return fail('Provide a short auctioneer line.');
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return fail('ElevenLabs voice is not configured.',503);
  try {
    const voice = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=mp3_44100_128`, {
      method:'POST', headers:{'xi-api-key':key,'Content-Type':'application/json'},
      body:JSON.stringify({text:body.text,model_id:'eleven_flash_v2_5'}),
      signal:AbortSignal.any([req.signal,AbortSignal.timeout(25000)]),
    });
    if(!response.ok) return fail(response.status===429 ? 'Voice limit reached. Please retry shortly.' : 'Voice service unavailable. Please retry.',response.status===429?429:502);
    return new Response(response.body,{headers:{'Content-Type':'audio/mpeg','Cache-Control':'no-store'}});
  } catch {return fail('Voice request failed. Please retry.',502);}
}
