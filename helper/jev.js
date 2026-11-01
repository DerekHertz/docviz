// Jev (TypeSafe's System One model): typed questions about a state, answered with
// probabilities. It judges, never writes, so docviz uses it to check cards. Cost is exact:
// input tokens (images included) at the published rate; output tokens are free.
import { httpError } from './providers.js';

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-1.14.0';
export const JEV_RATE = 0.042; // $ per million input tokens

export const jevUsd = (u) => ((u?.input_tokens || 0) * JEV_RATE) / 1e6;

const usageOf = (u, model) => ({
  provider: 'jev', model, inputTokens: u?.input_tokens || 0, outputTokens: u?.output_tokens || 0, usd: jevUsd(u), estimated: false,
});

/**
 * `images` maps a placeholder (put it in the state or a question) to PNG bytes.
 * Images and box questions are experimental at TypeSafe and need their opt-in header.
 */
export async function askJev({ state, questions, images, model = JEV_MODEL, key = process.env.TYPESAFE_API_KEY, fetch: f = fetch, timeoutMs = 60_000 }) {
  if (!key) throw httpError(503, 'Jev needs TYPESAFE_API_KEY', usageOf(null, model));
  const body = { model, state, questions };
  if (images && Object.keys(images).length) {
    body.assets = Object.fromEntries(Object.entries(images).map(([ref, png]) => [ref, { type: 'image', format: 'png', data_base64: Buffer.from(png).toString('base64') }]));
  }
  const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  if (body.assets || Object.values(questions).some((q) => q.type === 'box')) headers['TypeSafe-Danger-Zone-Images'] = 'true';
  const res = await f(JEV_URL, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = json.detail;
    throw httpError(res.status, `Jev ${res.status}: ${typeof d === 'string' ? d : d?.message || 'request failed'}`, usageOf(null, model));
  }
  return { answers: json.answers || {}, usage: usageOf(json.usage, json.model || model) };
}
