// Contract coverage through the real CLI: an operator-selected profile names obligations the author's
// summary can't delete, and only a harness docviz itself runs at the pinned head can show a violation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

const CLI = resolve('helper/cli.js');
const PROFILE = resolve('test/fixtures/contracts/card-spend.json');
const PR1_STEPS = resolve('test/fixtures/pr1/steps.json');
const FROZEN_FIXTURE = resolve('.claude/skills/verify-docviz/fixtures/pr1-card-money.json');
const PR1 = { base: '595f590ba2b69e90f73e14c0591be0ca3d8f97d7', head: '8967e5d3e193b84d62ae359f59ae37a0312014b3' };
const hasCommit = (sha) => spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`]).status === 0;
const pr1Skip = hasCommit(PR1.base) && hasCommit(PR1.head) ? false
  : 'PR1 objects absent: git fetch <docviz> refs/pull/1/head (8967e5d) first';

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'TYPESAFE_API_KEY'));
const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const temp = (name) => mkdtempSync(join(tmpdir(), `docviz-${name}-`));

function docviz(cwd, steps, ...flags) {
  const out = join(temp('coverage-out'), 'coverage.json');
  const res = spawnSync(process.execPath, [CLI, 'pr', steps, '--pr', 'https://example.test/pull/1', '--no-check', '--coverage-out', out, ...flags],
    { cwd, encoding: 'utf8', env, timeout: 60_000 });
  return { ...res, coverage: existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null };
}

const verdictLine = (body) => body.split('\n')[1];
const stepRows = (body) => body.split('\n').filter((l) => /^\| .* \| (new)? \| \[`/.test(l));

function pr1Checkout() {
  const dir = temp('pr1');
  g(dir, 'clone', '--quiet', '--shared', '--no-checkout', resolve('.'), '.');
  g(dir, 'checkout', '--quiet', '--detach', PR1.head);
  g(dir, 'remote', 'set-url', 'origin', 'https://github.com/DerekHertz/docviz.git');
  return dir;
}

// A different repository, origin, contract id and summary, built from this checkout's extension code.
const extensionFiles = () => Object.fromEntries(readdirSync('extension').filter((f) => f.endsWith('.js'))
  .map((f) => [`extension/${f}`, readFileSync(join('extension', f), 'utf8')]));
const fixLateReturn = (src) => {
  const fixed = src
    .replace("    const cur = await getCard(key);\n    // A new diagram", "    const cur = await getCard(key);\n    if (!cur) return unassign(rec.tabId, usage);\n    // A new diagram")
    .replace("    const cur = await getCard(key);\n    if (!cur) return;", "    const cur = await getCard(key);\n    if (!cur) return unassign(rec.tabId, e.usage);")
    .replace('async function dismiss(key) {', 'async function unassign(tabId, usage) {\n  if (!usage) return;\n  const state = await getTab(tabId);\n  state.unassigned = (state.unassigned || 0) + usage.usd;\n  await putTab(tabId, state);\n}\n\nasync function dismiss(key) {');
  assert.equal((fixed.match(/unassign\(/g) || []).length, 3, 'the late-return fix applies to this background.js');
  return fixed;
};

function otherRepo({ fixed = false } = {}) {
  const dir = temp('other');
  g(dir, 'init', '--quiet', '-b', 'trunk');
  g(dir, 'config', 'user.email', 't@example.test');
  g(dir, 'config', 'user.name', 't');
  g(dir, 'remote', 'add', 'origin', 'https://example.test/someone/notes-app.git');
  const write = (files) => { for (const [p, text] of Object.entries(files)) { mkdirSync(join(dir, dirname(p)), { recursive: true }); writeFileSync(join(dir, p), text); } };
  write({ 'README.md': '# notes\n', 'package.json': '{ "type": "module" }\n' });
  g(dir, 'add', '-A'); g(dir, 'commit', '--quiet', '-m', 'start');
  const base = g(dir, 'rev-parse', 'HEAD');
  const files = extensionFiles();
  if (fixed) files['extension/background.js'] = fixLateReturn(files['extension/background.js']);
  write(files);
  g(dir, 'add', '-A'); g(dir, 'commit', '--quiet', '-m', 'cards with costs');
  write({ 'docs/notes.md': 'unrelated\n' });
  g(dir, 'add', '-A'); g(dir, 'commit', '--quiet', '-m', 'docs only');
  const docsOnly = g(dir, 'rev-parse', 'HEAD');
  g(dir, 'checkout', '--quiet', 'HEAD~1');
  const head = g(dir, 'rev-parse', 'HEAD');
  return { dir, base, head, docsOnly };
}

function renamedProfile() {
  const p = JSON.parse(readFileSync(PROFILE, 'utf8'));
  p.contracts[0].id = 'spend-attribution';
  p.contracts[0].governing = [{ path: 'README.md', from: '# notes', to: '' }];
  const file = join(temp('profile'), 'profile.json');
  writeFileSync(file, JSON.stringify(p));
  return file;
}

function oneStep(dir) {
  const file = join(temp('steps'), 'steps.json');
  writeFileSync(file, JSON.stringify({
    steps: [{ id: 'draw', label: 'A selection becomes a card', changed: true,
      sources: [{ path: 'extension/background.js', from: 'export async function visualizeSelection(', to: '// ---------- per-card actions' }] }],
    card: { caption: 'Draw a card.', mermaid: 'flowchart TD\n  draw["A selection becomes a card"]:::changed\n  classDef changed stroke:#d29922,stroke-width:3px' },
  }));
  return file;
}

test('the committed PR1 summary is the frozen five-step input, byte for byte in its steps', { skip: !existsSync(FROZEN_FIXTURE) && 'frozen fixture absent' }, () => {
  const ours = JSON.parse(readFileSync(PR1_STEPS, 'utf8'));
  assert.deepEqual(ours.steps, JSON.parse(readFileSync(FROZEN_FIXTURE, 'utf8')).steps);
  assert.equal(ours.steps.length, 5);
  assert.ok(!ours.steps.some((s) => s.sources.some((src) => src.from.includes('dismiss'))), 'no step starts at dismiss; picture’s cut stops before it');
});

test('PR1: the unchanged five-step summary with an operator profile and a trusted head reads Needs you for the accounting contract', { skip: pr1Skip }, () => {
  const dir = pr1Checkout();
  try {
    const run = docviz(dir, PR1_STEPS, '--base', PR1.base, '--contracts', PROFILE, '--trust-head', PR1.head);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(verdictLine(run.stdout), '**Needs you**', run.stdout.slice(0, 800));
    assert.match(run.stdout, /- ✗ Every paid helper call stays attributed \(`card-spend-accounting`\)/);
    assert.equal(stepRows(run.stdout).length, 5, 'the author’s five steps stay as they were');
    assert.match(run.stdout, /### Contracts/);
    const c = run.coverage;
    assert.equal(c.head, PR1.head);
    assert.equal(c.base, PR1.base);
    assert.deepEqual(c.summary.stepIds, ['budget', 'ledger', 'redraw', 'blocked', 'picture']);
    const o = c.obligations[0];
    assert.equal(o.status, 'violated');
    assert.equal(o.reason, 'executed-fails');
    assert.equal(o.applicability.applies, true);
    assert.ok(o.applicability.touched.includes('extension/background.js'));
    assert.ok(o.summary.omittedBySummary);
    assert.ok(o.summary.omitted.includes('dismiss'));
    assert.ok(o.summary.cited.includes('callHelper'));
    assert.equal(o.authority.kind, 'operator-selected');
    assert.ok(o.authority.governing.every((x) => x.resolved && x.commit === PR1.head));
    assert.equal(o.evidence.provenance, 'executed-by-docviz');
    assert.equal(o.evidence.head, PR1.head);
    assert.equal(o.evidence.outcome, 'fails');
    assert.deepEqual(
      { paid: o.evidence.observed.ledgerPaid, before: o.evidence.observed.chargedBeforeDismiss, page: o.evidence.observed.pageTotalAfter, lost: o.evidence.observed.unattributed },
      { paid: 2, before: 1, page: 0, lost: 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('PR1 without trust: Look, the contract unverified and never a fabricated violation', { skip: pr1Skip }, () => {
  const dir = pr1Checkout();
  try {
    const run = docviz(dir, PR1_STEPS, '--base', PR1.base, '--contracts', PROFILE);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(verdictLine(run.stdout), '**Look when you can**');
    assert.match(run.stdout, /Contracts not checked at this head: .*`card-spend-accounting`/);
    const o = run.coverage.obligations[0];
    assert.deepEqual([o.status, o.reason, o.evidence], ['unverified', 'not-trusted', null]);
    assert.ok(o.summary.omitted.includes('dismiss'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('PR1 with trust naming another commit runs nothing', { skip: pr1Skip }, () => {
  const dir = pr1Checkout();
  try {
    const run = docviz(dir, PR1_STEPS, '--base', PR1.base, '--contracts', PROFILE, '--trust-head', PR1.base);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(verdictLine(run.stdout), '**Look when you can**');
    const o = run.coverage.obligations[0];
    assert.deepEqual([o.status, o.reason, o.evidence], ['unverified', 'trust-other-head', null]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('PR1: deleting summary steps changes only the omission note, never the obligation', { skip: pr1Skip }, () => {
  const dir = pr1Checkout();
  try {
    const doc = JSON.parse(readFileSync(PR1_STEPS, 'utf8'));
    doc.steps = doc.steps.filter((s) => s.id === 'picture');
    doc.card.mermaid = 'flowchart TD\n  picture["A picture is painted once per card text and never paid twice"]:::changed\n  classDef changed stroke:#d29922,stroke-width:3px';
    const file = join(temp('steps'), 'steps.json');
    writeFileSync(file, JSON.stringify(doc));
    const run = docviz(dir, file, '--base', PR1.base, '--contracts', PROFILE, '--trust-head', PR1.head);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(verdictLine(run.stdout), '**Needs you**');
    const o = run.coverage.obligations[0];
    assert.equal(o.status, 'violated');
    assert.deepEqual(o.summary.cited, []);
    assert.deepEqual(o.summary.omitted, ['callHelper', 'generate', 'dismiss', 'pageTotal']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a renamed repository and contract with the same late-return gap reads Needs you', () => {
  const r = otherRepo();
  const run = docviz(r.dir, oneStep(r.dir), '--base', r.base, '--contracts', renamedProfile(), '--trust-head', r.head);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(verdictLine(run.stdout), '**Needs you**');
  assert.match(run.stdout, /`spend-attribution`/);
  const o = run.coverage.obligations[0];
  assert.deepEqual([o.contractId, o.status, o.evidence.outcome, o.evidence.observed.unattributed], ['spend-attribution', 'violated', 'fails', 1]);
  assert.equal(run.coverage.repository.origin, 'https://example.test/someone/notes-app');
});

test('the same target with the late return charged to the page holds within the replayed scenario', () => {
  const r = otherRepo({ fixed: true });
  const run = docviz(r.dir, oneStep(r.dir), '--base', r.base, '--contracts', renamedProfile(), '--trust-head', r.head);
  assert.equal(run.status, 0, run.stderr);
  const o = run.coverage.obligations[0];
  assert.deepEqual([o.status, o.reason, o.evidence.outcome], ['supported-in-scope', 'executed-holds', 'holds']);
  assert.deepEqual([o.evidence.observed.ledgerPaid, o.evidence.observed.pageTotalAfter, o.evidence.observed.unattributed], [2, 1, 0]);
  assert.doesNotMatch(run.stdout.split('## How this PR works')[0], /spend-attribution/, 'a held contract adds no verdict reason');
  assert.notEqual(verdictLine(run.stdout), '**Needs you**');
});

test('a held scenario whose governing text can’t be found stays unverified, not supported', () => {
  const r = otherRepo({ fixed: true });
  const p = JSON.parse(readFileSync(renamedProfile(), 'utf8'));
  p.contracts[0].governing = [{ path: 'POLICY.md', from: '## Spend', to: '' }];
  const file = join(temp('profile'), 'profile.json');
  writeFileSync(file, JSON.stringify(p));
  const run = docviz(r.dir, oneStep(r.dir), '--base', r.base, '--contracts', file, '--trust-head', r.head);
  assert.equal(run.status, 0, run.stderr);
  const o = run.coverage.obligations[0];
  assert.deepEqual([o.status, o.reason, o.evidence.outcome, o.authority.governing[0].resolved], ['unverified', 'governing-source-missing', 'holds', false]);
  assert.match(run.stdout, /Contracts not checked at this head: `spend-attribution`/);
});

test('a change that touches none of the contract’s code is not applicable and runs nothing', () => {
  const r = otherRepo();
  g(r.dir, 'checkout', '--quiet', r.docsOnly);
  const run = docviz(r.dir, oneStep(r.dir), '--base', r.head, '--contracts', renamedProfile(), '--trust-head', r.docsOnly);
  assert.equal(run.status, 0, run.stderr);
  const o = run.coverage.obligations[0];
  assert.deepEqual([o.status, o.reason, o.applicability.applies, o.evidence], ['not-applicable', 'untouched', false, null]);
});

test('a profile that claims human authority, or names a command to run, is refused before any work', () => {
  const r = otherRepo();
  for (const patch of [{ authority: 'human-confirmed' }, { confirmedBy: 'Derek' }, { check: { harness: 'card-spend', argv: ['sh', '-c', 'true'] } }, { check: { harness: 'nope' } }]) {
    const p = JSON.parse(readFileSync(PROFILE, 'utf8'));
    Object.assign(p.contracts[0], patch);
    const file = join(temp('profile'), 'profile.json');
    writeFileSync(file, JSON.stringify(p));
    const run = docviz(r.dir, oneStep(r.dir), '--base', r.base, '--contracts', file, '--trust-head', r.head);
    assert.equal(run.status, 2, `${JSON.stringify(patch)} refused`);
    assert.match(run.stderr, /contract profile/i);
    assert.equal(run.coverage, null);
  }
});

test('a profile inside the reviewed checkout is the author’s text, so it is refused', () => {
  const r = otherRepo();
  const inside = join(r.dir, 'contracts.json');
  writeFileSync(inside, readFileSync(PROFILE, 'utf8'));
  const run = docviz(r.dir, oneStep(r.dir), '--base', r.base, '--contracts', inside, '--trust-head', r.head);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /inside the reviewed checkout/);
});
