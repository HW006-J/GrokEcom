import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-sonnet-5';

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

// Force a strict JSON object out of Claude by making it call a single tool.
export async function structured<T>(opts: {
  system: string;
  content: Anthropic.MessageParam['content'];
  schema: Record<string, unknown>;
  toolName: string;
  maxTokens?: number;
}): Promise<T> {
  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 400,
    system: opts.system,
    messages: [{ role: 'user', content: opts.content }],
    tools: [
      {
        name: opts.toolName,
        description: 'Return the structured result.',
        input_schema: { type: 'object', ...opts.schema } as Anthropic.Tool['input_schema'],
      },
    ],
    tool_choice: { type: 'tool', name: opts.toolName },
  });
  const block = res.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') throw new Error('Claude returned no tool_use block');
  return block.input as T;
}
