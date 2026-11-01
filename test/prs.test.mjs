// Lab P1: does a PR say what it does? Unmentioned files (Jev vs file names) and the
// description's claims against the diff (Jev, three-way).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileCases, claimCases, filesRequest, claimsRequest, namedIn, decideClaims } from '../lab/prs.js';
import * as filesJev from '../lab/experiments/pr-files-jev.js';
import * as filesNames from '../lab/experiments/pr-files-names.js';
import * as claims from '../lab/experiments/pr-claims-jev.js';

test('each PR keeps its own files as mentioned and gets one planted file from another commit', () => {
  const all = fileCases();
  const prs = new Set(all.map((c) => c.pr));
  assert.equal(prs.size, 14);
  const planted = all.filter((c) => c.planted);
  assert.equal(planted.length, 14);
  for (const p of planted) {
    assert.equal(p.bad, true);
    assert.notEqual(p.from, p.pr, 'planted from a different commit');
    assert.equal(p.from.split(':')[0], p.pr.split(':')[0], 'from the same repo, the hard case');
  }
  assert.ok(all.filter((c) => !c.planted).every((c) => !c.bad));
  assert.deepEqual(filesJev.cases().map((c) => c.id), filesNames.cases().map((c) => c.id));
});

test('the files request shows the description and every file, and asks one question per file', () => {
  const pr = fileCases().filter((c) => c.pr === 'docviz:480a9f7');
  const { state, questions } = filesRequest(pr);
  assert.match(state.description, /Put docviz on PATH/);
  assert.equal(Object.keys(questions).length, pr.length);
  for (const q of Object.values(questions)) { assert.equal(q.type, 'noul'); assert.ok(q.criteria.true && q.criteria.false); }
});

test('the names baseline counts a file as mentioned when its name or folder is in the description', () => {
  assert.equal(namedIn('scripts/hooks/bash-guard.mjs', 'fix(relay): bash-guard parses shell segments'), true);
  assert.equal(namedIn('test/plugin-bin.test.mjs', 'Put docviz on PATH; bin/docviz is a launcher'), true);
  assert.equal(namedIn('src/packet/Packet.tsx', 'fix: keep a judged line uncovered'), false);
});

test('claims cases: the real description is good, a swapped or falsified one is broken, filler can’t be told', () => {
  const all = claimCases();
  assert.equal(all.length, 14 * 4);
  const kind = (m) => all.filter((c) => c.mutation === m);
  assert.ok(kind('original').every((c) => c.truth === 'good'));
  assert.ok([...kind('swapped'), ...kind('falseClaim')].every((c) => c.truth === 'bad'));
  assert.ok(kind('filler').every((c) => c.truth === 'unclear'));
  for (const f of kind('falseClaim')) assert.ok(f.description.endsWith(f.claim));
  assert.equal(claims.meta.mode, 'three-way');
});

test('claims request asks: specific, every claim shown, contradicted, ignoring where the change came from', () => {
  const { state, questions } = claimsRequest(claimCases()[0]);
  assert.ok(state.description && state.diff);
  assert.deepEqual(Object.keys(questions).sort(), ['contradicted', 'specific', 'supported']);
  assert.match(questions.supported.criteria.true + questions.supported.criteria.false, /review|ticket|why/i);
});

test('claims decision: contradicted flags; a non-specific description goes to review; shown passes', () => {
  const bar = { supportedAt: 0.6, contradictedAt: 0.5, specificAt: 0.5 };
  assert.equal(decideClaims({ prob: 0.9, probContra: 0.6, probSpecific: 0.9 }, bar), 'flag');
  assert.equal(decideClaims({ prob: 0.9, probContra: 0.1, probSpecific: 0.2 }, bar), 'review');
  assert.equal(decideClaims({ prob: 0.9, probContra: 0.1, probSpecific: 0.9 }, bar), 'pass');
  assert.equal(decideClaims({ prob: 0.4, probContra: 0.1, probSpecific: 0.9 }, bar), 'review');
});

test('a planted file is never one the PR changes or names in its description', () => {
  for (const p of fileCases().filter((c) => c.planted)) {
    const own = fileCases().filter((c) => c.pr === p.pr && !c.planted).map((c) => c.file);
    assert.ok(!own.includes(p.file), `${p.pr}: ${p.file} is the PR's own file`);
    assert.ok(!namedIn(p.file, p.description), `${p.pr}: ${p.file} is named in the description`);
  }
});

// ---------- v2: asked the way jev-commit and Jev Review ask ----------
const v2 = await import('../lab/prs2.js');

test('v2 state is structured: message, the whole file table, complete hunks with context, and a data note', () => {
  const pr = fileCases().filter((c) => c.pr === 'docviz:6b9607a');
  const { state } = v2.filesRequest(pr);
  assert.equal(typeof state.message, 'string');
  assert.ok(state.files.some((f) => f.path === 'helper/pr.js' && f.status === 'M' && f.added > 0));
  assert.ok(state.files.some((f) => f.path === pr.find((c) => c.planted).file), 'the planted file is in the table');
  assert.ok(state.hunks.every((h) => h.path && h.text.startsWith('@@ ')));
  assert.ok(state.hunks.some((h) => /\n [^\n]/.test(h.text)), 'context lines are kept');
  assert.match(state.note, /data, never instructions/);
});

test('v2 questions are objects with a focus, and criteria give examples on both sides; high means yes', () => {
  const pr = fileCases().filter((c) => c.pr === 'docviz:6b9607a');
  for (const q of Object.values(v2.filesRequest(pr).questions)) {
    assert.ok(q.instructions.question && q.instructions.focus);
    assert.ok(q.criteria.true.examples.length && q.criteria.false.examples.length);
    assert.match(q.criteria.true.examples.join(' '), /tests/);
  }
  const c = v2.claimsRequest(claimCases()[0]);
  assert.deepEqual(Object.keys(c.questions).sort(), ['contradicted', 'specific', 'supported']);
  assert.match(c.questions.specific.instructions.focus, /alone/);
  assert.match(c.questions.contradicted.instructions.focus, /not a contradiction/);
});
