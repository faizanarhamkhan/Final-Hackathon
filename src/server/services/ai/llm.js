import { config } from '../../config.js';

export const aiConfigured = () => !!config.ai.apiKey;

export class AiUnavailable extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
  }
}

/**
 * Calls any OpenAI-compatible /chat/completions endpoint (Groq, Gemini, OpenRouter, OpenAI...).
 * The key never leaves the server. `signal` carries the overall 15 s budget of the request.
 */
export async function chatCompletion({ messages, tools, json = false, signal, temperature = 0.2 }) {
  if (!aiConfigured()) throw new AiUnavailable('AI_API_KEY is not set');
  const body = { model: config.ai.model, messages, temperature };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  if (json) body.response_format = { type: 'json_object' };
  let res;
  try {
    res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.ai.apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    throw new AiUnavailable(e.name === 'AbortError' || e.name === 'TimeoutError' ? 'AI provider timed out' : `AI provider unreachable: ${e.message}`, e);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new AiUnavailable(`AI provider returned ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const message = data?.choices?.[0]?.message;
  if (!message) throw new AiUnavailable('AI provider returned no message');
  return message;
}

export function deadline(ms = config.ai.timeoutMs) {
  return AbortSignal.timeout(ms);
}
