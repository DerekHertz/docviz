// `docviz pr --lint`: the deterministic rules a calling agent's diagram must pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { lintCard } from '../helper/lint.js';
import { prCardPrompt, prAgentRules } from '../helper/prompts.js';

const CLI = resolve('helper/cli.js');

const steps = [
  { id: 'pick', label: 'Pick forums', changed: false },
  { id: 'rank', label: 'Rank the results', changed: true },
  { id: 'post', label: 'Post the comment', changed: true },
];
const mermaid = [
  'flowchart TD',
  '  pick["Pick forums"] --> rank["Rank the results"]:::changed',
  '  rank -->|fails| post["Post the comment"]:::changed',
  '  classDef changed stroke:#d29922,stroke-width:3px',
].join('\n');
const good = { caption: 'It ranks. It is cheap.', mermaid };
const withMermaid = (m) => ({ ...good, mermaid: m });

test('a good card has no errors', () => {
  assert.deepEqual(lintCard(steps, good), []);
});

test('a missing card, caption or mermaid is one error', () => {
  assert.deepEqual(lintCard(steps, undefined), ['steps.json has no card: { caption, mermaid }']);
  assert.deepEqual(lintCard(steps, { mermaid }), ['card.caption is empty']);
  assert.deepEqual(lintCard(steps, { caption: 'C' }), ['card.mermaid is empty']);
});

test('the diagram must be flowchart TD', () => {
  const errors = lintCard(steps, withMermaid(mermaid.replace('flowchart TD', 'flowchart LR')));
  assert.deepEqual(errors, ['the first line must be "flowchart TD", not "flowchart LR"']);
});

test('at most 6 nodes', () => {
  const extra = mermaid.replace('classDef', 'post --> e1["One"] --> e2["Two"] --> e3["Three"] --> e4["Four"]\n  classDef');
  assert.deepEqual(lintCard(steps, withMermaid(extra)).slice(0, 1), ['7 nodes; at most 6']);
});

test('a node that is no step is an error, since only step labels are checked', () => {
  const extra = mermaid.replace('classDef', 'post --> refused["Refused, nothing spent"]\n  classDef');
  assert.deepEqual(lintCard(steps, withMermaid(extra)), ['node refused is no step; only step labels are checked against the code']);
});

test('every step needs a node with its id', () => {
  const errors = lintCard(steps, withMermaid(mermaid.replace(/  rank -->\|fails\| post.*\n/, '')));
  assert.deepEqual(errors, ['step post has no node']);
});

test('a node label must equal its step label', () => {
  const errors = lintCard(steps, withMermaid(mermaid.replace('["Rank the results"]', '["Order them"]')));
  assert.deepEqual(errors, ['node rank says "Order them"; step label is "Rank the results"']);
});

test('a node without a quoted label is an error', () => {
  const errors = lintCard(steps, withMermaid(mermaid.replace('post["Post the comment"]', 'post')));
  assert.deepEqual(errors, ['node post has no quoted label; step label is "Post the comment"']);
});

test(':::changed goes on changed steps and only them', () => {
  const m = mermaid.replace('rank["Rank the results"]:::changed', 'rank["Rank the results"]')
    .replace('pick["Pick forums"]', 'pick["Pick forums"]:::changed');
  assert.deepEqual(lintCard(steps, withMermaid(m)), [
    'step pick is not changed but carries :::changed',
    'step rank is changed but has no :::changed',
  ]);
});

test('classDef sets no fill', () => {
  const errors = lintCard(steps, withMermaid(mermaid.replace('stroke:#d29922', 'fill:#fff,stroke:#d29922')));
  assert.deepEqual(errors, ['classDef sets fill (breaks dark mode): classDef changed fill:#fff,stroke:#d29922,stroke-width:3px']);
});

test('each failure is on its own line, and the CLI exits 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-'));
  const bad = mermaid.replace('flowchart TD', 'flowchart LR').replace('Rank the results"]', 'Order them"]');
  writeFileSync(join(dir, 'steps.json'), JSON.stringify({ steps, card: { caption: 'C', mermaid: bad } }));
  const res = spawnSync('node', [CLI, 'pr', '--lint', join(dir, 'steps.json')], { encoding: 'utf8' });
  assert.equal(res.status, 1);
  const lines = res.stdout.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /flowchart TD/);
  assert.match(lines[1], /Order them/);

  writeFileSync(join(dir, 'ok.json'), JSON.stringify({ steps, card: good }));
  const ok = spawnSync('node', [CLI, 'pr', '--lint', join(dir, 'ok.json')], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});

test('--rules prints the rules prCardPrompt sends, and the glossary when given', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rules-'));
  writeFileSync(join(dir, 'g.md'), 'Seed: the word a Member enters');
  const plain = spawnSync('node', [CLI, 'pr', '--rules'], { encoding: 'utf8' });
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stdout, prAgentRules('') + '\n');
  const withGlossary = spawnSync('node', [CLI, 'pr', '--rules', '--glossary', join(dir, 'g.md')], { encoding: 'utf8' });
  assert.equal(withGlossary.stdout, prAgentRules('Seed: the word a Member enters') + '\n');
  const sent = prCardPrompt({ page: {}, steps: [], glossary: 'Seed: the word a Member enters' }).system;
  for (const part of prAgentRules('Seed: the word a Member enters').split('\n\n')) assert.ok(sent.includes(part), `prCardPrompt lacks: ${part.slice(0, 40)}`);
});
