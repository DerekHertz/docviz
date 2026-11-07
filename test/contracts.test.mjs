// helper/contracts.js: what counts as evidence for a contract, and what never does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { contractFindings, digest, harnessDigest, isExecuted, judge, loadProfile, parseProfile, runHarness } from '../helper/contracts.js';
import { verdict } from '../helper/verdict.js';

const [contract] = parseProfile(readFileSync('test/fixtures/contracts/card-spend.json', 'utf8'));

function repoWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docviz-contracts-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q'); g('config', 'user.email', 't@example.test'); g('config', 'user.name', 't');
  for (const [p, text] of Object.entries(files)) { mkdirSync(join(dir, dirname(p)), { recursive: true }); writeFileSync(join(dir, p), text); }
  g('add', '-A'); g('commit', '-qm', 'x');
  const head = g('rev-parse', 'HEAD').trim();
  return { gitRaw: (...a) => g(...a), gitBuffer: (...a) => execFileSync('git', a, { cwd: dir }), binding: { repositoryRoot: head, base: 'b'.repeat(40), head } };
}
const extension = () => ({ 'package.json': '{ "type": "module" }\n',
  ...Object.fromEntries(readdirSync('extension').filter((f) => f.endsWith('.js')).map((f) => [`extension/${f}`, readFileSync(join('extension', f), 'utf8')])) });

const target = repoWith(extension());
const executed = runHarness(contract, target);
const facts = (over = {}) => ({
  binding: target.binding, changedPaths: ['extension/background.js'],
  anchors: [{ id: 'dismiss', path: 'extension/background.js', start: 10, end: 20 }], governing: [{ path: 'CLAUDE.md', resolved: true }],
  cuts: [], evidence: executed, currentHarness: harnessDigest('card-spend'), ...over,
});
const status = (o) => [o.status, o.reason];

test('the runner’s own record of this code is executed evidence of the late-return gap', () => {
  assert.ok(isExecuted(executed));
  assert.equal(executed.outcome, 'fails', executed.detail);
  assert.deepEqual(status(judge(contract, facts())), ['violated', 'executed-fails']);
});

test('a copied or forged record is reported, never a pass or a violation, even with a recomputed digest', () => {
  for (const outcome of ['holds', 'fails']) {
    const { id, ...payload } = JSON.parse(JSON.stringify(executed));
    const forged = { ...payload, outcome, id: digest({ ...payload, outcome }) };
    const o = judge(contract, facts({ evidence: forged }));
    assert.deepEqual(status(o), ['unverified', 'reported-only'], outcome);
    assert.equal(o.evidence.provenance, 'reported');
  }
});

test('evidence bound to another repository, head, base, definition or harness is stale', () => {
  const b = target.binding;
  assert.deepEqual(status(judge(contract, facts({ binding: { ...b, repositoryRoot: 'c'.repeat(40) } }))), ['stale', 'other-repository']);
  assert.deepEqual(status(judge(contract, facts({ binding: { ...b, head: 'd'.repeat(40) } }))), ['stale', 'other-head']);
  assert.deepEqual(status(judge(contract, facts({ binding: { ...b, base: 'e'.repeat(40) } }))), ['stale', 'other-base']);
  assert.deepEqual(status(judge({ ...contract, expectation: 'The ledger records it' }, facts())), ['stale', 'definition-changed']);
  assert.deepEqual(status(judge(contract, facts({ currentHarness: 'f'.repeat(64) }))), ['stale', 'harness-changed']);
});

test('each obligation records the harness its contract selected, so a stored record can be checked against it', () => {
  assert.deepEqual(judge(contract, facts()).check, { harness: 'card-spend', digest: harnessDigest('card-spend') });
  const { check: _, ...unchecked } = contract;
  assert.equal(judge(unchecked, facts({ evidence: null, currentHarness: null })).check, null);
});

test('evidence for another contract checks nothing here', () => {
  const other = { ...contract, id: 'something-else' };
  assert.deepEqual(status(judge(other, facts())), ['unverified', 'unrelated-evidence']);
});

test('no evidence, no harness, or no base is uncertainty, never a violation', () => {
  assert.deepEqual(status(judge(contract, facts({ evidence: null }))), ['unverified', 'not-trusted']);
  assert.deepEqual(status(judge(contract, facts({ evidence: null, noRun: 'trust-other-head' }))), ['unverified', 'trust-other-head']);
  const { check, ...unchecked } = contract;
  assert.deepEqual(status(judge(unchecked, facts({ evidence: null }))), ['unverified', 'no-harness']);
  const noBase = judge(contract, facts({ evidence: null, binding: { ...target.binding, base: null } }));
  assert.deepEqual([...status(noBase), noBase.applicability.applies], ['unverified', 'not-trusted', null]);
});

test('code the harness can’t drive, or a harness that breaks, is uncertainty', () => {
  const files = extension();
  delete files['extension/sidepanel.js'];
  const bare = repoWith(files);
  const inapplicable = runHarness(contract, bare);
  assert.equal(inapplicable.outcome, 'inapplicable');
  assert.deepEqual(status(judge(contract, facts({ binding: bare.binding, evidence: inapplicable }))), ['unverified', 'surface-missing']);
  const broken = repoWith({ 'package.json': '{ "type": "module" }\n', 'extension/background.js': 'throw new Error("boom")\n', 'extension/sidepanel.js': 'const page = 0;\n' });
  const error = runHarness(contract, broken);
  assert.equal(error.outcome, 'error');
  assert.deepEqual(status(judge(contract, facts({ binding: broken.binding, evidence: error }))), ['unverified', 'harness-error']);
});

// The reviewed code runs with execution trust, but what it says about itself is not evidence.
const withPrefix = (prefix) => { const files = extension(); files['extension/background.js'] = prefix + files['extension/background.js']; return repoWith(files); };

test('reviewed code that prints a passing result and exits while it loads is a harness error, never a pass', () => {
  const repo = withPrefix(`process.stdout.write(JSON.stringify({ outcome: 'holds', observed: {}, path: [], scope: 'self-reported', detail: 'self-reported by the reviewed code' }));\nprocess.exit(0);\n`);
  const forged = runHarness(contract, repo);
  assert.equal(forged.outcome, 'error', forged.detail);
  assert.doesNotMatch(forged.detail, /self-reported/);
  assert.deepEqual(status(judge(contract, facts({ binding: repo.binding, evidence: forged }))), ['unverified', 'harness-error']);
});

test('reviewed code that rewrites the harness’s report from inside its own process can’t change what docviz observed', () => {
  const rewrite = `const write = process.stdout.write.bind(process.stdout);\nprocess.stdout.write = (s, ...a) => write(String(s).replace('"outcome":"fails"', '"outcome":"holds"'), ...a);\n`;
  const r = runHarness(contract, withPrefix(rewrite));
  assert.equal(r.outcome, 'fails', r.detail);
  assert.equal(r.observed.unattributed, 1);
});

test('reviewed code that patches the globals a harness would compute with can’t change the observed totals', () => {
  const patch = `Array.prototype.reduce = function () { return 2; };\nJSON.stringify = ((s) => (v, ...a) => s(v && typeof v === 'object' && 'outcome' in v ? { ...v, outcome: 'holds' } : v, ...a))(JSON.stringify);\n`;
  const r = runHarness(contract, withPrefix(patch));
  assert.equal(r.outcome, 'fails', r.detail);
  assert.deepEqual([r.observed.chargedBeforeDismiss, r.observed.pageTotalAfter, r.observed.unattributed], [1, 0, 1]);
});

const withPage = (expr) => { const files = extension(); files['extension/sidepanel.js'] = files['extension/sidepanel.js'].replace(/const page = .*;/, `const page = ${expr};`); return repoWith(files); };

test('a side panel page total that reports its own values over the harness channel is not a form docviz computes, so nothing holds', () => {
  // Root's proof at 33d7a2d: this expression evaluates to 0 but sent totals that read holds. The second never
  // lets the genuine totals follow, so the forged ones are all the controller could read.
  for (const expr of [`(process.send({type:'totals',values:[0,1,1,0,1]}),0)`, `(process.send({type:'totals',values:[0,1,1,0,1]}),(() => { for (;;); })())`]) {
    const r = runHarness(contract, withPage(expr));
    assert.equal(r.outcome, 'inapplicable', `${expr}: ${r.outcome} ${r.detail}`);
    assert.match(r.detail, /page total/);
  }
});

test('a page total with anything beyond the supported sum is uncertainty, never evaluated', () => {
  for (const expr of [
    `cards.reduce((t, c) => t + (c.cost?.usd || 0), state.unassigned || 0) + (globalThis.x = 0)`,
    `cards.reduce((t, c) => t + (c.cost?.usd || 0), state.unassigned || 1)`,
    `cards.reduce((t, c) => c + (t.cost?.usd || 0), state.unassigned || 0)`,
    `state.paid`,
  ]) assert.equal(runHarness(contract, withPage(expr)).outcome, 'inapplicable', expr);
});

test('the supported page total is computed by docviz, whatever the reviewed code names its parameters', () => {
  const renamed = runHarness(contract, withPage(`cards.reduce( (sum,card)=>sum + ( card.cost?.usd||0 ),state.unassigned||0 )`));
  assert.deepEqual([renamed.outcome, renamed.observed.frames.map((f) => f.pageTotal)], ['fails', [0, 1, 1, 0, 0]]);
  const noUnassigned = runHarness(contract, withPage(`cards.reduce((t, c) => t + (c.cost?.usd || 0), 0)`));
  assert.equal(noUnassigned.outcome, 'fails', 'a page that leaves out unassigned spend is observed, not skipped');
});

test('reviewed background code that sends a result-shaped message or exits mid-scenario is a harness error', () => {
  for (const prefix of [
    `process.send({ outcome: 'holds' });\n`,
    `process.send({ type: 'totals', values: [0, 1, 1, 0, 1] });\n`,
    `const realFetch = globalThis.fetch;\nglobalThis.fetch = (...a) => { setTimeout(() => process.exit(0), 0); return realFetch(...a); };\n`,
  ]) {
    const r = runHarness(contract, withPrefix(prefix));
    assert.equal(r.outcome, 'error', `${prefix}: ${r.detail}`);
  }
});

test('the summary only annotates: citing or dropping steps never changes the status', () => {
  const anchors = [{ id: 'generate', path: 'extension/background.js', start: 1, end: 5 }, { id: 'dismiss', path: 'extension/background.js', start: 10, end: 20 }];
  const cited = judge(contract, facts({ anchors, cuts: [{ path: 'extension/background.js', start: 1, end: 4 }] }));
  const none = judge(contract, facts({ anchors, cuts: [] }));
  assert.deepEqual([cited.summary.cited, cited.summary.omitted], [['generate'], ['dismiss']]);
  assert.deepEqual([none.summary.cited, none.summary.omitted], [[], ['generate', 'dismiss']]);
  assert.equal(cited.status, none.status);
});

test('verdict: a violated contract is Needs you; unverified or stale is Look; held or untouched adds nothing', () => {
  const level = (o) => verdict(contractFindings({ obligations: [o] })).level;
  assert.equal(level(judge(contract, facts())), 'needs');
  assert.equal(level(judge(contract, facts({ evidence: null }))), 'look');
  assert.equal(level(judge(contract, facts({ binding: { ...target.binding, head: 'd'.repeat(40) } }))), 'look');
  assert.equal(level(judge(contract, facts({ changedPaths: ['README.md'] }))), 'nothing');
});

test('a profile can’t grant authority, results, or a command', () => {
  const p = JSON.parse(readFileSync(resolve('test/fixtures/contracts/card-spend.json'), 'utf8'));
  for (const patch of [{ authority: 'human-confirmed' }, { status: 'supported-in-scope' }, { evidence: [] }, { check: { harness: 'card-spend', path: '/bin/sh' } }]) {
    assert.throws(() => parseProfile(JSON.stringify({ ...p, contracts: [{ ...p.contracts[0], ...patch }] })), /contract profile/, JSON.stringify(patch));
  }
});

test('a profile anywhere inside the reviewed checkout is refused, whatever its name or link; outside siblings load', () => {
  const box = mkdtempSync(join(tmpdir(), 'docviz-boundary-'));
  const root = join(box, 'repo');
  const text = readFileSync('test/fixtures/contracts/card-spend.json', 'utf8');
  const put = (p) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); return p; };
  mkdirSync(root);
  const inside = /inside the reviewed checkout/;
  assert.throws(() => loadProfile(put(join(root, 'profile.json')), root), inside, 'plain file inside');
  assert.throws(() => loadProfile(put(join(root, '..profile.json')), root), inside, 'a name starting with .. is still inside');
  assert.throws(() => loadProfile(put(join(root, '..contracts', 'p.json')), root), inside, 'a folder starting with .. is still inside');
  symlinkSync(join(root, 'profile.json'), join(box, 'outside-link.json'));
  assert.throws(() => loadProfile(join(box, 'outside-link.json'), root), inside, 'an outside link to an inside file');
  const outside = put(join(box, 'repo-profiles', 'p.json'));
  symlinkSync(outside, join(root, 'inside-link.json'));
  assert.throws(() => loadProfile(join(root, 'inside-link.json'), root), inside, 'an inside link the author controls, even to an outside file');
  symlinkSync(root, join(box, 'repo-alias'));
  assert.throws(() => loadProfile(join(box, 'repo-alias', 'profile.json'), root), inside, 'the checkout reached through a linked path');
  assert.throws(() => loadProfile(join(root, 'profile.json'), join(box, 'repo-alias')), inside, 'a linked root');
  assert.equal(loadProfile(outside, root).contracts[0].id, 'card-spend-accounting', 'a sibling folder whose name starts with the checkout’s name is outside');
  assert.equal(loadProfile(put(join(box, '..profile.json')), root).contracts[0].id, 'card-spend-accounting', 'a ..-named file beside the checkout is outside');
});

test('the harness records the ledger, card and page total it observed at each action', () => {
  const frames = executed.observed.frames;
  assert.ok(Array.isArray(frames), 'observed.frames is recorded');
  assert.deepEqual(frames.map((f) => f.id), ['before-first-reply', 'after-failed-draw', 'after-retry-request', 'after-dismiss', 'after-late-return']);
  assert.deepEqual(frames.map((f) => f.ledgerPaid), [0, 1, 1, 1, 2]);
  assert.deepEqual(frames.map((f) => f.card.present), [true, true, true, false, false]);
  assert.deepEqual(frames.map((f) => f.card.cost), [null, 1, 1, null, null]);
  assert.deepEqual(frames.map((f) => f.pageTotal), [0, 1, 1, 0, 0]);
  assert.equal(frames[1].card.status, 'error');
  for (const f of frames) assert.ok(typeof f.action === 'string' && f.action, `${f.id} names its action`);
  const last = frames.at(-1);
  assert.deepEqual([executed.observed.ledgerPaid, executed.observed.pageTotalAfter], [last.ledgerPaid, last.pageTotal], 'final fields agree with the last frame');
});

test('recording frames changed the harness identity, so records from the earlier harness read stale', () => {
  const earlier = '7b798249a12a5959c932e0f2f09b70bdc5f66362eb59e237626657d96d899031'; // card-spend.mjs before frames
  assert.notEqual(earlier, harnessDigest('card-spend'));
  assert.equal(executed.harness.digest, harnessDigest('card-spend'));
  assert.deepEqual(status(judge(contract, facts({ currentHarness: earlier }))), ['stale', 'harness-changed']);
});
