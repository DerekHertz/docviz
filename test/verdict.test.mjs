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
    ['rule-fixed', 'look'],
    ['rules-changed', 'look'],
    ['rule-redefined', 'look'],
    ['model-removed', 'look'],
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

test('a rule that broke at base and holds at head is a finding to look at, never "nothing"', () => {
  const v = verdict([rule('holds', { atBase: 'breaks' }), step('pass')]);
  assert.equal(v.level, 'look');
  assert.deepEqual(v.reasons.map((r) => [r.kind, r.text, r.ref]), [['rule-fixed', 'ShipsPaid now holds; it broke before', 'order']]);
  assert.match(verdictLines(v), /^\*\*Look when you can\*\*\n\n- ⚠ ShipsPaid now holds; it broke before\n$/);
  assert.equal(verdict([rule('holds', { atBase: 'holds' })]).level, 'nothing');
  assert.equal(verdict([rule('breaks', { atBase: 'breaks' })]).level, 'needs');
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
  assert.match(verdictLines(verdict([rule('unchecked'), rule('unchecked', { name: 'NoKeptMoney' })])), /\n- ⚠ Rules not checked \(order didn’t run\): ShipsPaid, NoKeptMoney\n$/);
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

// With no rules.md (or for an invariant not in it), a break TLC finds is still a break.
test('a model invariant that breaks is "needs you", with its path, rules.md or not', () => {
  const f = { kind: 'extra-rule', model: 'order', name: 'PaidHasMoney', status: 'breaks', path: ['in the cart', 'you pay: paid'] };
  const v = verdict([f, { kind: 'atlas', status: 'no-rules' }]);
  assert.equal(v.level, 'needs');
  assert.deepEqual(v.reasons.map((r) => [r.level, r.kind, r.text]), [
    ['needs', 'rule-breaks', 'PaidHasMoney breaks in order, ending “you pay: paid” (the model checks it; it isn’t in your rules.md)'],
    ['look', 'rules-gap', 'No `.atlas/rules.md`: the models check no rule of yours'],
  ]);
  assert.equal(verdict([{ ...f, status: 'holds' }]).level, 'look');
});

test('rules.md text that isn’t a rule is a reason to look, in its own words', () => {
  const v = verdict([{ kind: 'rules-problem', text: 'rules.md: line 3 `## Spend Shows` is not a rule heading (## Name, one word)' }]);
  assert.deepEqual(v.reasons.map((r) => [r.level, r.kind, r.text]), [['look', 'rules-gap', 'rules.md: line 3 `## Spend Shows` is not a rule heading (## Name, one word)']]);
});

// Rule 2: an agent never edits rules.md. docviz can't know who did, so any change goes to the user.
test('a PR that changes rules.md is "look", naming the rules added, removed and reworded', () => {
  const v = verdict([{ kind: 'rules-changed', added: ['Fast'], removed: ['NoKeptMoney'], reworded: ['ShipsPaid'] }, step('pass')]);
  assert.equal(v.level, 'look');
  assert.deepEqual(v.reasons.map((r) => [r.kind, r.text]), [['rules-changed', 'Your rules changed: added Fast; removed NoKeptMoney; reworded ShipsPaid']]);
  assert.equal(verdict([{ kind: 'rules-changed', added: [], removed: [], reworded: [] }]).reasons[0].text,
    'Your rules changed: `.atlas/rules.md` was edited outside any rule');
});

test('a rule whose TLA+ definition changed is "look", whatever it changed to', () => {
  const v = verdict([{ kind: 'rule-redefined', model: 'order', name: 'ShipsPaid' }, rule('holds'), step('pass')]);
  assert.equal(v.level, 'look');
  assert.deepEqual(v.reasons.map((r) => [r.kind, r.text, r.ref]), [['rule-redefined', 'ShipsPaid’s definition in the model changed (order)', 'order']]);
});

test('a removed model, or a removed .atlas/, is named, and other findings still count', () => {
  const v = verdict([{ kind: 'model-removed', model: 'order' }, { kind: 'uncovered', path: 'src/order.js' }]);
  assert.equal(v.level, 'look');
  assert.deepEqual(v.reasons.map((r) => [r.kind, r.text]), [['model-removed', 'Model order removed'], ['uncovered', '`src/order.js`']]);
  const gone = verdict([{ kind: 'atlas', status: 'removed' }, { kind: 'model-removed', model: 'order' }, rule('breaks', { path: ['x'] })]);
  assert.equal(gone.level, 'needs');
  assert.deepEqual(gone.reasons.map((r) => r.text), ['ShipsPaid breaks in order, ending “x”', '`.atlas/` removed: no model checks this repo any more', 'Model order removed']);
});
