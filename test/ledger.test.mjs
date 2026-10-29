// Cost logic that lives in the extension: attribution, the budget guard,
// ledger write ordering and the picture cache key. No browser needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCost, budgetRefusal, createLedger, pictureCacheKey } from '../extension/ledger.js';
import { httpError } from '../helper/providers.js';

const day = new Date().toLocaleDateString('en-CA');
const usage = (usd, extra = {}) => ({ usd, estimated: false, inputTokens: 10, outputTokens: 5, ...extra });

test('addCost sums calls on a card and splits a batch evenly', () => {
  let c = addCost(null, 'breakdown', usage(0.1), 2);
  c = addCost(c, 'syntax repair', usage(0.02, { estimated: true }));
  assert.equal(c.items.length, 2);
  assert.ok(Math.abs(c.usd - 0.07) < 1e-9);
  assert.equal(c.estimated, true);
  assert.match(c.items[0].what, /1\/2 of batch/);
  assert.equal(addCost(c, 'x', undefined), c);
});

test('budget refuses once today is spent, never on 0 or a new day', () => {
  const spent = { day, today: 2, total: 5, calls: 3 };
  assert.match(budgetRefusal({ budget: 2, spend: spent }), /budget is used up/);
  assert.equal(budgetRefusal({ budget: 3, spend: spent }), null);
  assert.equal(budgetRefusal({ budget: 0, spend: spent }), null, '0 = no cap');
  assert.equal(budgetRefusal({ budget: 2, spend: { ...spent, day: '2000-01-01' } }), null);
  assert.equal(budgetRefusal({ budget: 2, spend: null }), null);
});

test('ledger serializes writes so none are lost', async () => {
  let stored = null;
  const ledger = createLedger({
    load: async () => { await new Promise((r) => setTimeout(r, 5)); return stored; },
    save: async (v) => { stored = v; },
  });
  await Promise.all([0.1, 0.2, 0.3, 0.4].map((u) => ledger.record(usage(u))));
  await ledger.idle();
  assert.equal(stored.calls, 4);
  assert.ok(Math.abs(stored.today - 1) < 1e-9);
});

test('a failed ledger write does not stop later ones', async () => {
  let stored = null;
  let fail = true;
  const ledger = createLedger({
    load: async () => stored,
    save: async (v) => { if (fail) { fail = false; throw new Error('quota'); } stored = v; },
  });
  await assert.rejects(ledger.record(usage(0.1)), /quota/);
  await ledger.record(usage(0.2));
  assert.equal(stored.calls, 1);
  assert.ok(Math.abs(stored.today - 0.2) < 1e-9);
});

test('picture cache key follows the card text and ELI5, not the rest of the card', async () => {
  const spec = { title: 'T', picture: 'brief', mermaid: 'a' };
  const k = await pictureCacheKey(spec, false);
  assert.equal(await pictureCacheKey({ ...spec, mermaid: 'b' }, false), k);
  assert.notEqual(await pictureCacheKey({ ...spec, picture: 'other' }, false), k);
  assert.notEqual(await pictureCacheKey(spec, true), k);
  assert.match(k, /^p:[0-9a-f]{24}$/);
});

test('helper errors can carry the usage the CLI already spent', () => {
  const e = httpError(502, 'bad', usage(0.05));
  assert.equal(e.usage.usd, 0.05);
  assert.equal(httpError(502, 'bad').usage, undefined);
});
