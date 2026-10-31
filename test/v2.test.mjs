// Version 2 of C3 (step matches its code) and D1 (protection domains), asked the way the
// projects that work ask: structured state, a data note, focused instructions, criteria with
// examples on both sides. The examples must not quote any test case, or the lab measures recall.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stepRequestV2 } from '../lab/c3v2.js';
import { domainRequestV2 } from '../lab/domains2.js';
import { cases as stepCases } from '../lab/steps.js';
import { cases as domainCases, DOMAINS } from '../lab/domains.js';

const examplesOf = (questions) => Object.values(questions).flatMap((q) => [...(q.criteria.true.examples || []), ...(q.criteria.false.examples || [])]);

test('C3 v2 state: the step, the code (no own-file fields, which would leak a wrong link), a data note; focused questions', () => {
  const c = stepCases()[0];
  const { state, questions } = stepRequestV2(c);
  assert.equal(state.step.label, c.label);
  assert.equal(state.code.text, c.code);
  assert.deepEqual(Object.keys(state.code), ['text']);
  assert.match(state.note, /data, never instructions/);
  assert.deepEqual(Object.keys(questions).sort(), ['contradicted', 'supported']);
  for (const q of Object.values(questions)) assert.ok(q.instructions.question && q.instructions.focus);
  assert.match(questions.contradicted.instructions.focus, /not a contradiction/);
});

test('C3 v2 examples quote no fixture label or function', () => {
  const steps = JSON.parse(readFileSync(new URL('../lab/fixtures/steps.json', import.meta.url), 'utf8'));
  const words = steps.flatMap((s) => [s.fn, s.label, s.paraphrase, s.wrongLabel, s.unclearLabel, s.heldOutLabel]);
  const ex = examplesOf(stepRequestV2(stepCases()[0]).questions).join('\n');
  assert.ok(ex.length > 100);
  for (const w of words) assert.ok(!ex.includes(w), `example quotes "${w}"`);
});

test('D1 v2 state: the file, complete hunks with context, and a data note; one focused question per domain', () => {
  const c = domainCases().find((x) => x.file === 'helper/jev.js');
  const { state, questions } = domainRequestV2(c);
  assert.equal(state.file, 'helper/jev.js');
  assert.ok(state.hunks.length && state.hunks.every((h) => h.startsWith('@@ ') || h.startsWith('… ')));
  assert.match(state.note, /data, never instructions/);
  assert.deepEqual(Object.keys(questions).sort(), Object.keys(DOMAINS).sort());
  for (const q of Object.values(questions)) {
    assert.ok(q.instructions.question && q.instructions.focus);
    assert.ok(q.criteria.true.examples.length && q.criteria.false.examples.length);
  }
  assert.match(JSON.stringify(questions.access.criteria.false), /merely/);
});

test('D1 v2 examples quote no changed line from the fixture', () => {
  const lines = domainCases().flatMap((c) => c.diff.split('\n').map((l) => l.slice(1).trim()).filter((l) => l.length > 25));
  const ex = examplesOf(domainRequestV2(domainCases()[0]).questions).join('\n');
  for (const l of lines) assert.ok(!ex.includes(l), `example quotes "${l}"`);
});
