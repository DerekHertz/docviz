// Jev client: request shape, exact cost, and errors that still say what they spent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askJev, jevUsd, JEV_RATE } from '../helper/jev.js';

const fakeFetch = (status, body) => {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return { status, ok: status < 300, json: async () => body }; };
  return Object.assign(fn, { calls });
};

test('cost is exact: input tokens at the published rate, output free', () => {
  assert.equal(JEV_RATE, 0.042);
  assert.equal(jevUsd({ input_tokens: 1_000_000, output_tokens: 999 }), 0.042);
});

test('a text request goes to systemone with the key and no image header', async () => {
  const f = fakeFetch(200, { answers: { q: { type: 'noul', noul: 0.8 } }, usage: { input_tokens: 100, output_tokens: 5 } });
  const r = await askJev({ state: 'x', questions: { q: { type: 'noul', instructions: 'ok?' } }, key: 'k', fetch: f });
  const { url, init } = f.calls[0];
  assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(init.headers.authorization, 'Bearer k');
  assert.equal(init.headers['TypeSafe-Danger-Zone-Images'], undefined);
  assert.equal(JSON.parse(init.body).model, 'jev-1.14.0');
  assert.equal(r.answers.q.noul, 0.8);
  assert.deepEqual(r.usage, { provider: 'jev', model: 'jev-1.14.0', inputTokens: 100, outputTokens: 5, usd: 100 * 0.042 / 1e6, estimated: false });
});

test('images and box questions turn on the image header and send base64 assets', async () => {
  const f = fakeFetch(200, { answers: {}, usage: { input_tokens: 1, output_tokens: 0 } });
  await askJev({ state: 'see img_1', questions: { q: { type: 'noul', instructions: 'x' } }, images: { img_1: Buffer.from('png') }, key: 'k', fetch: f });
  const { init } = f.calls[0];
  assert.equal(init.headers['TypeSafe-Danger-Zone-Images'], 'true');
  assert.deepEqual(JSON.parse(init.body).assets, { img_1: { type: 'image', format: 'png', data_base64: Buffer.from('png').toString('base64') } });

  const g = fakeFetch(200, { answers: {}, usage: { input_tokens: 1, output_tokens: 0 } });
  await askJev({ state: 's', questions: { b: { type: 'box', instructions: 'x' } }, key: 'k', fetch: g });
  assert.equal(g.calls[0].init.headers['TypeSafe-Danger-Zone-Images'], 'true');
});

test('the key comes from TYPESAFE_API_KEY, and a missing key fails before any request', async () => {
  const f = fakeFetch(200, {});
  const saved = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  try {
    await assert.rejects(askJev({ state: 's', questions: { q: { type: 'noul' } }, fetch: f }), /TYPESAFE_API_KEY/);
    assert.equal(f.calls.length, 0);
    process.env.TYPESAFE_API_KEY = 'env-key';
    const g = fakeFetch(200, { answers: {} });
    await askJev({ state: 's', questions: { q: { type: 'noul' } }, fetch: g });
    assert.equal(g.calls[0].init.headers.authorization, 'Bearer env-key');
  } finally {
    if (saved === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = saved;
  }
});

test('an API error carries its status and message, with zero spend', async () => {
  const f = fakeFetch(400, { detail: { error_type: 'api_usage_error', message: 'Invalid image dimensions.' } });
  const e = await askJev({ state: 's', questions: { q: { type: 'noul' } }, key: 'k', fetch: f }).catch((x) => x);
  assert.equal(e.status, 400);
  assert.match(e.message, /Invalid image dimensions/);
  assert.equal(e.usage.usd, 0);
});
