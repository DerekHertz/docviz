// `.atlas/` in a reviewed repo, versioned with its code:
//   rules.md               the user's sentences, one per `## <Name>`; agents never write it
//   models/<name>/         one TLA+ model per stateful module: model.json, spec, config, view
// Read from a directory (the checkout as it is) or from git at a ref (the PR's base). Nothing here
// runs the model; helper/behavior.js does, and only when the user trusts the repo.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const ATLAS = '.atlas';
const MODELS = `${ATLAS}/models/`;

// Atlas = { rules: Rule[] | null, problems: string[], models: Model[] }
//          rules is null when rules.md is missing; problems are rules.md text that isn't a rule
// Rule  = { name, text }                                  text is the user's, word for word
// Model = { name, dir, spec, config, view, code: string[], steps: ModelStep[],
//           rules: string[], files: { [name]: text }, error? }
// ModelStep = { action, label, sources: { path, from, to }[] }

// A rule's name is the TLA+ invariant or property that checks it: one word of letters, digits and _.
const RULE_HEADING = /^##[ \t]+(\w*[A-Za-z]\w*)[ \t]*$/;
const notRule = (n, line) => `rules.md: line ${n} \`${line.trim()}\` is not a rule heading (## Name, one word)`;

/**
 * rules.md → its rules (`## Name` headings, each with the text under it, trimmed) and its problems:
 * every heading that isn't a rule (one `# Title` above the rules is fine), a rule with no sentence,
 * a repeated name, or prose with no rule heading at all. The user's sentences are never dropped silently.
 */
export function parseRules(md) {
  const sections = [];
  const problems = [];
  let title = true;
  md.split('\n').forEach((line, i) => {
    const h = line.match(RULE_HEADING);
    if (h) { title = false; sections.push({ name: h[1], line: i + 1, lines: [] }); return; }
    if (/^#/.test(line)) {
      if (!(title && /^#[ \t]/.test(line))) problems.push({ line: i + 1, text: notRule(i + 1, line) });
      title = false;
      sections.push({ name: null, line: i + 1, lines: [] });
      return;
    }
    sections.at(-1)?.lines.push(line);
  });
  if (!sections.some((x) => x.name) && md.trim()) {
    return { rules: [], problems: ['rules.md: no rule headings, so none of its text is a rule (write `## Name`, one word, above each sentence)'] };
  }
  const rules = [];
  for (const s of sections.filter((x) => x.name)) {
    const text = s.lines.join('\n').trim();
    if (!text) problems.push({ line: s.line, text: `rules.md: line ${s.line} \`## ${s.name}\` has no sentence under it` });
    else if (rules.some((r) => r.name === s.name)) problems.push({ line: s.line, text: `rules.md: line ${s.line} \`## ${s.name}\` repeats a rule name; only the first counts` });
    else rules.push({ name: s.name, text });
  }
  return { rules, problems: problems.sort((a, b) => a.line - b.line).map((p) => p.text) };
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
  const parsed = rulesMd == null ? { rules: null, problems: [] } : parseRules(rulesMd);
  return { rules: parsed.rules, problems: parsed.problems, models };
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
