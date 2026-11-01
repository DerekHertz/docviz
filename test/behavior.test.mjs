// Behavior and rules: statechart on each touched model at base and head, the change between them,
// and each of the user's rules holding or breaking. TLC itself is faked here (a script that writes
// what statechart writes); the fixture tests run the real one when it is installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseChart, parseReport, delta, markChart, ruleFindings, behaviorSection, runBehavior, isSource, statechartError, order, atlasChanges, tlaDefinition } from '../helper/behavior.js';
import { atlasFrom } from '../helper/atlas.js';
import { fakeRepo } from './fake-statechart.mjs';

const BASE_CHART = readFileSync('prototype/pr1-pipeline/model/out-base/chart.mmd', 'utf8');
const HEAD_CHART = readFileSync('prototype/pr1-pipeline/model/out-head/chart.mmd', 'utf8');
const HEAD_REPORT = readFileSync('prototype/pr1-pipeline/model/out-head/report.md', 'utf8');

test('a statechart chart is its states and one edge per step, the legend left out', () => {
  const c = parseChart(HEAD_CHART);
  assert.equal(c.title, 'One card and its money');
  assert.equal(c.states.length, 8);
  assert.ok(c.states.includes('on the page, budget used up'));
  assert.ok(!c.states.some((s) => /Breaks|Path to/.test(s)));
  assert.deepEqual(c.edges.filter((e) => e.from === 'drawing' && e.to === 'failed').map((e) => e.label).sort(),
    ['the call fails after spending', 'the call times out']);
  assert.deepEqual(c.start, ['not drawn yet']);
});

test('chart labels are decoded and parent states prefix their children', () => {
  const c = parseChart('stateDiagram-v2\n  state "Card #34;A#34;" as s0 {\n    s1: on #35;1\n  }\n  s2: idle\n  [*] --> s2\n  s2 --> s1: go#59; now\n');
  assert.deepEqual(c.states, ['Card "A" / on #1', 'idle']);
  assert.deepEqual(c.edges, [{ from: 'idle', to: 'Card "A" / on #1', label: 'go; now' }]);
});

test('a report gives each broken rule its shortest path in the reader\'s words, and the rules that hold', () => {
  const r = parseReport(HEAD_REPORT);
  assert.deepEqual(r.holds, ['BudgetFirst', 'NoDeadlock']);
  assert.deepEqual(r.breaks, [{ rule: 'SpendShows', path: [
    'not drawn yet',
    'you break down the page: drawing',
    'the call fails after spending: failed',
    'you press Retry: redrawing',
    'you dismiss it: dismissed, call still out',
    'the call comes back to no card: dismissed',
  ] }]);
  const off = parseReport('# M\n\nTLC reached...\n\n## Inv breaks\nTLC found a counterexample. It is in tlc-Inv.out.\n\n## Rules not checked\nLater\nTLC stopped with exit 12 before it checked this rule:\n```\nboom\n```\n');
  assert.deepEqual(off.breaks, [{ rule: 'Inv', path: [] }]);
  assert.deepEqual(off.unchecked, ['Later']);
});

const run = (side, chart, extra = {}) => ({ model: 'card-money', side, ...parseChart(chart), holds: [], breaks: [], mermaid: chart, ...extra });

// PR #1 added the budget check, so at its head Simpler is refused once the budget is used up.
test('the delta is the states and steps added and removed, by their words', () => {
  const d = delta('card-money', run('base', BASE_CHART), run('head', HEAD_CHART));
  assert.equal(d.changed, true);
  assert.deepEqual(d.removed.edges, [{ from: 'on the page, budget used up', to: 'redrawing', label: 'you press Simpler' }]);
  assert.deepEqual(d.added, { states: [], edges: [] });
  assert.equal(delta('card-money', run('base', HEAD_CHART), run('head', HEAD_CHART)).changed, false);
  const fresh = delta('card-money', null, run('head', HEAD_CHART));
  assert.equal(fresh.added.states.length, 8);
  assert.equal(delta('card-money', run('base', HEAD_CHART), run('head', HEAD_CHART, { drawn: false })).changed, null);
});

test('the head chart marks what was added: a class on new states, "(new)" on new steps', () => {
  const d = delta('card-money', run('base', 'stateDiagram-v2\n  s0: a\n  [*] --> s0\n'), run('head', HEAD_CHART));
  const marked = markChart(HEAD_CHART, d);
  assert.match(marked, /classDef added stroke:#d29922,stroke-width:3px/);
  assert.match(marked, /class s7 added/);
  // Reversed, the step is new.
  const d2 = delta('card-money', run('base', HEAD_CHART), run('head', BASE_CHART));
  const m2 = markChart(BASE_CHART, d2);
  assert.match(m2, /s7 --> s5: you press Simpler \(new\)/);
  assert.match(m2, /s7 --> s4: you dismiss it$/m);
  assert.doesNotMatch(m2, /class \w+ added/);
});

const RULES = [{ name: 'SpendShows', text: 'Never add a call that spends\nwithout showing up.' }, { name: 'BudgetFirst', text: 'The budget check runs before every call.' }, { name: 'Unmodelled', text: 'Nobody checks me.' }];

test('each rule holds, breaks (with its path), was not touched, or is checked by no model', () => {
  const runs = [
    { model: 'card-money', side: 'head', holds: ['BudgetFirst', 'NoDeadlock'], breaks: [{ rule: 'SpendShows', path: ['a', 'go: b'] }] },
    { model: 'card-money', side: 'base', holds: ['BudgetFirst', 'NoDeadlock', 'SpendShows'], breaks: [] },
  ];
  const models = [{ name: 'card-money', rules: ['SpendShows', 'BudgetFirst', 'Extra'] }, { name: 'other', rules: ['Elsewhere'] }];
  const f = ruleFindings({ rules: [...RULES, { name: 'Elsewhere', text: 'x' }], runs, models, touched: ['card-money'] });
  assert.deepEqual(f.map((x) => [x.kind, x.name, x.status]), [
    ['rule', 'SpendShows', 'breaks'], ['rule', 'BudgetFirst', 'holds'], ['rule', 'Unmodelled', 'unchecked'], ['rule', 'Elsewhere', 'untouched'],
    ['extra-rule', 'Extra', 'unchecked'],
  ]);
  assert.deepEqual(f[0].path, ['a', 'go: b']);
  assert.equal(f[0].atBase, 'holds');
  assert.equal(f[0].text, RULES[0].text);
});

test('only source files count as uncovered: docs, tests, markdown and .atlas never do', () => {
  for (const p of ['src/a.js', 'extension/background.js', 'package.json']) assert.ok(isSource(p), p);
  for (const p of ['README.md', 'docs/x.js', 'test/a.test.mjs', '.atlas/models/m/M.tla', 'src/notes.md']) assert.ok(!isSource(p), p);
});

test('the behavior section quotes each rule word for word, with the path to a break', () => {
  const findings = ruleFindings({
    rules: RULES,
    runs: [{ model: 'card-money', side: 'head', holds: ['BudgetFirst'], breaks: [{ rule: 'SpendShows', path: ['not drawn yet', 'you dismiss it: dismissed'] }] }],
    models: [{ name: 'card-money', rules: ['SpendShows', 'BudgetFirst'] }], touched: ['card-money'],
  });
  const d = delta('card-money', run('base', BASE_CHART), run('head', HEAD_CHART));
  const md = behaviorSection({
    base: { sha: 'abcdef123456', how: 'merge base with origin/main' }, findings,
    models: [{ name: 'card-money', title: 'One card and its money', delta: d, mermaid: markChart(HEAD_CHART, d) }],
    modelChecks: [], link: (c) => `${c.path}:${c.start}`,
  });
  assert.match(md, /### Behavior/);
  assert.match(md, /Compared with `abcdef1` \(merge base with origin\/main\)/);
  assert.match(md, /```mermaid\n---\ntitle: "One card and its money"/);
  assert.match(md, /1 step removed\.[\s\S]*Removed: “on the page, budget used up” → “redrawing”: you press Simpler/);
  assert.match(md, /✗ \*\*SpendShows\*\* breaks in card-money: “Never add a call that spends without showing up\.”/);
  assert.match(md, /  1\. not drawn yet\n  2\. you dismiss it: dismissed/);
  assert.match(md, /✓ \*\*BudgetFirst\*\* holds: “The budget check runs before every call\.”/);
  assert.match(md, /\*\*Unmodelled\*\* is checked by no model: “Nobody checks me\.”/);
});

test('a statechart failure reads in two lines, naming the model folder, not the temp copy', () => {
  const stderr = 'SANY could not read Order.tla (exit 1):\nFatal errors while parsing TLA+ spec in file /tmp/docviz-x/m/Order.tla\n\ntla2sany.semantic.AbortException\n*** Abort messages: 1\n\nException in thread "main" tla2sany.xml.XMLExportingException: spec null\n\tat tla2sany.xml.XMLExporter.main(XMLExporter.java:110)\n';
  assert.equal(statechartError(stderr, '/tmp/docviz-x/m', '.atlas/models/order'),
    'SANY could not read Order.tla (exit 1): Fatal errors while parsing TLA+ spec in file .atlas/models/order/Order.tla');
});

const asks = (verdicts) => async (req) => {
  const v = verdicts[req.state.label] ?? 'pass';
  if (v === 'error') throw Object.assign(new Error('Jev 500'), { usage: { usd: 0, estimated: false } });
  const [p, c] = { pass: [0.9, 0.1], review: [0.3, 0.2], flag: [0.2, 0.8] }[v];
  return { answers: { supported: { noul: p }, contradicted: { noul: c } }, usage: { provider: 'jev', usd: 0.00004, estimated: false } };
};

test('runBehavior: a touched model runs at base and head; a new step and a broken rule show up', async () => {
  const { repo, git, put, spec, chart, base, tools } = fakeRepo();
  put('src/door.js', 'function open() { lock(); }\nfunction shut() {}\n');
  put('.atlas/models/door/Door.tla', spec({ exit: 1, report: '# Door\n\n## Shut breaks\nThe shortest path has 1 step:\n0. shut\n1. you kick it: open\n\n## Rules that hold\nNoDeadlock\n',
    chart: chart('  s0 --> s1: you kick it\n') }));
  put('src/other.js', 'y\n');
  const b = await runBehavior({ root: repo, git, base: { sha: base, how: 'test' }, trust: true, ask: asks({}), tools });
  const kinds = b.findings.map((f) => `${f.kind}:${f.name || f.id || f.model || f.path}:${f.status ?? f.changed ?? f.verdict ?? ''}`);
  assert.deepEqual(kinds, ['rule:Shut:breaks', 'delta:door:true', 'step:Open:pass', 'uncovered:src/other.js:']);
  assert.deepEqual(b.runs.map((r) => [r.side, r.error]), [['base', undefined], ['head', undefined]]);
  assert.equal(b.usage.usd, 0.00004);
  const md = b.section((c) => `${c.path}#${c.start}`);
  assert.match(md, /you kick it \(new\)/);
  assert.match(md, /✗ \*\*Shut\*\* breaks in door: “The door shuts\.”\n  1\. shut\n  2\. you kick it: open/);
  assert.match(md, /\| You open the door\. \| src\/door\.js#1 \| ✓ \|/);
});

test('runBehavior: without --trust-atlas no model runs, and the section says how to run them', async () => {
  const { repo, git, put, base, tools } = fakeRepo();
  put('src/door.js', 'function open() { lock(); }\nfunction shut() {}\n');
  const b = await runBehavior({ root: repo, git, base: { sha: base, how: 'test' }, trust: false, ask: asks({ 'You open the door.': 'error' }), tools });
  assert.deepEqual(b.runs, []);
  assert.deepEqual(b.findings.map((f) => f.kind), ['not-run', 'rule', 'step']);
  assert.match(b.findings[0].why, /--trust-atlas/);
  assert.equal(b.findings[1].status, 'unchecked');
  assert.equal(b.findings[2].verdict, 'unchecked');
  assert.match(b.section((c) => c.path), /models not run: pass --trust-atlas on your own repo/);
});

test('runBehavior: a model that fails at head is an error; no atlas, no base and an untouched model each say so', async () => {
  const { repo, git, put, spec, base, tools } = fakeRepo();
  put('.atlas/models/door/Door.tla', spec({ exit: 2 }));
  const b = await runBehavior({ root: repo, git, base: { sha: base, how: 'test' }, trust: true, ask: asks({}), tools });
  const err = b.findings.find((f) => f.kind === 'run');
  assert.equal(err.side, 'head');
  assert.match(err.error, /parse error/);

  const clean = fakeRepo();
  clean.put('README.md', 'docs\n');
  const quiet = await runBehavior({ root: clean.repo, git: clean.git, base: { sha: clean.base, how: 'test' }, trust: true, ask: asks({}), tools: clean.tools });
  assert.deepEqual(quiet.findings.map((f) => `${f.kind}:${f.status}`), ['rule:untouched']);

  const bare = mkdtempSync(join(tmpdir(), 'bare-'));
  execFileSync('git', ['-C', bare, 'init', '-q']);
  const none = await runBehavior({ root: bare, git: (...a) => execFileSync('git', ['-C', bare, ...a], { encoding: 'utf8' }), base: { sha: null, how: 'no base commit: pass --base <ref>' }, trust: true, tools });
  assert.deepEqual(none.findings.map((f) => `${f.kind}:${f.status}`), ['atlas:absent']);
  assert.match(none.section(() => ''), /No `\.atlas\/` here/);
});

// A missing marker never widens a step to the end of its file, and never hides as a bare "—".
test('runBehavior: a model step whose marker is missing is unchecked, naming the step, its file and the marker', async () => {
  const { repo, git, put, base, tools } = fakeRepo();
  const json = JSON.parse(readFileSync(join(repo, '.atlas/models/door/model.json'), 'utf8'));
  json.steps = [
    { action: 'Open', label: 'You open the door.', sources: [{ path: 'src/door.js', from: 'function open', to: 'function close' }] },
    { action: 'Shut', label: 'You shut the door.', sources: [{ path: 'src/door.js', from: 'function slam', to: '' }] },
    { action: 'Lock', label: 'You lock the door.', sources: [{ path: 'src/lock.js', from: 'function lock', to: '' }] },
  ];
  put('.atlas/models/door/model.json', JSON.stringify(json));
  let asked = 0;
  const b = await runBehavior({ root: repo, git, base: { sha: base, how: 'test' }, trust: true, ask: async (req) => { asked++; return asks({})(req); }, tools });
  const steps = b.findings.filter((f) => f.kind === 'step');
  assert.deepEqual(steps.map((s) => [s.id, s.verdict, s.error]), [
    ['Open', 'unchecked', 'src/door.js: `to` marker “function close” not found after `from`'],
    ['Shut', 'unchecked', 'src/door.js: `from` marker “function slam” not found'],
    ['Lock', 'unchecked', 'src/lock.js: no such file at head'],
  ]);
  assert.equal(asked, 0, 'Jev is not asked about a step with no code');
  const md = b.section((c) => c.path);
  assert.match(md, /\| You open the door\. \| ⚠ src\/door\.js: `to` marker “function close” not found after `from` \| — \|/);
  assert.match(md, /\| You shut the door\. \| ⚠ src\/door\.js: `from` marker “function slam” not found \| — \|/);
});

// With no rules.md the models still check their invariants, and a break is still a break, with its path.
test('ruleFindings: with no rules.md, a touched model’s invariants are findings; a break keeps its path', () => {
  const runs = [{ model: 'card-money', side: 'head', holds: ['BudgetFirst'], breaks: [{ rule: 'SpendShows', path: ['a', 'go: b'] }] }];
  const f = ruleFindings({ rules: null, runs, models: [{ name: 'card-money', rules: ['SpendShows', 'BudgetFirst'] }], touched: ['card-money'] });
  assert.deepEqual(f, [
    { kind: 'extra-rule', model: 'card-money', name: 'SpendShows', status: 'breaks', path: ['a', 'go: b'] },
    { kind: 'extra-rule', model: 'card-money', name: 'BudgetFirst', status: 'holds' },
  ]);
});

test('runBehavior: no rules.md still reports the broken invariant, with its path, and says rules.md is missing', async () => {
  const { repo, git, put, spec, chart, base, tools } = fakeRepo();
  rmSync(join(repo, '.atlas/rules.md'));
  put('.atlas/models/door/Door.tla', spec({ exit: 1, report: '# Door\n\n## Shut breaks\nThe shortest path has 1 step:\n0. shut\n1. you kick it: open\n\n## Rules that hold\nNoDeadlock\n',
    chart: chart('  s0 --> s1: you kick it\n') }));
  const b = await runBehavior({ root: repo, git, base: { sha: base, how: 'test' }, trust: true, ask: asks({}), tools });
  assert.deepEqual(b.findings.map((f) => `${f.kind}:${f.status ?? f.changed ?? f.verdict}:${f.name || ''}`),
    ['atlas:no-rules:', 'rules-changed:undefined:', 'extra-rule:breaks:Shut', 'delta:true:', 'step:pass:']);
  assert.deepEqual(b.findings[2].path, ['shut', 'you kick it: open']);
  const md = b.section((c) => c.path);
  assert.match(md, /No `\.atlas\/rules\.md`/);
  assert.match(md, /- ✗ \*\*Shut\*\* breaks in door \(not one of your rules\)\n  1\. shut\n  2\. you kick it: open/);
});

test('runBehavior: rules.md text that isn’t a rule is a finding the section shows', async () => {
  const { repo, git, put, base, tools } = fakeRepo();
  put('.atlas/rules.md', '## Shut\nThe door shuts.\n\n## Stays Shut\nIt stays shut at night.\n');
  const b = await runBehavior({ root: repo, git, base: { sha: base, how: 'test' }, trust: true, ask: asks({}), tools });
  const p = b.findings.filter((f) => f.kind === 'rules-problem');
  assert.deepEqual(p, [{ kind: 'rules-problem', text: 'rules.md: line 4 `## Stays Shut` is not a rule heading (## Name, one word)' }]);
  assert.match(b.section(() => ''), /⚠ rules\.md: line 4 `## Stays Shut` is not a rule heading \(## Name, one word\)/);
});

test('runBehavior: a malformed model.json is an error naming the model and the field, and TLC never runs', async () => {
  const { repo, git, put, base } = fakeRepo();
  const marks = mkdtempSync(join(tmpdir(), 'sc-marks-'));
  const statechart = join(marks, 'statechart');
  writeFileSync(statechart, `#!/bin/sh\ntouch '${join(marks, 'ran')}'\nexit 2\n`);
  chmodSync(statechart, 0o755);
  put('.atlas/models/door/model.json', JSON.stringify({ spec: 'Door.tla', config: 'Door.cfg', code: 'src/door.js', steps: [] }));
  for (const trust of [true, false]) {
    const b = await runBehavior({ root: repo, git, base: { sha: base, how: 'test' }, trust, ask: asks({}), tools: { statechart, env: process.env } });
    const run = b.findings.find((f) => f.kind === 'run');
    assert.deepEqual(run, { kind: 'run', model: 'door', side: 'head', error: '.atlas/models/door/model.json: `code` must be an array of paths (strings)' }, `trust ${trust}`);
    assert.ok(!b.findings.some((f) => f.kind === 'not-run' && f.models.includes('door')), `trust ${trust}`);
    assert.match(b.section(() => ''), /#### door\n\nDidn’t run at head: \.atlas\/models\/door\/model\.json: `code` must be an array/);
  }
  assert.ok(!existsSync(join(marks, 'ran')), 'statechart ran on a malformed model');
});

test('order keeps finding kinds it doesn’t know, after the ones it does', () => {
  const f = [{ kind: 'something-new', x: 1 }, { kind: 'uncovered', path: 'a.js' }, { kind: 'atlas', status: 'no-rules' }, { kind: 'later' }];
  assert.deepEqual(order(f).map((x) => x.kind), ['atlas', 'uncovered', 'something-new', 'later']);
});

const SPEC = `---- MODULE Order ----
VARIABLES state, charged
Init == state = "cart" /\\ charged = FALSE

\\* The user's rules.
ShipsPaid == state = "shipped" => charged   \\* only once paid
NoKeptMoney ==
  state \\in {"refunded", "cancelled"}
    => ~charged
Inv(x) == x
====
`;

test('a TLA+ definition is its text up to the next definition, without comments or spacing', () => {
  assert.equal(tlaDefinition(SPEC, 'ShipsPaid'), 'ShipsPaid == state = "shipped" => charged');
  assert.equal(tlaDefinition(SPEC, 'NoKeptMoney'), 'NoKeptMoney == state \\in {"refunded", "cancelled"} => ~charged');
  assert.equal(tlaDefinition(SPEC, 'Inv'), 'Inv(x) == x');
  assert.equal(tlaDefinition(SPEC, 'Ships'), null);
  assert.equal(tlaDefinition(SPEC.replace('charged   \\* only once paid', 'charged (* same *)'), 'ShipsPaid'), tlaDefinition(SPEC, 'ShipsPaid'));
});

const atlasOf = ({ rules = '## ShipsPaid\nShips only once paid.\n\n## NoKeptMoney\nKeeps no money.\n', spec = SPEC, cfg = 'INIT Init\nNEXT Next\nINVARIANT ShipsPaid\nINVARIANT NoKeptMoney\n', models = ['order'] } = {}) => atlasFrom({
  ...(rules != null && { '.atlas/rules.md': rules }),
  ...Object.fromEntries(models.flatMap((m) => [
    [`.atlas/models/${m}/model.json`, JSON.stringify({ spec: 'Order.tla', config: 'Order.cfg', code: [`src/${m}.js`], steps: [] })],
    [`.atlas/models/${m}/Order.tla`, spec], [`.atlas/models/${m}/Order.cfg`, cfg],
  ])),
  'src/x.js': '',
});

test('atlasChanges: the user’s rules added, removed and reworded when rules.md changed', () => {
  const head = atlasOf({ rules: '## ShipsPaid\nShips only once paid, always.\n\n## Fast\nShips fast.\n' });
  assert.deepEqual(atlasChanges({ before: atlasOf(), head, changed: ['.atlas/rules.md'] }),
    [{ kind: 'rules-changed', added: ['Fast'], removed: ['NoKeptMoney'], reworded: ['ShipsPaid'] }]);
  assert.deepEqual(atlasChanges({ before: atlasOf(), head: atlasOf({ rules: '# Mine\n\n## ShipsPaid\nShips only once paid.\n\n## NoKeptMoney\nKeeps no money.\n' }), changed: ['.atlas/rules.md'] }),
    [{ kind: 'rules-changed', added: [], removed: [], reworded: [] }]);
  assert.deepEqual(atlasChanges({ before: atlasOf(), head: atlasOf(), changed: ['src/order.js'] }), []);
});

test('atlasChanges: an invariant whose definition changed, even to TRUE; a new one is not a change', () => {
  const weak = atlasOf({ spec: SPEC.replace('ShipsPaid == state = "shipped" => charged', 'ShipsPaid == TRUE') });
  assert.deepEqual(atlasChanges({ before: atlasOf(), head: weak, changed: ['.atlas/models/order/Order.tla'] }),
    [{ kind: 'rule-redefined', model: 'order', name: 'ShipsPaid' }]);
  const added = atlasOf({ spec: SPEC.replace('Inv(x) == x', 'Inv(x) == x\nPaidHasMoney == state = "paid" => charged'), cfg: 'INIT Init\nNEXT Next\nINVARIANT ShipsPaid\nINVARIANT NoKeptMoney\nINVARIANT PaidHasMoney\n' });
  assert.deepEqual(atlasChanges({ before: atlasOf(), head: added, changed: ['.atlas/models/order/Order.tla'] }), []);
  // A rule the user named is compared even when the config no longer checks it.
  const dropped = atlasOf({ spec: SPEC.replace('=> ~charged', '=> TRUE'), cfg: 'INIT Init\nNEXT Next\nINVARIANT ShipsPaid\n' });
  assert.deepEqual(atlasChanges({ before: atlasOf(), head: dropped, changed: ['.atlas/models/order/Order.tla'] }),
    [{ kind: 'rule-redefined', model: 'order', name: 'NoKeptMoney' }]);
});

test('atlasChanges: a rule weakened through an operator it calls is redefined; an unrelated operator is not', () => {
  const viaHelper = (paid, other = 'Other == 1') => atlasOf({ spec: SPEC.replace('ShipsPaid == state = "shipped" => charged', `Paid == ${paid}\n${other}\nShipsPaid == state = "shipped" => Paid`) });
  assert.deepEqual(atlasChanges({ before: viaHelper('charged'), head: viaHelper('TRUE'), changed: ['.atlas/models/order/Order.tla'] }),
    [{ kind: 'rule-redefined', model: 'order', name: 'ShipsPaid' }]);
  for (const lead of ['  ', 'LOCAL ']) {
    const shaped = (paid) => atlasOf({ spec: SPEC.replace('ShipsPaid == state = "shipped" => charged', `${lead}Paid == ${paid}\nShipsPaid == state = "shipped" => Paid`) });
    assert.deepEqual(atlasChanges({ before: shaped('charged'), head: shaped('TRUE'), changed: ['.atlas/models/order/Order.tla'] }),
      [{ kind: 'rule-redefined', model: 'order', name: 'ShipsPaid' }], `a helper written as "${lead}Paid =="`);
  }
  assert.deepEqual(atlasChanges({ before: viaHelper('charged'), head: viaHelper('charged', 'Other == 2'), changed: ['.atlas/models/order/Order.tla'] }), []);
});

test('atlasChanges: a removed model, and a removed .atlas/, are named', () => {
  assert.deepEqual(atlasChanges({ before: atlasOf({ models: ['order', 'cart'] }), head: atlasOf(), changed: ['.atlas/models/cart/model.json'] }),
    [{ kind: 'model-removed', model: 'cart' }]);
  assert.deepEqual(atlasChanges({ before: atlasOf(), head: null, changed: ['.atlas/rules.md', '.atlas/models/order/model.json'] }), [
    { kind: 'atlas', status: 'removed' },
    { kind: 'rules-changed', added: [], removed: ['ShipsPaid', 'NoKeptMoney'], reworded: [] },
    { kind: 'model-removed', model: 'order' },
  ]);
});

test('runBehavior: a removed model is named, never run or charted, and the rules only it checked go unchecked', async () => {
  const { repo, git, base, tools } = fakeRepo();
  rmSync(join(repo, '.atlas/models/door'), { recursive: true });
  const b = await runBehavior({ root: repo, git, base: { sha: base, how: 'test' }, trust: true, ask: asks({}), tools });
  assert.deepEqual(b.runs, []);
  assert.deepEqual(b.findings.map((f) => `${f.kind}:${f.model ?? ''}:${f.status ?? ''}`), ['model-removed:door:', 'rule::unchecked']);
  assert.doesNotMatch(b.section(() => ''), /#### door/);
});
