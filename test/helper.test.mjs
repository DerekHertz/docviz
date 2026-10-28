// Helper contract tests. No CLI is called: CI has neither claude nor codex,
// so these cover auth, routing and prompt shape, not model output.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../helper/server.js';
import { cardPrompt, illustratePrompt, SCHEMAS } from '../helper/prompts.js';
import { setCodexRates, CODEX_RATES } from '../helper/providers.js';
import { rollSpend, spendToday, money } from '../extension/settings.js';

const TOKEN = 'TEST-CODE';
const EXT = 'chrome-extension://abcdefghijklmnop';
let server;
let base;

before(async () => {
  ({ server } = await startServer({ host: '127.0.0.1', port: 0, token: TOKEN, provider: 'auto', log: () => {} }));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const req = (path, { token, origin = EXT, method = 'GET', body } = {}) => fetch(base + path, {
  method,
  headers: { ...(token && { 'x-docviz-token': token }), ...(origin && { origin }), ...(body && { 'content-type': 'application/json' }) },
  body: body && JSON.stringify(body),
});

test('health reports pairing only with the right code', async () => {
  assert.deepEqual(await (await req('/v1/health')).json(), { ok: true, paired: false });
  const paired = await (await req('/v1/health', { token: TOKEN })).json();
  assert.equal(paired.paired, true);
  assert.equal(typeof paired.pictures, 'boolean');
});

test('refuses origins other than the extension', async () => {
  assert.equal((await req('/v1/health', { origin: 'https://evil.example' })).status, 403);
});

test('model routes need the pairing code', async () => {
  for (const route of ['cards', 'card', 'repair', 'explore', 'illustrate']) {
    assert.equal((await req(`/v1/${route}`, { method: 'POST', body: {} })).status, 401, route);
    assert.equal((await req(`/v1/${route}`, { method: 'POST', token: 'WRONG', body: {} })).status, 401, route);
  }
});

test('pictures need the code and a UUID', async () => {
  const id = '00000000-0000-0000-0000-000000000000';
  assert.equal((await req(`/v1/image/${id}`)).status, 401);
  assert.equal((await req(`/v1/image/${id}`, { token: TOKEN })).status, 404);
  assert.equal((await req('/v1/image/..%2F..%2Fetc%2Fpasswd', { token: TOKEN })).status, 404);
  assert.equal((await req(`/v1/image/${'-'.repeat(36)}`, { token: TOKEN })).status, 404);
});

test('illustrate without a card is a 400, not a crash', async () => {
  const res = await req('/v1/illustrate', { method: 'POST', token: TOKEN, body: {} });
  assert.equal(res.status, 400);
});

test('ELI5 depth reaches the prompt and every card asks for a picture brief', () => {
  const job = cardPrompt({ page: {}, section: { id: 's', heading: 'h', text: 't' }, prefs: { depth: 'eli5', style: 'strict' } });
  assert.match(job.system, /EXPLAIN LIKE I'M FIVE/);
  assert.match(job.system, /STYLE illustrated/, 'ELI5 keeps the analogy even for strict readers');
  assert.ok(SCHEMAS.card.required.includes('picture'));
});

test('the picture prompt carries the brief, caption and diagram', () => {
  const { prompt } = illustratePrompt({ card: { title: 'T', picture: 'BRIEF', caption: 'CAP', mermaid: 'flowchart TD' } });
  for (const part of ['BRIEF', 'CAP', 'flowchart TD', 'image_gen']) assert.ok(prompt.includes(part), part);
});

test('codex rates can be overridden, ignoring blanks', () => {
  const before = { ...CODEX_RATES };
  setCodexRates('2,,20');
  assert.deepEqual(CODEX_RATES, { ...before, input: 2, output: 20 });
  Object.assign(CODEX_RATES, before);
});

test('spend ledger rolls over at midnight and keeps the all-time total', () => {
  const yesterday = { day: '2000-01-01', today: 5, total: 9, calls: 3 };
  const s = rollSpend(yesterday, 0.25);
  assert.equal(s.today, 0.25);
  assert.equal(s.total, 9.25);
  assert.equal(s.calls, 4);
  assert.equal(spendToday(yesterday), 0);
  assert.equal(spendToday(s), 0.25);
  assert.equal(money(0.004, true), '~$0.004');
  assert.equal(money(1.5), '$1.50');
});
