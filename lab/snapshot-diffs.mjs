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
const MAX_HUNK_CHARS = 12_000; // about 3k tokens a file

const src = JSON.parse(readFileSync(join(LAB, 'fixtures', 'domain-diffs.src.json'), 'utf8'));
const out = src.map((d) => {
  const raw = execFileSync('git', ['-c', 'core.fsmonitor=', '-c', 'core.hooksPath=/dev/null', '-C', join(base, d.repo), 'show', '--format=', '-U3', d.sha, '--', d.file], { encoding: 'utf8' });
  const lines = raw.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
  const diff = lines.slice(0, MAX_LINES).join('\n') + (lines.length > MAX_LINES ? `\n… (${lines.length - MAX_LINES} more changed lines)` : '');
  // Complete hunks with their context lines, whole hunks only, for the v2 questions.
  const all = raw.split(/\n(?=@@ )/).filter((h) => h.startsWith('@@ '));
  const hunks = [];
  let used = 0;
  for (const h of all) {
    if (used + h.length > MAX_HUNK_CHARS && hunks.length) { hunks.push(`… ${all.length - hunks.length} more hunks omitted`); break; }
    hunks.push(h.trimEnd());
    used += h.length;
  }
  console.log(`${d.repo} ${d.sha} ${d.file}: ${lines.length} changed lines, ${all.length} hunks`);
  return { ...d, id: `${d.repo}:${d.sha}:${d.file}`, diff, hunks };
});
writeFileSync(join(LAB, 'fixtures', 'domain-diffs.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`${out.length} changes → lab/fixtures/domain-diffs.json`);
