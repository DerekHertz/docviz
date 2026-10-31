// Protection domains a change touches (lab D1): Jev against plain text patterns, on the same
// real file changes from public repos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMAINS, cases, diffRequest, patternFlag } from '../lab/domains.js';
import * as jev from '../lab/experiments/domains-jev.js';
import * as patterns from '../lab/experiments/domains-patterns.js';

test('every change is asked about every domain; truth comes from its labels', () => {
  const all = cases();
  assert.equal(all.length, 20 * Object.keys(DOMAINS).length);
  const server = all.filter((c) => c.file === 'helper/server.js');
  assert.deepEqual(server.filter((c) => c.bad).map((c) => c.domain).sort(), ['access', 'network', 'processFs', 'secrets', 'untrusted']);
  assert.ok(all.filter((c) => c.file === 'extension/ledger.js').every((c) => !c.bad));
  assert.deepEqual(jev.cases().map((c) => c.id), patterns.cases().map((c) => c.id));
});

test('one Jev request per change asks all five domains, each with criteria', () => {
  const c = cases()[0];
  const { state, questions } = diffRequest(c);
  assert.equal(state.file, c.file);
  assert.match(state.change, /^```diff\n/);
  assert.deepEqual(Object.keys(questions).sort(), Object.keys(DOMAINS).sort());
  for (const q of Object.values(questions)) { assert.equal(q.type, 'noul'); assert.ok(q.criteria.true && q.criteria.false); }
});

test('the Jev version asks once per change, not once per domain', async () => {
  let calls = 0;
  const ask = async () => { calls++; return { answers: Object.fromEntries(Object.keys(DOMAINS).map((d, i) => [d, { noul: i / 10 }])), usage: { usd: 0.0001 } }; };
  const mine = cases().filter((c) => c.file === 'helper/jev.js');
  const run = jev.freshRun();
  const out = await Promise.all(mine.map((c) => jev.evaluate(c, { ask, run })));
  assert.equal(calls, 1);
  assert.deepEqual(out.map((r) => r.flag), Object.keys(DOMAINS).map((d, i) => i / 10));
  assert.equal(out.reduce((s, r) => s + r.usage.usd, 0), 0.0001, 'the one request is charged once');
});

test('patterns flag a domain when its pattern matches the changed lines, and cost nothing', async () => {
  assert.equal(patternFlag('secrets', '+const headers = { authorization: `Bearer ${key}` };'), 1);
  assert.equal(patternFlag('network', '+  setSeen(new Set(seen).add(i))'), 0);
  const r = await patterns.evaluate(cases().find((c) => c.file === 'helper/jev.js' && c.domain === 'network'), {});
  assert.deepEqual([r.flag, r.usage.usd], [1, 0]);
});
