// Lab scoring: rates, the honest (split-half) threshold, the pass bar, and the
// identifier-visible mutations that make the known-bad cases.
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { rates, bestThreshold, splitHalf, judge, calibration, bands } from '../lab/metrics.js';
import { mutations, cases, question } from '../lab/experiments/identifier-visible.js';
import * as stepMatches from '../lab/experiments/step-matches-code.js';

// `flag` is the probability a case is bad; `bad` is the truth.
const c = (id, flag, bad, extra = {}) => ({ id, flag, bad, ...extra });

test('rates count catches among bad cases and false alarms among good ones', () => {
  const cases = [c('a', 0.9, true), c('b', 0.2, true), c('c', 0.1, false), c('d', 0.7, false)];
  assert.deepEqual(rates(cases, 0.5), { catch: 0.5, falseAlarm: 0.5, caught: 1, bad: 2, alarms: 1, good: 2 });
});

test('the best threshold separates perfectly when it can', () => {
  const cases = [c('a', 0.9, true), c('b', 0.6, true), c('c', 0.4, false), c('d', 0.1, false)];
  const t = bestThreshold(cases);
  assert.ok(t > 0.4 && t <= 0.6, `threshold ${t}`);
  assert.deepEqual([rates(cases, t).catch, rates(cases, t).falseAlarm], [1, 0]);
});

test('split-half is stable for the same ids and keeps both labels on each side', () => {
  const cases = Array.from({ length: 40 }, (_, i) => c(`case-${i}`, i / 40, i % 2 === 0));
  const one = splitHalf(cases);
  const two = splitHalf([...cases].reverse());
  assert.deepEqual(one.tune.map((x) => x.id).sort(), two.tune.map((x) => x.id).sort());
  assert.equal(one.tune.length + one.score.length, 40);
  for (const half of [one.tune, one.score]) {
    assert.ok(half.some((x) => x.bad) && half.some((x) => !x.bad));
  }
});

test('judge passes only when every bar is met, and names what missed', () => {
  const bar = { catch: 0.9, falseAlarm: 0.1, costPerCard: 0.001 };
  const good = Array.from({ length: 20 }, (_, i) => c(`g${i}`, 0.05, false, { card: `k${i % 5}`, usd: 0.00001 }));
  const bad = Array.from({ length: 20 }, (_, i) => c(`b${i}`, 0.95, true, { card: `k${i % 5}`, usd: 0.00001 }));
  const ok = judge([...good, ...bad], bar);
  assert.equal(ok.pass, true);
  assert.deepEqual(ok.misses, []);

  const leaky = [...good, ...bad, c('inj', 0.1, true, { injection: true, card: 'k0', usd: 0 })];
  const r = judge(leaky, bar);
  assert.equal(r.pass, false);
  assert.ok(r.misses.some((m) => /injection/.test(m)));

  const pricey = judge([...good, ...bad].map((x) => ({ ...x, usd: 0.01 })), bar);
  assert.ok(pricey.misses.some((m) => /cost/.test(m)));
});

test('judge never passes a run too small to score both labels', () => {
  const r = judge([c('a', 0.9, true, { card: 'k' }), c('b', 0.1, false, { card: 'k' })], { catch: 0.9, falseAlarm: 0.1, costPerCard: 1 });
  assert.equal(r.pass, false);
  assert.ok(r.misses.some((m) => /too few/.test(m)));
});

test('repeatability is decisions that changed since the previous run; drift is shown, not judged', () => {
  const bar = { catch: 0.5, falseAlarm: 0.5, costPerCard: 1, changed: 0.05 };
  const now = ['a', 'b', 'c', 'd'].map((id, i) => c(id, i < 2 ? 0.9 : 0.1, i < 2, { card: 'k' }));
  const steady = judge(now, bar, { a: 0.7, b: 0.9, c: 0.1 });
  assert.equal(steady.drift, 0.2);
  assert.equal(steady.changed, 0);
  assert.ok(!steady.misses.some((m) => /drift|changed/.test(m)), 'probabilities moved, decisions did not');
  const flipped = judge(now, bar, { a: 0.7, b: 0.9, c: 0.8 });
  assert.equal(flipped.changed, 1 / 3);
  assert.ok(flipped.misses.some((m) => /decisions changed/.test(m)));
});

test('mutations break the identifier in every bad case and leave it whole in the good one', () => {
  const card = { id: 'k', mermaid: 'flowchart TD\n  a["startServer()"] --> b["route"]', identifiers: ['startServer'] };
  const cases = mutations(card);
  const good = cases.filter((x) => !x.bad);
  assert.deepEqual(good.map((x) => x.theme || 'light'), ['light', 'dark']);
  for (const g of good) assert.match(g.mermaid, /startServer\(\)/);
  for (const bad of cases.filter((x) => x.bad && !x.visualOnly)) {
    assert.doesNotMatch(bad.mermaid, /\bstartServer\b/, bad.mutation);
    assert.equal(bad.identifier, 'startServer');
  }
  assert.ok(cases.some((x) => x.injection), 'has an injection case');
  assert.ok(cases.some((x) => x.mutation === 'tiny' && x.fontSize === '2px' && x.bad), 'has an unreadably small case');
  assert.ok(cases.some((x) => x.mutation === 'covered' && x.cover === 'startServer' && x.bad), 'has a covered case');
  assert.ok(!cases.some((x) => x.mutation === 'nearMiss'), 'spelling is left to code, not asked of Jev');
  assert.ok(new Set(cases.map((x) => x.id)).size === cases.length, 'ids are unique');
});

test('B2 asks only about legibility, with criteria for yes and no', () => {
  const q = question('startServer', 'img_1');
  assert.doesNotMatch(q.instructions, /spell/i);
  assert.ok(q.criteria.true && q.criteria.false);
});

// A broken case only counts if the identifier is really gone: not left inside a longer name
// (illustratePrompt), in another case (Explore button), or in a state name (Learned).
test('no broken fixture case still shows its identifier anywhere', () => {
  const leftovers = cases()
    .filter((x) => x.bad && !x.visualOnly && x.mermaid.toLowerCase().includes(x.identifier.toLowerCase()))
    .map((x) => x.id);
  assert.deepEqual(leftovers, []);
});

test('cost per card counts only the calls a real card makes', () => {
  const bar = { catch: 0, falseAlarm: 1, costPerCard: 0.001 };
  const run = ['a', 'b', 'c', 'd'].map((id, i) => c(id, i < 2 ? 0.9 : 0.1, i < 2, { card: 'k', usd: 0.0004, real: i === 2 }));
  assert.equal(judge(run, bar).costPerCard, 0.0004);
});

test('calibration compares what the evaluator said with how often it was right', () => {
  const run = [c('a', 0.95, true), c('b', 0.9, true), c('c', 0.85, false), c('d', 0.1, false), c('e', 0.05, false)];
  const bins = calibration(run, 5);
  const top = bins.at(-1);
  assert.deepEqual([top.n, top.said.toFixed(2), top.actual.toFixed(2)], [3, '0.90', '0.67']);
  assert.equal(bins[0].n, 2);
  assert.equal(bins[0].actual, 0);
  assert.equal(bins.reduce((n, b) => n + b.n, 0), 5);
});

test('bands act on confident answers and send the middle to review', () => {
  const run = [c('a', 0.95, true), c('b', 0.5, true), c('c', 0.55, false), c('d', 0.05, false), c('e', 0.9, false)];
  const r = bands(run, 0.2, 0.8);
  assert.deepEqual(r, { decided: 3, review: 2, reviewRate: 0.4, right: 2, accuracy: 2 / 3 });
});

test('C3 steps all find their code in the repo, with a paraphrase and a wrong label', () => {
  const all = stepMatches.cases();
  const ids = new Set(all.map((x) => x.id));
  assert.equal(ids.size, all.length, 'ids are unique');
  for (const x of all) {
    assert.ok(x.code.length > 20, `${x.id} has code`);
    assert.ok(x.label && x.file, x.id);
  }
  const kinds = (m) => all.filter((x) => x.mutation === m);
  for (const g of [...kinds('original'), ...kinds('paraphrase')]) assert.equal(g.bad, false);
  for (const m of ['neighbor', 'wrongAction', 'injection']) assert.ok(kinds(m).length && kinds(m).every((x) => x.bad), m);
  for (const n of kinds('neighbor')) assert.notEqual(n.code, all.find((x) => x.step === n.step && x.mutation === 'original').code);
  for (const i of kinds('injection')) { assert.ok(i.injection); assert.match(i.code, /reviewer/); }
  for (const w of kinds('wrongAction')) assert.notEqual(w.label, all.find((x) => x.step === w.step && x.mutation === 'original').label);
});

test('C3 gives Jev the label and the code, with criteria', () => {
  const x = stepMatches.cases()[0];
  const { state, questions } = stepMatches.request(x);
  assert.equal(state.label, x.label);
  assert.ok(state.code.includes(x.code));
  assert.ok(questions.matches.criteria.true && questions.matches.criteria.false);
});

// A fixture Mermaid can't draw shows up as errors in the lab, not as Jev's answer. Needs
// Playwright's browser, which CI doesn't install, so it skips there.
const canRender = await import('playwright').then((p) => existsSync(p.chromium.executablePath())).catch(() => false);
test('every lab case renders', { skip: !canRender && 'no Playwright browser', timeout: 300_000 }, async () => {
  const { render, closeRenderer } = await import('../lab/render.js');
  const { cases } = await import('../lab/experiments/identifier-visible.js');
  const failed = [];
  try {
    for (const c of cases()) await render(c.mermaid, { theme: c.theme, fontSize: c.fontSize, cover: c.cover }).catch((e) => failed.push(`${c.id}: ${e.message.split('\n')[0]}`));
  } finally { await closeRenderer(); }
  assert.deepEqual(failed, []);
});
