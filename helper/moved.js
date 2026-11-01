// "Modules moved": from two maps of path -> source text (base and head), name the modules a PR
// moved and the import edges it added or removed. Pure: no git, no files, no model.
// A module is a source file's directory relative to the repo root ('.' for the root). An edge is
// a relative import from a file in one module to a file in another.
import { posix } from 'node:path';

const EXTS = ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'];
const SOURCE = new RegExp(`\\.(?:${EXTS.join('|')})$`);
const IGNORED = /(?:^|\/)node_modules\/|\.min\.js$/;

const isSource = (path) => SOURCE.test(path) && !IGNORED.test(path);
const moduleOf = (path) => posix.dirname(path);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Each pattern captures the specifier; `from` also covers `export ... from`.
const IMPORT_PATTERNS = [
  /\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** The relative specifiers a source file imports. Bare packages and `node:` imports are left out. */
export function importsOf(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found = new Set();
  for (const re of IMPORT_PATTERNS) for (const m of code.matchAll(re)) if (m[1].startsWith('.')) found.add(m[1]);
  return [...found];
}

// The source file a specifier points at, or null: exact, with an extension, as a directory index,
// or `./a.js` written for an `a.ts` source.
function resolveImport(fromPath, spec, files) {
  const target = posix.normalize(posix.join(posix.dirname(fromPath), spec));
  if (target.startsWith('..')) return null;
  const bare = target.replace(/\.[cm]?jsx?$/, '');
  const candidates = [target, ...EXTS.map((e) => `${target}.${e}`), ...EXTS.map((e) => `${target}/index.${e}`), ...EXTS.map((e) => `${bare}.${e}`)];
  return candidates.find((c) => files.has(c)) || null;
}

const sourceFiles = (files) => new Map([...files].filter(([path]) => isSource(path)));

function modulesOf(files) {
  const mods = new Map();
  for (const path of files.keys()) {
    const name = moduleOf(path);
    mods.set(name, [...(mods.get(name) || []), path]);
  }
  return mods;
}

// "from<TAB>to" keys of the module-level edges.
function edgesOf(files) {
  const edges = new Set();
  for (const [path, source] of files) {
    for (const spec of importsOf(source)) {
      const target = resolveImport(path, spec, files);
      if (target && moduleOf(target) !== moduleOf(path)) edges.add(`${moduleOf(path)}\t${moduleOf(target)}`);
    }
  }
  return edges;
}

// Removed module -> the one new module all its files (by file name) went to.
function renames(baseMods, headMods, removed, added) {
  const out = new Map();
  const taken = new Set();
  for (const name of removed) {
    const dirs = baseMods.get(name).map((path) => {
      const file = posix.basename(path);
      return added.filter((a) => headMods.get(a).some((p) => posix.basename(p) === file));
    });
    const to = dirs[0]?.find((d) => !taken.has(d) && dirs.every((ds) => ds.includes(d)));
    if (to) { out.set(name, to); taken.add(to); }
  }
  return out;
}

const changedFiles = (paths, base, head) => paths.some((p) => base.get(p) !== head.get(p));

function moduleChanges(base, head) {
  const baseMods = modulesOf(base);
  const headMods = modulesOf(head);
  const removed = [...baseMods.keys()].filter((n) => !headMods.has(n)).sort(cmp);
  const added = [...headMods.keys()].filter((n) => !baseMods.has(n)).sort(cmp);
  const renamed = renames(baseMods, headMods, removed, added);
  const renamedTo = new Set(renamed.values());
  const modules = [
    ...[...renamed].map(([from, name]) => ({ name, change: 'renamed', from })),
    ...removed.filter((n) => !renamed.has(n)).map((name) => ({ name, change: 'removed' })),
    ...added.filter((n) => !renamedTo.has(n)).map((name) => ({ name, change: 'added' })),
    ...[...headMods].filter(([n, paths]) => baseMods.has(n)
      && (paths.length !== baseMods.get(n).length || changedFiles(paths, base, head))).map(([name]) => ({ name, change: 'changed' })),
  ];
  return { modules: modules.sort((a, b) => cmp(a.name, b.name) || cmp(a.change, b.change)), renamed };
}

/** `baseFiles` and `headFiles`: Map of repo-relative path -> source text. Returns `{ modules, edges }`. */
export function moved(baseFiles, headFiles) {
  const base = sourceFiles(baseFiles);
  const head = sourceFiles(headFiles);
  const { modules, renamed } = moduleChanges(base, head);
  // A renamed module's edges are compared under its new name, so the rename alone is not an edge change.
  const rename = (n) => renamed.get(n) ?? n;
  const baseEdges = new Set([...edgesOf(base)].map((k) => k.split('\t').map(rename).join('\t')));
  const headEdges = edgesOf(head);
  const edge = (key, change) => { const [from, to] = key.split('\t'); return { from, to, change }; };
  const edges = [
    ...[...baseEdges].filter((k) => !headEdges.has(k)).map((k) => edge(k, 'removed')),
    ...[...headEdges].filter((k) => !baseEdges.has(k)).map((k) => edge(k, 'added')),
  ].filter((e) => e.from !== e.to).sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.change, b.change));
  return { modules, edges };
}

const tick = (s) => `\`${s}\``;

/** The comment section. `base` (a sha) names what the PR was compared against. */
export function movedSection({ modules, edges }, { base } = {}) {
  const since = base ? ` since \`${base.slice(0, 7)}\`` : '';
  if (!modules.length && !edges.length) return `### Modules moved\n\nNo modules moved${since}.\n`;
  const names = (change, show) => modules.filter((m) => m.change === change).map(show);
  const line = (label, items) => (items.length ? [`- ${label}: ${items.join(', ')}`] : []);
  const pair = (e) => `${tick(e.from)} → ${tick(e.to)}`;
  const of = (change) => edges.filter((e) => e.change === change).map(pair);
  return [
    `### Modules moved${since}`,
    '',
    ...line('added', names('added', (m) => tick(m.name))),
    ...line('removed', names('removed', (m) => tick(m.name))),
    ...line('renamed', names('renamed', (m) => `${tick(m.from)} → ${tick(m.name)}`)),
    ...line('changed', names('changed', (m) => tick(m.name))),
    ...(edges.length ? ['', 'Import edges between modules:', '', ...line('added', of('added')), ...line('removed', of('removed'))] : []),
  ].join('\n') + '\n';
}
