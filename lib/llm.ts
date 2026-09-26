import OpenAI from 'openai';

export const MODEL = process.env.OPENAI_MODEL ?? 'gpt-5-mini';
const FALLBACK_MODEL = 'gpt-4.1-mini';

let client: OpenAI | null = null;
export function openai(): OpenAI {
  if (!client) client = new OpenAI();
  return client;
}

export type UserContent = OpenAI.Chat.Completions.ChatCompletionContentPart[] | string;

export function imagePart(base64: string, mediaType: string): OpenAI.Chat.Completions.ChatCompletionContentPartImage {
  return { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}`, detail: 'low' } };
}

function isModelRejected(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /model|does not exist|not found|unsupported/i.test(msg) && !/rate limit/i.test(msg);
}

// Strict JSON object via json_schema structured output.
export async function structured<T>(opts: {
  system: string;
  content: UserContent;
  schema: Record<string, unknown>;
  name: string;
  maxTokens?: number;
}): Promise<T> {
  const run = async (model: string) => {
    // gpt-5 family spends completion tokens on reasoning first; at minimal effort a 60-token
    // budget returns empty content, so force minimal reasoning and keep caps generous.
    const reasoning = /^(gpt-5|o\d)/.test(model) ? { reasoning_effort: 'minimal' as const } : {};
    const res = await openai().chat.completions.create({
      model,
      ...reasoning,
      max_completion_tokens: opts.maxTokens ?? 600,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.content },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: opts.name,
          strict: true,
          schema: { type: 'object', additionalProperties: false, ...opts.schema },
        },
      },
    });
    const text = res.choices[0]?.message?.content;
    if (!text) throw new Error('OpenAI returned no content');
    return JSON.parse(text) as T;
  };
  try {
    return await run(MODEL);
  } catch (e) {
    if (MODEL !== FALLBACK_MODEL && isModelRejected(e)) {
      console.warn(`OpenAI rejected model ${MODEL}, falling back to ${FALLBACK_MODEL}:`, e instanceof Error ? e.message : e);
      return run(FALLBACK_MODEL);
    }
    throw e;
  }
}
