#!/usr/bin/env node
// Freezes real commits into a lab fixture for P1 (does a PR say what it does?): the message as
// the PR description, and each changed file's diff (changed lines only, capped). Public repos
// only, so the fixture is committed.   node lab/snapshot-prs.mjs [repos-dir]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LAB = new URL('.', import.meta.url).pathname;
const base = process.argv[2] || join(LAB, '..', '..');
const MAX_FILES = 6;
const MAX_LINES = 150;
const MAX_HUNK_CHARS = 12_000; // about 3k tokens a file; jev-commit allows 4k
// The reviewed repos' git config is not ours: no hooks, no fsmonitor (as in docviz pr).
const git = (repo, ...a) => execFileSync('git', ['-c', 'core.fsmonitor=', '-c', 'core.hooksPath=/dev/null', '-C', repo, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const CODE_FIRST = (p) => (/(^|\/)(test|tests)\/|\.test\.|README|\.md$|\.json$/i.test(p) ? 1 : 0);

const src = JSON.parse(readFileSync(join(LAB, 'fixtures', 'pr-claims.src.json'), 'utf8'));
const out = src.map((pr) => {
  const repo = join(base, pr.repo);
  const message = git(repo, 'show', '-s', '--format=%B', pr.sha).split('\n').filter((l) => !/^co-authored-by:/i.test(l)).join('\n').trim();
  const files = git(repo, 'show', '--format=', '--name-only', pr.sha).split('\n').filter(Boolean)
    .sort((a, b) => CODE_FIRST(a) - CODE_FIRST(b)).slice(0, MAX_FILES);
  // Every changed file with its status and size, as jev-commit's file table: the whole PR at a glance.
  const status = Object.fromEntries(git(repo, 'show', '--format=', '--name-status', pr.sha).split('\n').filter(Boolean).map((l) => l.split('\t')).map(([s, ...p]) => [p.at(-1), s[0]]));
  const table = git(repo, 'show', '--format=', '--numstat', pr.sha).split('\n').filter(Boolean).map((l) => l.split('\t'))
    .map(([a, r, path]) => ({ path, status: status[path] || 'M', added: Number(a) || 0, removed: Number(r) || 0 }));
  const diffs = files.map((file) => {
    const raw = git(repo, 'show', '--format=', '-U3', pr.sha, '--', file);
    const lines = raw.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
    // Whole hunks with their context lines, whole hunks only, up to MAX_HUNK_CHARS per file.
    const hunks = [];
    let used = 0;
    for (const h of raw.split(/\n(?=@@ )/).filter((x) => x.startsWith('@@ '))) {
      if (used + h.length > MAX_HUNK_CHARS && hunks.length) { hunks.push(`… ${raw.split(/\n(?=@@ )/).filter((x) => x.startsWith('@@ ')).length - hunks.length} more hunks omitted`); break; }
      hunks.push(h.trimEnd());
      used += h.length;
    }
    return { file, diff: lines.slice(0, MAX_LINES).join('\n') + (lines.length > MAX_LINES ? `\n… (${lines.length - MAX_LINES} more changed lines)` : ''), hunks };
  });
  console.log(`${pr.repo} ${pr.sha}: ${files.length} files`);
  return { ...pr, id: `${pr.repo}:${pr.sha}`, message, table, files: diffs };
});
writeFileSync(join(LAB, 'fixtures', 'pr-claims.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`${out.length} commits → lab/fixtures/pr-claims.json`);
