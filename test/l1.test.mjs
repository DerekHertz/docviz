// Lab L1: Jev picks a card's form and diagram kind from a fixed set; scored against labels from a
// separate agent, with the bar committed before the first run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMS, KINDS, BAR, sections, request, judgeAgreement } from '../lab/l1.js';
import * as j113 from '../lab/experiments/l1-jev113.js';
import * as j114 from '../lab/experiments/l1-jev114.js';

test('44 real sections, each with its source commit and license', () => {
  const all = sections();
  assert.equal(all.length, 44);
  for (const s of all) assert.ok(s.text.length > 100 && s.source.sha.length === 40 && s.source.license, s.id);
});

test('one request asks form and kind as choices, with the exact shared definitions as options', () => {
  const { state, questions } = request({ heading: 'H', text: 'T' });
  assert.match(state.note, /data, never instructions/);
  assert.equal(questions.form.type, 'choice');
  assert.deepEqual(questions.form.criteria, FORMS);
  assert.deepEqual(questions.kind.criteria, KINDS);
  assert.ok(questions.form.instructions.focus && questions.kind.instructions.focus);
});

test('both Jev models are tried on the same cases and pin their model', () => {
  assert.equal(j113.meta.model, 'jev-1.13.0');
  assert.equal(j114.meta.model, 'jev-1.14.0');
  assert.deepEqual(j113.cases().map((c) => c.id), j114.cases().map((c) => c.id));
});

test('agreement: kind counts the acceptable second; missed and extra cards; changes; median time', () => {
  const r = (id, label, pick, ms) => ({ id, label, pick, ms, usd: 0.0001 });
  const rows = [
    r('a', { form: 'diagram', kind: 'flow', alsoFine: 'state' }, { form: 'diagram', kind: 'state' }, 100),
    r('b', { form: 'diagram', kind: 'sequence', alsoFine: null }, { form: 'none', kind: 'flow' }, 200),
    r('c', { form: 'none', kind: 'flow', alsoFine: null }, { form: 'diagram', kind: 'flow' }, 300),
    r('d', { form: 'interactive', kind: 'timeline', alsoFine: null }, { form: 'interactive', kind: 'timeline' }, 400),
  ];
  const v = judgeAgreement(rows, BAR, { a: { form: 'diagram', kind: 'state' }, b: { form: 'diagram', kind: 'flow' } });
  assert.equal(v.kindAgree, 2 / 3);
  assert.equal(v.formAgree, 0.5);
  assert.equal(v.missedCards, 1 / 3);
  assert.equal(v.extraCards, 1);
  assert.equal(v.changed, 0.5);
  assert.equal(v.p50Ms, 300);
  assert.equal(v.pass, false);
  assert.ok(v.misses.some((m) => /kind agreement/.test(m)));
});

test('without labels the verdict says so instead of passing', () => {
  const v = judgeAgreement([{ id: 'a', label: null, pick: { form: 'diagram', kind: 'flow' } }], BAR);
  assert.equal(v.pass, false);
  assert.ok(v.misses.includes('no labels yet'));
});
