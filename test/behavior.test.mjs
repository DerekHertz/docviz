// Behavior and rules: statechart on each touched model at base and head, the change between them,
// and each of the user's rules holding or breaking. TLC itself is faked here (a script that writes
// what statechart writes); the fixture tests run the real one when it is installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseChart, parseReport, delta, markChart, ruleFindings, behaviorSection, runBehavior, isSource } from '../helper/behavior.js';
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
