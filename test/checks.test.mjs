// The step check (lab C3, adopted): does a step's label match its linked code?
// One definition, used by `docviz pr` and tested by the lab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepRequest, decideStep, checkSteps, ADOPTED } from '../helper/checks.js';
import { decide } from '../lab/metrics.js';
import * as two from '../lab/experiments/step-matches-two.js';

test('the adopted cutoffs are the ones the lab adopted', () => {
  assert.deepEqual(ADOPTED, { supportedAt: 0.6, contradictedAt: 0.5 });
  assert.equal(two.meta.bar.supportedAt, ADOPTED.supportedAt);
  assert.equal(two.meta.bar.contradictedAt, ADOPTED.contradictedAt);
});

test('the lab asks exactly what docviz pr asks', () => {
  const c = two.cases()[0];
  assert.deepEqual(two.request(c), stepRequest(c.label, c.code));
});

test('a contradiction flags, every claim shown passes, anything else is review; the lab agrees', () => {
  const cases = [[0.9, 0.1, 'pass'], [0.9, 0.6, 'flag'], [0.55, 0.1, 'review'], [0.6, 0.49, 'pass'], [0.1, 0.5, 'flag']];
  for (const [prob, probContra, want] of cases) {
    assert.equal(decideStep({ prob, probContra }), want, `${prob}/${probContra}`);
    assert.equal(decide({ kind: 'two' }, { prob, probContra }, ADOPTED), want);
  }
});

test('checkSteps asks once per step with all its code, and keeps each step’s cost', async () => {
  const asked = [];
  const ask = async (req) => {
    asked.push(req);
    const fine = req.state.label === 'Pick forums';
    return { answers: { supported: { noul: fine ? 0.9 : 0.2 }, contradicted: { noul: fine ? 0.1 : 0.8 } }, usage: { provider: 'jev', usd: 0.00002, estimated: false } };
  };
  const steps = [
    { id: 'pick', label: 'Pick forums', cuts: [{ path: 'a.js', start: 1, end: 2, text: 'function pick() {}' }, { path: 'b.js', start: 5, end: 6, text: 'pick();' }] },
    { id: 'post', label: 'Post the reply', cuts: [{ path: 'c.js', start: 1, end: 1, text: 'function other() {}' }] },
  ];
  const out = await checkSteps(steps, { ask });
  assert.deepEqual(out.map((r) => r.verdict), ['pass', 'flag']);
  assert.match(asked[0].state.code, /\/\/ a\.js:1-2\nfunction pick\(\) \{\}/);
  assert.match(asked[0].state.code, /\/\/ b\.js:5-6\npick\(\);/);
  assert.equal(out[0].usage.usd, 0.00002);
});

test('a failed check marks that step unchecked and never fails the rest', async () => {
  const ask = async (req) => {
    if (req.state.label === 'boom') throw Object.assign(new Error('Jev 500'), { usage: { provider: 'jev', usd: 0, estimated: false } });
    return { answers: { supported: { noul: 0.9 }, contradicted: { noul: 0.1 } }, usage: { usd: 0.00001, estimated: false } };
  };
  const steps = [{ id: 'a', label: 'boom', cuts: [{ path: 'x', start: 1, end: 1, text: 'x' }] }, { id: 'b', label: 'ok', cuts: [{ path: 'y', start: 1, end: 1, text: 'y' }] }];
  const out = await checkSteps(steps, { ask });
  assert.equal(out[0].verdict, 'unchecked');
  assert.match(out[0].error, /Jev 500/);
  assert.equal(out[1].verdict, 'pass');
});
