// Reads the files `moved()` compares out of git, so nothing is checked out and no code from
// the reviewed repo runs (see UNTRUSTED_GIT).
import { execFileSync } from 'node:child_process';
import { UNTRUSTED_GIT } from './pr.js';
import { moved } from './moved.js';

const SOURCE = /\.(?:js|mjs|cjs|ts|tsx|jsx)$/;

function git(cwd, ...args) {
  return execFileSync('git', [...UNTRUSTED_GIT, ...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

const tryGit = (cwd, ...args) => { try { return git(cwd, ...args).trim(); } catch { return null; } };

/** Map of path -> source text for every source file at `ref`. */
export function filesAt(ref, { cwd = process.cwd() } = {}) {
  const paths = git(cwd, 'ls-tree', '-r', '--name-only', '-z', ref).split('\0').filter((p) => SOURCE.test(p));
  return new Map(paths.map((path) => [path, git(cwd, 'show', `${ref}:${path}`)]));
}

/**
 * The commit to compare against: `ref` when given, else the merge base with origin/main, else
 * HEAD~1. `how` says which, for the comment.
 */
export function resolveBase(ref, { cwd = process.cwd() } = {}) {
  const pick = (r, how) => { const sha = tryGit(cwd, 'rev-parse', '--verify', '--quiet', `${r}^{commit}`); return sha && { sha, how }; };
  if (ref) {
    const found = pick(ref, `--base ${ref}`);
    if (!found) throw new Error(`--base ${ref}: not a commit in this repo`);
    return found;
  }
  const mergeBase = tryGit(cwd, 'merge-base', 'HEAD', 'origin/main');
  const base = (mergeBase && pick(mergeBase, 'merge base with origin/main')) || pick('HEAD~1', 'HEAD~1 (no origin/main)');
  if (!base) throw new Error('no base commit: pass --base <ref>');
  return base;
}

/** `moved()` between two refs of the repo at `cwd`. */
export const movedBetween = (baseRef, headRef, opts) => moved(filesAt(baseRef, opts), filesAt(headRef, opts));
