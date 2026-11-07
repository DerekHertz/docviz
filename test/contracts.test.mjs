// helper/contracts.js: what counts as evidence for a contract, and what never does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { contractFindings, digest, harnessDigest, isExecuted, judge, parseProfile, runHarness } from '../helper/contracts.js';
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
