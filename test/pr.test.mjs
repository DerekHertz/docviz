// `docviz pr`: one diagram of a PR's main flow, with code links and its cost.
// The CLI is faked on PATH, so this runs the whole command without a model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cut, missingSteps, repoWebUrl, prComment, sumUsage, MARKER } from '../helper/pr.js';
import { prCardPrompt } from '../helper/prompts.js';

const CLI = resolve('helper/cli.js');

test('cut keeps the text between markers and its 1-based line range', () => {
  const text = 'a\nb\nfunction go() {\n  run();\n}\nfunction stop() {}\n';
  assert.deepEqual(cut(text, 'function go', 'function stop'),
    { text: 'function go() {\n  run();\n}\n', start: 3, end: 5 });
  assert.equal(cut(text, '', '').start, 1);
  assert.throws(() => cut(text, 'nope', ''), /marker not found: nope/);
});

test('repo urls become https links', () => {
  assert.equal(repoWebUrl('git@github.com:o/r.git'), 'https://github.com/o/r');
  assert.equal(repoWebUrl('https://github.com/o/r.git'), 'https://github.com/o/r');
});

test('missing steps are the ids the diagram never draws', () => {
  assert.deepEqual(missingSteps([{ id: 'pick' }, { id: 'search' }], 'flowchart TD\n  pick --> collect'), ['search']);
});

test('the PR prompt carries the steps, what is new, the PR rules and the glossary', () => {
  const steps = [{ id: 'pick', label: 'Pick forums', changed: true, cuts: [{ path: 'src/a.js', start: 1, end: 2, text: 'CODE' }] }];
  const job = prCardPrompt({ page: { title: 'o/r#1' }, steps, glossary: 'Seed: the word a Member enters' });
  assert.match(job.system, /one diagram on a pull request/);
  assert.match(job.system, /CONCEPT depth/);
  assert.match(job.system, /STYLE strict/);
  assert.match(job.system, /Seed: the word a Member enters/);
  assert.match(job.prompt, /STEP pick: Pick forums \(NEW in this PR\)/);
  assert.match(job.prompt, /\/\/ src\/a\.js:1-2\nCODE/);
});

test('usage adds up, and an estimate stays an estimate', () => {
  assert.deepEqual(sumUsage([{ usd: 0.03, estimated: false }, { usd: 0.01, estimated: true }]), { usd: 0.04, estimated: true });
});

test('the comment links each step to its lines and shows the cost', () => {
  const body = prComment({
    card: { caption: 'CAP', mermaid: 'flowchart TD\n  pick:::changed\n' },
    steps: [{ label: 'Pick forums', changed: true, cuts: [{ path: 'src/a.js', start: 3, end: 9 }] }],
    sha: 'abcdef1234567', repoUrl: 'https://github.com/o/r', usage: { usd: 0.04, estimated: true },
    checked: false, version: 'v1',
  });
  assert.ok(body.startsWith(MARKER));
  assert.match(body, /\| Pick forums \| new \| \[`src\/a\.js:3-9`\]\(https:\/\/github\.com\/o\/r\/blob\/abcdef1234567\/src\/a\.js#L3-L9\) \|/);
  assert.match(body, /orange border/);
  assert.match(body, /~\$0\.04/);
  assert.match(body, /not syntax-checked/);
});

test('docviz pr runs the CLI once and prints the comment with its cost', () => {
  const bin = mkdtempSync(join(tmpdir(), 'fake-claude-'));
  const card = { sectionId: 'pr', kind: 'flow', title: 'T', mermaid: 'flowchart TD\n  pick["Pick forums"]:::changed\nclassDef changed stroke:#d29922,stroke-width:3px', caption: 'CAP', question: '', interactive: false, picture: '' };
  writeFileSync(join(bin, 'out.json'), JSON.stringify({ structured_output: card, total_cost_usd: 0.031, usage: { input_tokens: 10, output_tokens: 5 } }));
  writeFileSync(join(bin, 'claude'), `#!/bin/sh
cat >/dev/null
cat '${join(bin, 'out.json')}'
`);
  chmodSync(join(bin, 'claude'), 0o755);

  const repo = mkdtempSync(join(tmpdir(), 'pr-repo-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  git('init', '-q');
  git('remote', 'add', 'origin', 'git@github.com:o/r.git');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'a.js'), 'x\nfunction pick() {}\nfunction later() {}\n');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  writeFileSync(join(repo, 'steps.json'), JSON.stringify({ steps: [
    { id: 'pick', label: 'Pick forums', changed: true, sources: [{ path: 'src/a.js', from: 'function pick', to: 'function later' }] },
  ] }));

  const res = spawnSync('node', [CLI, 'pr', 'steps.json', '--pr', 'https://github.com/o/r/pull/1', '--provider', 'claude'], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(res.stdout.startsWith(MARKER));
  assert.match(res.stdout, /CAP/);
  assert.match(res.stdout, /pick\["Pick forums"\]:::changed/);
  assert.match(res.stdout, new RegExp(`blob/${git('rev-parse', 'HEAD')}/src/a\\.js#L2-L2`));
  assert.match(res.stdout, /cost \$0\.03\./);
  assert.match(res.stderr, /\$0\.03/);
});
