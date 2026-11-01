// `.atlas/` in a reviewed repo, versioned with its code:
//   rules.md               the user's sentences, one per `## <Name>`; agents never write it
//   models/<name>/         one TLA+ model per stateful module: model.json, spec, config, view
// Read from a directory (the checkout as it is) or from git at a ref (the PR's base). Nothing here
// runs the model; helper/behavior.js does, and only when the user trusts the repo.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const ATLAS = '.atlas';
const MODELS = `${ATLAS}/models/`;

// Atlas = { rules: Rule[] | null, models: Model[] }       rules is null when rules.md is missing
// Rule  = { name, text }                                  text is the user's, word for word
// Model = { name, dir, spec, config, view, code: string[], steps: ModelStep[],
//           rules: string[], files: { [name]: text }, error? }
// ModelStep = { action, label, sources: { path, from, to }[] }

/** `## Name` headings, each with the text under it (up to the next heading), trimmed. */
export function parseRules(md) {
  const rules = [];
  for (const line of md.split('\n')) {
    const h = line.match(/^##\s+(\S+)\s*$/);
    if (h) rules.push({ name: h[1], lines: [] });
    else if (/^#/.test(line)) rules.push({ name: null, lines: [] });
    else rules.at(-1)?.lines.push(line);
  }
  return rules.filter((r) => r.name).map((r) => ({ name: r.name, text: r.lines.join('\n').trim() }));
}

const CFG_KEYWORD = /^(CONSTANTS?|INIT|NEXT|SPECIFICATION|INVARIANTS?|PROPERTY|PROPERTIES|CONSTRAINTS?|ACTION_CONSTRAINTS?|SYMMETRY|VIEW|CHECK_DEADLOCK|POSTCONDITION|ALIAS)$/;

/** The invariants and properties a TLC config checks, in order. */
export function cfgRules(cfg) {
  const names = [];
  let collecting = false;
  for (const raw of cfg.split('\n')) {
    const line = raw.replace(/\\\*.*$/, '').trim();
    if (!line) continue;
    const [word, ...rest] = line.split(/\s+/);
    if (CFG_KEYWORD.test(word)) {
      collecting = /^(INVARIANTS?|PROPERTY|PROPERTIES)$/.test(word);
      if (collecting) names.push(...rest);
    } else if (collecting) names.push(word, ...rest);
  }
  return names;
}

/** Does this model cover a repo path: one of its code paths (a `dir/` covers what's under it), or its own folder? */
export const covers = (model, path) =>
  path.startsWith(`${model.dir}/`) || model.code.some((c) => (c.endsWith('/') ? path.startsWith(c) : path === c));

/** Pure: an Atlas from a map of repo paths to file text (only `.atlas/**` is read). Null when there's none. */
export function atlasFrom(files) {
  const paths = Object.keys(files).filter((p) => p.startsWith(`${ATLAS}/`)).sort();
  if (!paths.length) return null;
  const rulesMd = files[`${ATLAS}/rules.md`];
  const names = [...new Set(paths.filter((p) => p.startsWith(MODELS)).map((p) => p.slice(MODELS.length).split('/')[0]))];
  const models = names.map((name) => {
    const dir = `${MODELS}${name}`;
    const own = Object.fromEntries(paths.filter((p) => p.startsWith(`${dir}/`)).map((p) => [p.slice(dir.length + 1), files[p]]));
    const base = { name, dir, spec: null, config: null, view: null, code: [], steps: [], rules: [], files: own };
    let json;
    try { json = JSON.parse(own['model.json']); } catch (e) {
      return { ...base, error: own['model.json'] == null ? 'no model.json' : `model.json: ${e.message}` };
    }
    const model = { ...base, spec: json.spec, config: json.config, view: json.view || null, code: json.code || [], steps: json.steps || [] };
    const missing = [model.spec, model.config, model.view].filter((f) => f && own[f] == null);
    if (!model.spec || !model.config) return { ...model, error: 'model.json needs spec and config' };
    if (missing.length) return { ...model, error: `missing ${missing.join(', ')}` };
    return { ...model, rules: cfgRules(own[model.config]) };
  });
  return { rules: rulesMd == null ? null : parseRules(rulesMd), models };
}

/** The atlas in a checkout as it is on disk (uncommitted edits included). */
export function readAtlasDir(root) {
  const top = join(root, ATLAS);
  if (!existsSync(top)) return null;
  const files = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files[relative(root, p).split(sep).join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(top);
  return atlasFrom(files);
}

/** The atlas at a git ref; `git(...args)` returns git's raw stdout. Nothing is checked out. */
export function readAtlasAt(git, ref) {
  const paths = git('ls-tree', '-r', '--name-only', ref, '--', ATLAS).split('\n').filter(Boolean);
  return atlasFrom(Object.fromEntries(paths.map((p) => [p, git('show', `${ref}:${p}`)])));
}
