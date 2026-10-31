#!/usr/bin/env node
// Freezes real PR steps into a lab fixture: each step's function at its repo's HEAD, plus the
// one-hop context docviz pr would attach. Rerun to refresh; the fixture is what the lab reads.
// Both fixture files describe code from private repos: they're gitignored, never committed.
//   node lab/snapshot-real.mjs [repos-dir]   (default: the parent of this checkout)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { definitionsCalled, contextText, langOf } from '../helper/context.js';

const LAB = new URL('.', import.meta.url).pathname;
const base = process.argv[2] || join(LAB, '..', '..');
const src = JSON.parse(readFileSync(join(LAB, 'fixtures', 'real-prs.src.json'), 'utf8'));

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** A top-level or nested function by name at HEAD, with its 1-based line range. */
function functionAt(lines, fn, lang) {
  const re = lang === 'py'
    ? new RegExp(`^\\s*(async\\s+)?def\\s+${fn}\\s*\\(`)
    : new RegExp(`^\\s*(export\\s+)?(default\\s+)?(async\\s+)?function\\s+${fn}\\s*[(<]`);
  const at = lines.findIndex((l) => re.test(l));
  if (at < 0) throw new Error(`${fn} not found`);
  const indent = lines[at].match(/^\s*/)[0].length;
  let end = at;
  if (lang === 'py') {
    for (let i = at + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      if (lines[i].match(/^\s*/)[0].length <= indent) break;
      end = i;
    }
  } else {
    while (end < lines.length - 1 && !(new RegExp(`^\\s{0,${indent}}}`).test(lines[end]) && end > at)) end++;
  }
  return { code: lines.slice(at, end + 1).join('\n'), start: at + 1, end: end + 1 };
}

const out = [];
for (const pr of src) {
  const repo = join(base, pr.repo);
  const sha = git(repo, 'rev-parse', '--short', 'HEAD').trim();
  const files = git(repo, 'ls-files').split('\n').filter(Boolean);
  const cache = new Map();
  const read = (p) => {
    if (!cache.has(p)) { try { cache.set(p, git(repo, 'show', `HEAD:${p}`)); } catch { cache.set(p, null); } }
    return cache.get(p);
  };
  for (const s of pr.steps) {
    const lang = langOf(s.file);
    const fn = functionAt(read(s.file).split('\n'), s.fn, lang);
    const defs = definitionsCalled(fn.code, { files, read, self: s.fn, lang });
    out.push({ ...s, repo: pr.repo, change: pr.change, sha, lang, lines: `${fn.start}–${fn.end}`, code: `// ${s.file}:${fn.start}-${fn.end}\n${fn.code}`, context: contextText(defs), calls: defs.map((d) => d.name) });
    console.log(`${pr.repo}/${s.id}: ${fn.end - fn.start + 1} lines, context: ${defs.map((d) => d.name).join(', ') || '—'}`);
  }
}
writeFileSync(join(LAB, 'fixtures', 'real-steps.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`${out.length} steps → lab/fixtures/real-steps.json`);
