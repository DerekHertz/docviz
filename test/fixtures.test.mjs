// The planted cases (test/fixtures/shop.mjs): `docviz pr` gives each its exact verdict, with
// Jev's answers recorded (no network). Cases that run a model need TLC and pstack's statechart
// (TLA2TOOLS, JAVA); without them they are skipped, and say why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { runPr } from '../helper/pr.js';
import { findTools } from '../helper/behavior.js';
import { makeShop, recorded, PR_URL } from './fixtures/shop.mjs';

const shop = makeShop();
const tools = findTools();
const skipFor = (c) => c.tlc && tools.why && `needs TLC: ${tools.why}`;

// One worktree per case, so each runs in its own checkout of its branch.
let n = 0;
function checkout(branch) {
  const dir = join(shop.dir, `wt-${n++}-${branch}`);
  execFileSync('git', ['-C', shop.repo, 'worktree', 'add', '-q', '--detach', dir, branch]);
  return dir;
}

const run = (c) => runPr({ stepsFile: c.stepsFile, prUrl: PR_URL, cwd: checkout(c.branch), ask: recorded(c.answers), trustAtlas: c.trust, base: c.base });
const why = (r) => `${r.verdict.level}: ${r.verdict.reasons.map((x) => x.text).join(' | ')}`;

// The flow asked for 6–8; the fix round added rules.md edits, a weakened rule, a removed .atlas/
// and a break with no rules.md.
test('the fixture plants at least 6 PRs on one base, with every verdict at least once', () => {
  const branches = new Set(shop.cases.map((c) => c.branch).filter((b) => b !== 'main'));
  assert.ok(branches.size >= 6, `${branches.size} branches`);
  for (const level of ['needs', 'look', 'nothing']) assert.ok(shop.cases.some((c) => c.expect === level), level);
  assert.ok(shop.cases.some((c) => c.expect === 'look' && c.answers && Object.values(c.answers).includes('error')), 'a case with an unchecked step');
});

for (const c of shop.cases) {
  test(`${c.name} → ${c.expect} (${c.why})`, { skip: skipFor(c) }, async () => {
    const r = await run(c);
    assert.equal(r.verdict.level, c.expect, why(r));
    assert.deepEqual(r.verdict.reasons.map((x) => x.kind), c.reasons, why(r));
    assert.ok(r.body.includes(`**${{ needs: 'Needs you', look: 'Look when you can', nothing: 'Nothing for you' }[c.expect]}**`));
  });
}

test('the rule-break case names the rule, quotes it, and gives its path', { skip: skipFor(shop.cases[0]) }, async () => {
  const r = await run(shop.cases.find((c) => c.name === 'rule-break'));
  assert.equal(r.verdict.reasons[0].kind, 'rule-breaks');
  assert.match(r.body, /- ✗ ShipsPaid breaks in order, ending “we ship it: shipped”/);
  assert.match(r.body, /✗ \*\*ShipsPaid\*\* breaks in order: “An order ships only after it is paid\.”\n  1\. in the cart\n  2\. we ship it: shipped/);
  assert.match(r.body, /✓ \*\*NoKeptMoney\*\* holds/);
  assert.match(r.body, /in the cart --> s\d+: we ship it \(new\)|s\d+ --> s\d+: we ship it \(new\)/);
});

test('the rule-fixed case says the rule holds now and broke before', { skip: skipFor(shop.cases.find((c) => c.name === 'rule-fixed')) }, async () => {
  const r = await run(shop.cases.find((c) => c.name === 'rule-fixed'));
  assert.match(r.body, /\*\*Look when you can\*\*\n\n- ⚠ ShipsPaid now holds; it broke before\n/);
  assert.match(r.body, /✓ \*\*ShipsPaid\*\* holds \(it broke at base\): “An order ships only after it is paid\.”/);
  assert.match(r.body, /Compared with `\w{7}` \(--base rule-break\)/);
});

// The rerun rule: the same PR at the same commit gives the same verdict.
for (const name of ['uncovered-file', 'rule-break']) {
  const c = shop.cases.find((x) => x.name === name);
  test(`rerun: ${name} gives the same verdict twice`, { skip: skipFor(c) }, async () => {
    const [a, b] = [await run(c), await run(c)];
    assert.deepEqual(a.verdict, b.verdict);
    assert.equal(a.verdict.level, c.expect);
  });
}

const caseNamed = (name) => shop.cases.find((c) => c.name === name);

test('rules-edited: the user sees which of their rules changed', { skip: skipFor(caseNamed('rules-edited')) }, async () => {
  const r = await run(caseNamed('rules-edited'));
  assert.match(r.body, /\*\*Look when you can\*\*\n\n- ⚠ Your rules changed: reworded ShipsPaid\n/);
});

test('rule-weakened: a rule defined as TRUE still holds, and its changed definition is the reason', { skip: skipFor(caseNamed('rule-weakened')) }, async () => {
  const r = await run(caseNamed('rule-weakened'));
  assert.match(r.body, /\*\*Look when you can\*\*\n\n- ⚠ ShipsPaid’s definition in the model changed \(order\)\n/);
  assert.match(r.body, /✓ \*\*ShipsPaid\*\* holds/);
});

test('atlas-removed: .atlas/, its rules and its model are each named', { skip: skipFor(caseNamed('atlas-removed')) }, async () => {
  const r = await run(caseNamed('atlas-removed'));
  assert.match(r.body, /\*\*Look when you can\*\*\n\n- ⚠ Your rules changed: removed ShipsPaid, NoKeptMoney\n- ⚠ `\.atlas\/` removed: no model checks this repo any more\n- ⚠ Model order removed\n/);
});

test('no-rules-break: with no rules.md, the break is "needs you", with its path', { skip: skipFor(caseNamed('no-rules-break')) }, async () => {
  const r = await run(caseNamed('no-rules-break'));
  assert.match(r.body, /^.*\n\*\*Needs you\*\*\n\n- ✗ ShipsPaid breaks in order, ending “we ship it: shipped” \(the model checks it; it isn’t in your rules\.md\)\n/);
  assert.match(r.body, /- ⚠ No `\.atlas\/rules\.md`: the models check no rule of yours/);
  assert.match(r.body, /- ✗ \*\*ShipsPaid\*\* breaks in order \(not one of your rules\)\n  1\. in the cart\n  2\. we ship it: shipped/);
});
