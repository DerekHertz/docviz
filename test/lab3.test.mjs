// Three-way lab experiments: truth can be good / broken / can't tell, and the evaluator can
// pass, flag, or send a case to review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, judge3, applyTruth } from '../lab/metrics.js';
import * as bands from '../lab/experiments/step-matches-code.js';
import * as choice from '../lab/experiments/step-matches-choice.js';
import * as two from '../lab/experiments/step-matches-two.js';

test('a yes/no answer passes above passAt, flags below flagAt, and reviews in between', () => {
  const rule = { kind: 'bands' };
  const bar = { passAt: 0.7, flagAt: 0.3 };
  assert.equal(decide(rule, { prob: 0.8 }, bar), 'pass');
  assert.equal(decide(rule, { prob: 0.7 }, bar), 'pass');
  assert.equal(decide(rule, { prob: 0.2 }, bar), 'flag');
  assert.equal(decide(rule, { prob: 0.5 }, bar), 'review');
  assert.equal(decide(rule, { error: 'x' }, bar), null);
});

test('a three-option answer maps each option, and low confidence goes to review', () => {
  const rule = { kind: 'choice', map: { matches: 'pass', differs: 'flag', cantTell: 'review' } };
  assert.equal(decide(rule, { choice: 'differs', confidence: 0.9 }, {}), 'flag');
  assert.equal(decide(rule, { choice: 'cantTell', confidence: 0.9 }, {}), 'review');
  assert.equal(decide(rule, { choice: 'matches', confidence: 0.3 }, { minConfidence: 0.5 }), 'review');
  assert.equal(decide(rule, { choice: 'matches', confidence: 0.3 }, {}), 'pass');
});

const k = (id, truth, verdict, extra = {}) => ({ id, truth, verdict, card: id, usd: 0.00001, ...extra });

test('judge3 scores what slips through, what is wrongly flagged, what is reviewed, and unclear handling', () => {
  const run = [
    k('g1', 'good', 'pass'), k('g2', 'good', 'pass'), k('g3', 'good', 'flag'), k('g4', 'good', 'review'),
    k('b1', 'bad', 'flag'), k('b2', 'bad', 'review'), k('b3', 'bad', 'pass'), k('b4', 'bad', 'flag'),
    k('u1', 'unclear', 'review'), k('u2', 'unclear', 'pass'), k('u3', 'unclear', 'flag'), k('u4', 'unclear', 'review'),
  ];
  const r = judge3(run, { letThrough: 0.1, wronglyFlagged: 0.1, clearReview: 0.25, unclearPassed: 0.25, costPerCard: 1 });
  assert.equal(r.letThrough, 0.25);
  assert.equal(r.wronglyFlagged, 0.25);
  assert.equal(r.clearReview, 0.25);
  assert.equal(r.unclearPassed, 0.25);
  assert.equal(r.unclearHeld, 0.5);
  assert.equal(r.decidedAccuracy, 4 / 6);
  assert.equal(r.pass, false);
  assert.ok(r.misses.some((m) => /let through/.test(m)));
  assert.ok(r.misses.some((m) => /wrongly flagged/.test(m)));
  assert.ok(!r.misses.some((m) => /review/.test(m)), 'review rate is at the bar');
});

test('judge3 fails any injection that passes, and too-small runs', () => {
  const bar = { letThrough: 1, wronglyFlagged: 1, clearReview: 1, unclearPassed: 1, costPerCard: 1 };
  const leak = judge3([k('g', 'good', 'pass'), k('b', 'bad', 'flag'), k('u', 'unclear', 'review'), k('i', 'bad', 'pass', { injection: true })], bar);
  assert.ok(leak.misses.some((m) => /injection/.test(m)));
  assert.ok(judge3([k('g', 'good', 'pass')], bar).misses.some((m) => /too few/.test(m)));
});

test('your labels override the experiment: good, broken or can’t tell (old true/false still read)', () => {
  const cases = [{ id: 'a', truth: 'good', bad: false }, { id: 'b', truth: 'bad', bad: true }, { id: 'c', truth: 'good', bad: false }];
  const out = applyTruth(cases, { a: 'unclear', b: false, c: 'bad' });
  assert.deepEqual(out.map((x) => [x.truth, x.bad, !!x.overridden]), [['unclear', null, true], ['good', false, true], ['bad', true, true]]);
});

test('both C3 variants share the same cases, including can’t-tell ones', () => {
  const a = bands.cases();
  const b = choice.cases();
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id));
  const unclear = a.filter((x) => x.truth === 'unclear' && !x.heldOut);
  assert.equal(unclear.length, 16);
  for (const u of unclear) { assert.equal(u.bad, null); assert.equal(u.mutation, 'unclear'); }
  assert.equal(bands.meta.mode, 'three-way');
  assert.equal(choice.meta.mode, 'three-way');
});

test('the three-option question names options by meaning, not yes/no, and defines each', () => {
  const { questions } = choice.request(choice.cases()[0]);
  const q = questions.matches;
  assert.equal(q.type, 'choice');
  assert.deepEqual(Object.keys(q.criteria).sort(), ['cantTell', 'differs', 'matches']);
  for (const v of Object.values(q.criteria)) assert.ok(v.length > 20);
  assert.ok(!Object.keys(q.criteria).some((key) => /^(yes|no)$/i.test(key)));
});

test('the three-option evaluator turns its answer into a flag the meter and drift can use', async () => {
  const ask = async () => ({ answers: { matches: { type: 'choice', choice: 'cantTell', probabilities: { matches: 0.3, differs: 0.2, cantTell: 0.5 }, confidence: 0.1 } }, usage: { usd: 0 } });
  const r = await choice.evaluate(choice.cases()[0], { ask });
  assert.equal(r.choice, 'cantTell');
  assert.equal(r.flag, 0.7);
  assert.equal(r.confidence, 0.1);
  assert.deepEqual(r.probabilities, { matches: 0.3, differs: 0.2, cantTell: 0.5 });
});

test('two questions: contradicted flags, fully supported passes, anything else is review', () => {
  const rule = { kind: 'two' };
  const bar = { supportedAt: 0.7, contradictedAt: 0.5 };
  assert.equal(decide(rule, { prob: 0.9, probContra: 0.1 }, bar), 'pass');
  assert.equal(decide(rule, { prob: 0.9, probContra: 0.6 }, bar), 'flag', 'a contradiction wins');
  assert.equal(decide(rule, { prob: 0.4, probContra: 0.1 }, bar), 'review', 'not contradicted, not shown either');
  assert.equal(decide(rule, { prob: 0.2, probContra: 0.8 }, bar), 'flag');
  assert.equal(decide(rule, { prob: 0.9 }, bar), null);
});

test('held-out can’t-tell cases are scored on their own, and the bar uses them', () => {
  const k2 = (id, truth, verdict, heldOut) => ({ id, truth, verdict, heldOut, card: id, usd: 0 });
  const run = [
    k2('g', 'good', 'pass'), k2('b', 'bad', 'flag'),
    k2('u1', 'unclear', 'pass'), k2('u2', 'unclear', 'pass'),
    k2('h1', 'unclear', 'review', true), k2('h2', 'unclear', 'review', true),
  ];
  const r = judge3(run, { letThrough: 1, wronglyFlagged: 1, clearReview: 1, unclearPassed: 0.25, costPerCard: 1 });
  assert.equal(r.unclearPassed, 1, 'tuning set');
  assert.equal(r.heldOut.unclearPassed, 0);
  assert.ok(!r.misses.some((m) => /can't-tell/.test(m)), 'the bar is judged on held-out cases');
  assert.equal(r.counts.heldOut, 2);
});

test('every C3 version has 16 held-out can’t-tell cases with their own labels', () => {
  const all = two.cases();
  const held = all.filter((x) => x.heldOut);
  assert.equal(held.length, 16);
  for (const h of held) assert.equal(h.truth, 'unclear');
  const tuning = new Set(all.filter((x) => x.mutation === 'unclear').map((x) => x.label));
  for (const h of held) assert.ok(!tuning.has(h.label), h.id);
  assert.deepEqual(all.map((x) => x.id), choice.cases().map((x) => x.id));
});

test('the two-question version asks “is every claim shown” and “is anything contradicted”, each with criteria', async () => {
  const { questions } = two.request(two.cases()[0]);
  assert.deepEqual(Object.keys(questions).sort(), ['contradicted', 'supported']);
  for (const q of Object.values(questions)) { assert.equal(q.type, 'noul'); assert.ok(q.criteria.true && q.criteria.false); }
  const ask = async () => ({ answers: { supported: { type: 'noul', noul: 0.4 }, contradicted: { type: 'noul', noul: 0.1 } }, usage: { usd: 0 } });
  const r = await two.evaluate(two.cases()[0], { ask });
  assert.deepEqual([r.prob, r.probContra, r.flag], [0.4, 0.1, 0.6]);
  assert.equal(two.meta.decide.kind, 'two');
});

test('three-way repeatability counts verdicts that changed since the previous run', () => {
  const bar = { letThrough: 1, wronglyFlagged: 1, clearReview: 1, unclearPassed: 1, costPerCard: 1, changed: 0.05 };
  const run = [k('g', 'good', 'pass', { flag: 0.1 }), k('b', 'bad', 'flag', { flag: 0.9 }), k('u', 'unclear', 'review', { flag: 0.5 }), k('u2', 'unclear', 'review', { flag: 0.6 })];
  const before = { g: { flag: 0.12, verdict: 'pass' }, b: { flag: 0.8, verdict: 'flag' }, u: { flag: 0.48, verdict: 'flag' } };
  const r = judge3(run, bar, before);
  assert.equal(r.changed, 1 / 3, 'u flipped; u2 has no previous answer');
  assert.equal(r.drift, 0.1);
  assert.ok(r.misses.some((m) => /decisions changed 33% > 5%/.test(m)));
  assert.equal(judge3(run, bar).changed, null);
});
