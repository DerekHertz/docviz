// "Modules moved": which modules a PR moved and which import edges it added or removed,
// from two maps of path -> source. The last test builds a real two-commit repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { moved, importsOf, movedSection } from '../helper/moved.js';
import { filesAt, resolveBase, movedBetween } from '../helper/moved-git.js';

const m = (o) => new Map(Object.entries(o));

test('imports: static, export-from, side-effect, dynamic and require; bare packages ignored', () => {
  const src = [
    "import a from './a.js';",
    "import { b,\n  c } from '../b/index.js';",
    "export * from './d.js';",
    "import './side.js';",
    "const e = await import('./e.js');",
    "const f = require('../f.cjs');",
    "import fs from 'node:fs';",
    "import x from 'lodash';",
    "// import z from './commented.js'",
  ].join('\n');
  assert.deepEqual(importsOf(src).sort(), ['../b/index.js', '../f.cjs', './a.js', './d.js', './e.js', './side.js']);
});

test('a new module is added, a deleted one removed, one with an edited file changed', () => {
  const base = m({ 'a/x.js': '1', 'b/y.js': '1', 'c/z.js': '1' });
  const head = m({ 'a/x.js': '1', 'b/y.js': '2', 'd/w.js': '1' });
  assert.deepEqual(moved(base, head).modules, [
    { name: 'b', change: 'changed' },
    { name: 'c', change: 'removed' },
    { name: 'd', change: 'added' },
  ]);
});

test('an untouched module is not listed; non-source files are ignored', () => {
  const base = m({ 'a/x.js': '1', 'a/notes.md': 'x' });
  const head = m({ 'a/x.js': '1', 'a/notes.md': 'y', 'docs/readme.md': 'z' });
  assert.deepEqual(moved(base, head), { modules: [], edges: [] });
});

test('a module whose files all moved to one new directory is renamed, with from', () => {
  const base = m({ 'old/a.js': 'A', 'old/b.js': 'B' });
  const head = m({ 'new/a.js': 'A', 'new/b.js': 'B' });
  assert.deepEqual(moved(base, head).modules, [{ name: 'new', change: 'renamed', from: 'old' }]);
});

test('files split across two new directories are one removed and two added, not a rename', () => {
  const base = m({ 'old/a.js': 'A', 'old/b.js': 'B' });
  const head = m({ 'n1/a.js': 'A', 'n2/b.js': 'B' });
  assert.deepEqual(moved(base, head).modules.map((x) => x.change), ['added', 'added', 'removed']);
});

test('an added edge and a removed edge between modules; same-module imports are not edges', () => {
  const base = m({ 'a/x.js': "import '../b/y.js';", 'b/y.js': '', 'c/z.js': '' });
  const head = m({ 'a/x.js': "import './x2.js'; import '../c/z.js';", 'a/x2.js': '', 'b/y.js': '', 'c/z.js': '' });
  assert.deepEqual(moved(base, head).edges, [
    { from: 'a', to: 'b', change: 'removed' },
    { from: 'a', to: 'c', change: 'added' },
  ]);
});

test('imports resolve extensionless and directory specifiers; the root module is "."', () => {
  const head = m({ 'cli.js': "import './lib/util';\nimport './lib';", 'lib/util.ts': '', 'lib/index.js': '' });
  assert.deepEqual(moved(new Map(), head).edges, [{ from: '.', to: 'lib', change: 'added' }]);
});

test('a renamed module keeps its unchanged edges out of the diff', () => {
  const base = m({ 'old/a.js': "import '../core/c.js';", 'core/c.js': '' });
  const head = m({ 'new/a.js': "import '../core/c.js';", 'core/c.js': '' });
  const r = moved(base, head);
  assert.deepEqual(r.modules, [{ name: 'new', change: 'renamed', from: 'old' }]);
  assert.deepEqual(r.edges, []);
});

test('output does not depend on map order', () => {
  const base = m({ 'z/a.js': '1', 'a/b.js': "import '../z/a.js'" });
  const head = m({ 'z/a.js': '2', 'a/b.js': '', 'q/c.js': "import '../a/b.js'" });
  const flip = (x) => new Map([...x].reverse());
  assert.deepEqual(moved(base, head), moved(flip(base), flip(head)));
});

test('the section lists modules and edges by kind, and says so when nothing moved', () => {
  const md = movedSection({
    modules: [{ name: 'n', change: 'renamed', from: 'o' }, { name: 'a', change: 'added' }, { name: 'r', change: 'removed' }, { name: 'c', change: 'changed' }],
    edges: [{ from: 'a', to: 'b', change: 'added' }, { from: 'c', to: 'd', change: 'removed' }],
  }, { base: 'abcdef1234567' });
  assert.match(md, /Modules moved/);
  assert.match(md, /abcdef1/);
  assert.match(md, /added.*`a`/);
  assert.match(md, /removed.*`r`/);
  assert.match(md, /renamed.*`o` → `n`/);
  assert.match(md, /changed.*`c`/);
  assert.match(md, /added.*`a` → `b`/);
  assert.match(md, /removed.*`c` → `d`/);
  assert.match(movedSection({ modules: [], edges: [] }), /No modules moved/);
});

test('the git reader finds the moved modules between two real commits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docviz-moved-'));
  const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim();
  const put = (p, s) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), s); };
  try {
    git('init', '-q', '-b', 'main');
    put('app/main.js', "import '../lib/u.js';\n");
    put('lib/u.js', 'export {};\n');
    put('README.md', 'hi');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    put('app/main.js', "import '../net/c.js';\n");
    put('net/c.js', 'export {};\n');
    git('rm', '-q', 'lib/u.js');
    git('add', '-A');
    git('commit', '-q', '-m', 'head');

    assert.deepEqual([...filesAt('HEAD~1', { cwd: dir }).keys()].sort(), ['app/main.js', 'lib/u.js']);
    const sha = git('rev-parse', 'HEAD~1');
    const base = resolveBase(undefined, { cwd: dir });
    assert.equal(base.sha, sha);
    assert.match(base.how, /HEAD~1/);
    assert.equal(resolveBase('HEAD~1', { cwd: dir }).sha, sha);
    assert.throws(() => resolveBase('no-such-ref', { cwd: dir }));
    assert.deepEqual(movedBetween(sha, 'HEAD', { cwd: dir }), {
      modules: [{ name: 'app', change: 'changed' }, { name: 'lib', change: 'removed' }, { name: 'net', change: 'added' }],
      edges: [{ from: 'app', to: 'lib', change: 'removed' }, { from: 'app', to: 'net', change: 'added' }],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
