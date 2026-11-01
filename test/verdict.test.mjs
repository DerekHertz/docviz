// One verdict per PR, from DESIGN.md's table: needs you / look when you can / nothing for you.
// Anything unknown is "look" or worse (the user's rule 1); the same findings give the same verdict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, verdictLines, TABLE, LEVELS } from '../helper/verdict.js';
import { prComment, MARKER } from '../helper/pr.js';

const rule = (status, extra = {}) => ({ kind: 'rule', name: 'ShipsPaid', text: 'An order ships only after it is paid.', status, model: 'order', ...extra });
const step = (verdict, extra = {}) => ({ kind: 'step', source: 'pr', id: 'ship', label: 'A paid order ships', verdict, ...extra });

test('the table has DESIGN.md’s rows in order, ending in "nothing"', () => {
  assert.deepEqual(TABLE.map((r) => [r.kind, r.level]), [
    ['rule-breaks', 'needs'],
    ['contradicted', 'needs'],
    ['model-failed', 'needs'],
    ['behavior-changed', 'look'],
    ['step-unconfirmed', 'look'],
    ['uncovered', 'look'],
    ['not-run', 'look'],
    ['rules-gap', 'look'],
    ['fine', 'nothing'],
  ]);
  assert.deepEqual(LEVELS, ['needs', 'look', 'nothing']);
});

test('each finding takes the first row it matches', () => {
  const level = (f) => verdict([f]).level;
  assert.equal(level(rule('breaks', { path: ['cart', 'you ship it: shipped'] })), 'needs');
  assert.equal(level(step('flag')), 'needs');
  assert.equal(level({ kind: 'step', source: 'model', model: 'order', id: 'Ship', label: 'x', verdict: 'flag' }), 'needs');
  assert.equal(level({ kind: 'run', model: 'order', side: 'head', error: 'TLC: parse error' }), 'needs');
  assert.equal(level({ kind: 'run', model: 'order', side: 'base', error: 'TLC: parse error' }), 'look');
  assert.equal(level({ kind: 'delta', model: 'order', changed: true, added: { states: ['returned'], edges: [] }, removed: { states: [], edges: [] } }), 'look');
  assert.equal(level({ kind: 'delta', model: 'order', changed: null, added: { states: [], edges: [] }, removed: { states: [], edges: [] } }), 'look');
  assert.equal(level({ kind: 'delta', model: 'order', changed: false, added: { states: [], edges: [] }, removed: { states: [], edges: [] } }), 'nothing');
  assert.equal(level(step('review')), 'look');
  assert.equal(level(step('unchecked', { error: 'Jev 500' })), 'look');
  assert.equal(level(step('pass')), 'nothing');
  assert.equal(level({ kind: 'uncovered', path: 'src/report.js' }), 'look');
  assert.equal(level({ kind: 'atlas', status: 'absent' }), 'look');
  assert.equal(level({ kind: 'atlas', status: 'no-base' }), 'look');
  assert.equal(level({ kind: 'not-run', models: ['order'], why: 'pass --trust-atlas on your own repo' }), 'look');
  assert.equal(level(rule('unchecked')), 'look');
  assert.equal(level(rule('unchecked', { model: null })), 'look');
  assert.equal(level({ kind: 'atlas', status: 'no-rules' }), 'look');
  assert.equal(level({ kind: 'extra-rule', model: 'order', name: 'NeverNegative', status: 'holds' }), 'look');
  assert.equal(level(rule('holds')), 'nothing');
  assert.equal(level(rule('untouched')), 'nothing');
});

test('an unknown finding kind is never "nothing" (rule 1)', () => {
  assert.equal(verdict([{ kind: 'something-new' }]).level, 'look');
});

test('the verdict is the worst level, its reasons worst first; "nothing" only with no reason', () => {
  const v = verdict([step('pass'), { kind: 'uncovered', path: 'src/report.js' }, rule('breaks', { path: ['cart', 'you ship it: shipped'] }), rule('holds', { name: 'Other' })]);
  assert.equal(v.level, 'needs');
  assert.deepEqual(v.reasons.map((r) => [r.level, r.kind]), [['needs', 'rule-breaks'], ['look', 'uncovered']]);
  assert.match(v.reasons[0].text, /ShipsPaid breaks in order/);
  assert.equal(v.reasons[0].ref, 'order');
  assert.deepEqual(verdict([step('pass'), rule('holds')]), { level: 'nothing', reasons: [] });
  assert.equal(verdict([]).level, 'nothing');
  assert.equal(verdict([step('pass'), step('unchecked', { id: 'b', error: 'TYPESAFE_API_KEY not set' })]).level, 'look');
});

test('same findings, same verdict', () => {
  const f = [step('review'), { kind: 'uncovered', path: 'b.js' }, { kind: 'uncovered', path: 'a.js' }, rule('holds')];
  assert.deepEqual(verdict(f), verdict(structuredClone(f)));
});

test('the verdict opens the comment: its line, then the reasons, worst first', () => {
  const v = verdict([{ kind: 'uncovered', path: 'src/a.js' }, { kind: 'uncovered', path: 'src/b.js' }, step('flag'), step('unchecked', { id: 'c', label: 'Post it', error: 'Jev 500' })]);
  const lines = verdictLines(v);
  assert.match(lines, /^\*\*Needs you\*\*\n\n- ✗ /);
  assert.match(lines, /- ✗ PR step “A paid order ships” is contradicted by its code/);
  assert.match(lines, /- ⚠ PR step “Post it” not checked: Jev 500/);
  assert.match(lines, /- ⚠ Changed code no model covers: `src\/a\.js`, `src\/b\.js`/);
  assert.match(verdictLines(verdict([])), /^\*\*Nothing for you\*\*\n\nNo rule breaks, every step is confirmed/);
  assert.match(verdictLines(verdict([step('review')])), /^\*\*Look when you can\*\*/);

  const body = prComment({
    card: { caption: 'CAP', mermaid: 'flowchart TD\n  pick\n' },
    steps: [{ label: 'Pick forums', cuts: [{ path: 'src/a.js', start: 3, end: 9 }] }],
    sha: 'abcdef1234567', repoUrl: 'https://github.com/o/r', usage: { usd: 0, estimated: false }, checked: true, version: 'v1',
    verdict: lines,
  });
  assert.ok(body.startsWith(`${MARKER}\n**Needs you**\n`));
  assert.ok(body.indexOf('**Needs you**') < body.indexOf('## How this PR works'));
});
