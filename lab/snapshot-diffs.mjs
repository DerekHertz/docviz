#!/usr/bin/env node
// Freezes real file changes into a lab fixture for the protection-domain experiments: each
// file's diff at its commit (changed lines only, capped). Public repos only, so the fixture
// is committed.   node lab/snapshot-diffs.mjs [repos-dir]   (default: the parent of this checkout)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LAB = new URL('.', import.meta.url).pathname;
const base = process.argv[2] || join(LAB, '..', '..');
const MAX_LINES = 120;

const src = JSON.parse(readFileSync(join(LAB, 'fixtures', 'domain-diffs.src.json'), 'utf8'));
const out = src.map((d) => {
  const raw = execFileSync('git', ['-C', join(base, d.repo), 'show', '--format=', d.sha, '--', d.file], { encoding: 'utf8' });
  const lines = raw.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
  const diff = lines.slice(0, MAX_LINES).join('\n') + (lines.length > MAX_LINES ? `\n… (${lines.length - MAX_LINES} more changed lines)` : '');
  console.log(`${d.repo} ${d.sha} ${d.file}: ${lines.length} changed lines`);
  return { ...d, id: `${d.repo}:${d.sha}:${d.file}`, diff };
});
writeFileSync(join(LAB, 'fixtures', 'domain-diffs.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`${out.length} changes → lab/fixtures/domain-diffs.json`);
