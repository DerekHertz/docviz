// Behavior and rules for `docviz pr`: pstack's statechart (TLC, drawn as Mermaid) on each model the
// PR touched, at base and at head; what the change adds or removes; each of the user's rules
// holding or breaking, with the shortest path in the reader's words; and each model step checked
// against its code by Jev. Running a model imports its view.mjs, code from the reviewed checkout,
// so models run only when the caller trusts the repo (`--trust-atlas`).
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { readAtlasAt, readAtlasDir, covers } from './atlas.js';
import { checkSteps } from './checks.js';
import { cut } from './pr.js';

const run$ = promisify(execFile);

// Run     = { model, side: 'base'|'head', title, states: string[], start: string[],
//             edges: { from, to, label }[], holds: string[], breaks: { rule, path: string[] }[],
//             unchecked: string[], mermaid, drawn: boolean, error? }
// Delta   = { model, added: { states, edges }, removed: { states, edges }, changed: boolean | null }
//           (changed is null when a side has no chart: statechart draws none above 500 states)
// Finding = one fact helper/verdict.js reads, in this order:
//   { kind: 'atlas', status: 'absent'|'no-rules'|'no-base' }
//   { kind: 'not-run', models: string[], why }
//   { kind: 'run', model, side, error }                         a model failed to load or to run
//   { kind: 'rule', name, text, status: 'holds'|'breaks'|'untouched'|'unchecked', model?, path?, atBase? }
//   { kind: 'extra-rule', model, name, status, path? }          a model's invariant not in rules.md (all of them, with no rules.md)
//   { kind: 'delta', model, changed, added, removed }
//   { kind: 'step', source: 'pr'|'model', model?, id, label, verdict, error? }
//   { kind: 'uncovered', path }                                 a changed source file no model covers

/** Docs, tests, markdown and the atlas itself never count as code no model covers. */
export const isSource = (p) => !(p.endsWith('.md') || /^(test|docs|\.atlas)\//.test(p));

// ---------- statechart's output ----------

// Mermaid entity codes (`#34;`) back to text.
const decode = (s) => s.replace(/#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).trim();

/** chart.mmd → its title, states (parents prefix children: "Parent / leaf"), start states and one edge per step. */
export function parseChart(mmd) {
  const ids = new Map();
  const states = [], start = [], edges = [];
  const stack = [];
  let title = null;
  const lines = mmd.split('\n');
  let i = 0;
  if (lines[0]?.trim() === '---') {
    for (i = 1; i < lines.length && lines[i].trim() !== '---'; i++) {
      const t = lines[i].match(/^title:\s*(.*)$/);
      if (t) title = JSON.parse(t[1]);
    }
    i++;
  }
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    let m;
    if ((m = line.match(/^state "(.*)" as (\w+) \{$/))) stack.push({ id: m[2], name: decode(m[1]) });
    else if (line === '}') stack.pop();
    else if (stack.some((s) => s.id === 'legend')) continue;
    else if ((m = line.match(/^\[\*\] --> (\w+)$/))) start.push(m[1]);
    else if ((m = line.match(/^(\w+) --> (\w+): (.*)$/))) for (const label of m[3].split(' or ')) edges.push({ from: m[1], to: m[2], label: decode(label) });
    else if ((m = line.match(/^(\w+): (.*)$/))) {
      // Region wrappers ("At the same time", r0…) are kept: they name where a state lives.
      const name = [...stack.map((s) => s.name), decode(m[2])].join(' / ');
      ids.set(m[1], name);
      states.push(name);
    }
  }
  const name = (id) => ids.get(id) ?? id;
  return { title, states, start: start.map(name), edges: edges.map((e) => ({ from: name(e.from), to: name(e.to), label: e.label })), ids };
}

/** report.md → the rules that hold, those that break (with the shortest path's lines), those not checked. */
export function parseReport(md) {
  const out = { holds: [], breaks: [], unchecked: [], stopped: null };
  let section = null;
  for (const line of md.split('\n')) {
    let m;
    if ((m = line.match(/^## (\S+) breaks$/))) out.breaks.push(section = { rule: m[1], path: [] });
    else if (line === '## Rules that hold') section = 'holds';
    else if (line === '## Rules not checked') section = 'unchecked';
    else if (line === '## TLC stopped') section = 'stopped';
    else if (line.startsWith('## ')) section = null;
    else if (typeof section === 'object' && section && (m = line.match(/^\d+\. (.*)$/))) section.path.push(m[1]);
    else if ((section === 'holds' || section === 'unchecked') && line.trim() && !line.startsWith('TLC ') && !line.startsWith('After ')) {
      out[section].push(...line.split(', ').map((s) => s.trim()));
      section = null;
    } else if (section === 'stopped' && line.startsWith('TLC stopped')) out.stopped = line;
  }
  return { ...out, breaks: out.breaks.map(({ rule, path }) => ({ rule, path })) };
}

const edgeKey = (e) => `${e.from}\u0000${e.to}\u0000${e.label}`;
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** What the head chart adds and removes against the base, by the reader's words. Either side may be null (a new or removed model). */
export function delta(model, base, head) {
  if ((base && base.drawn === false) || (head && head.drawn === false)) {
    return { model, added: { states: [], edges: [] }, removed: { states: [], edges: [] }, changed: null };
  }
  const diff = (a, b) => {
    const has = new Set((b?.states || []));
    const hasEdge = new Set((b?.edges || []).map(edgeKey));
    return {
      states: (a?.states || []).filter((s) => !has.has(s)).sort(byText),
      edges: (a?.edges || []).filter((e) => !hasEdge.has(edgeKey(e))).sort((x, y) => byText(edgeKey(x), edgeKey(y))),
    };
  };
  const added = diff(head, base);
  const removed = diff(base, head);
  const changed = added.states.length + added.edges.length + removed.states.length + removed.edges.length > 0;
  return { model, added, removed, changed };
}

/** The head chart with what the PR added marked: an orange border on new states, "(new)" on new steps. */
export function markChart(mermaid, d) {
  const { ids } = parseChart(mermaid);
  const newStates = new Set(d.added.states);
  const newEdges = new Set(d.added.edges.map(edgeKey));
  const name = (id) => ids.get(id) ?? id;
  const lines = mermaid.replace(/\n+$/, '').split('\n').map((line) => {
    const m = line.match(/^(\s*)(\w+) --> (\w+): (.*)$/);
    if (!m) return line;
    const labels = m[4].split(' or ').map((l) => (newEdges.has(edgeKey({ from: name(m[2]), to: name(m[3]), label: decode(l) })) ? `${l} (new)` : l));
    return `${m[1]}${m[2]} --> ${m[3]}: ${labels.join(' or ')}`;
  });
  const marked = [...ids].filter(([, n]) => newStates.has(n)).map(([id]) => `  class ${id} added`);
  if (marked.length) lines.push('  classDef added stroke:#d29922,stroke-width:3px', ...marked);
  return lines.join('\n') + '\n';
}

// ---------- running statechart ----------

/** statechart and TLC from the environment: DOCVIZ_STATECHART or pstack's plugin cache, TLA2TOOLS, JAVA. */
export function findTools(env = process.env) {
  let statechart = env.DOCVIZ_STATECHART;
  if (!statechart) {
    // ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/statechart/scripts/statechart
    const cache = join(homedir(), '.claude', 'plugins', 'cache');
    const ls = (d) => { try { return readdirSync(d); } catch { return []; } };
    const found = [];
    for (const a of ls(cache)) for (const b of ls(join(cache, a))) for (const c of ls(join(cache, a, b))) {
      const p = join(cache, a, b, c, 'skills', 'statechart', 'scripts', 'statechart');
      if (existsSync(p)) found.push({ p, c });
    }
    statechart = found.sort((x, y) => x.c.localeCompare(y.c, 'en', { numeric: true })).at(-1)?.p;
  }
  if (!statechart) return { why: 'statechart not found (install pstack, or set DOCVIZ_STATECHART)' };
  if (!env.TLA2TOOLS || !existsSync(env.TLA2TOOLS)) return { why: 'TLC not found (set TLA2TOOLS to tla2tools.jar, and JAVA)' };
  if (env.JAVA && !existsSync(env.JAVA)) return { why: `JAVA=${env.JAVA} not found` };
  return { statechart, env };
}

/** statechart's stderr in two lines, without Java's stack trace, naming the model's own folder rather than the temp copy. */
export const statechartError = (stderr, tmp, dir) => stderr.split('\n').map((l) => l.trim())
  .filter((l) => l && !/^(at |Exception in thread|\*\*\*|tla2sany\.)/.test(l))
  .slice(0, 2).join(' ').split(tmp).join(dir).replace(/:$/, '');

/** One statechart run on a model's files, copied into a temp folder: the checkout is never written. */
export async function runModel(model, side, { statechart, env }, timeoutMs = 120_000) {
  const dir = mkdtempSync(join(tmpdir(), `docviz-${model.name}-${side}-`));
  const fail = (error) => ({ model: model.name, side, title: null, states: [], start: [], edges: [], holds: [], breaks: [], unchecked: [], mermaid: '', drawn: false, error });
  try {
    for (const [name, text] of Object.entries(model.files)) {
      mkdirSync(dirname(join(dir, 'm', name)), { recursive: true });
      writeFileSync(join(dir, 'm', name), text);
    }
    const out = join(dir, 'out');
    const args = [join(dir, 'm', model.spec), '--config', join(dir, 'm', model.config), ...(model.view ? ['--view', join(dir, 'm', model.view)] : []), '--out', out];
    try {
      await run$(statechart, args, { cwd: join(dir, 'm'), env, timeout: timeoutMs, maxBuffer: 16 << 20 });
    } catch (e) {
      if (e.code !== 1) return fail(statechartError(e.stderr || e.message || '', join(dir, 'm'), model.dir) || `statechart exited ${e.code}`);
    }
    const report = parseReport(readFileSync(join(out, 'report.md'), 'utf8'));
    const chartFile = join(out, 'chart.mmd');
    const mermaid = existsSync(chartFile) ? readFileSync(chartFile, 'utf8') : '';
    const { ids, ...chart } = mermaid ? parseChart(mermaid) : { title: null, states: [], start: [], edges: [] };
    return { model: model.name, side, ...chart, holds: report.holds, breaks: report.breaks, unchecked: report.unchecked, mermaid, drawn: !!mermaid };
  } catch (e) {
    return fail(e.message);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- rules ----------

/**
 * Each of the user's rules: breaks or holds in a touched model's head run, untouched when only
 * models this PR didn't touch check it, unchecked when a touched model didn't run or no model
 * checks it. Then each touched model's invariant that isn't one of the user's rules (with no
 * rules.md, every one of them): a break is still a break, with its path.
 */
export function ruleFindings({ rules, runs, models, touched }) {
  const head = runs.filter((r) => r.side === 'head' && !r.error && touched.includes(r.model));
  const base = runs.filter((r) => r.side === 'base' && !r.error);
  const statusIn = (list, name) => {
    const b = list.find((r) => r.breaks.some((x) => x.rule === name));
    if (b) return { status: 'breaks', model: b.model, path: b.breaks.find((x) => x.rule === name).path };
    const h = list.find((r) => r.holds.includes(name));
    return h ? { status: 'holds', model: h.model } : null;
  };
  const checkedBy = (name, names) => models.filter((m) => names.includes(m.name) && m.rules.includes(name)).map((m) => m.name);
  const out = (rules || []).map(({ name, text }) => {
    const at = statusIn(head, name);
    const atBase = statusIn(base, name)?.status;
    if (at) return { kind: 'rule', name, text, ...at, ...(atBase && { atBase }) };
    const t = checkedBy(name, touched);
    if (t.length) return { kind: 'rule', name, text, status: 'unchecked', model: t[0] };
    const any = checkedBy(name, models.map((m) => m.name));
    return any.length ? { kind: 'rule', name, text, status: 'untouched', model: any[0] } : { kind: 'rule', name, text, status: 'unchecked', model: null };
  });
  const mine = new Set((rules || []).map((r) => r.name));
  for (const m of models.filter((x) => touched.includes(x.name))) {
    const r = head.find((x) => x.model === m.name);
    const extra = [...m.rules, ...(r?.breaks.map((b) => b.rule) || [])].filter((n, i, a) => !mine.has(n) && a.indexOf(n) === i);
    for (const name of extra) {
      const at = statusIn(r ? [r] : [], name);
      out.push({ kind: 'extra-rule', model: m.name, name, status: at?.status || 'unchecked', ...(at?.path && { path: at.path }) });
    }
  }
  return out;
}

// ---------- the comment's Behavior section ----------

const quote = (text) => `“${text.replace(/\s*\n\s*/g, ' ')}”`;
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
const CHECK = { pass: '✓', review: '⚠ review', flag: '✗ doesn’t match', unchecked: '—' };

function deltaLine(d) {
  if (d.changed === null) return 'Behavior not compared: a chart is not drawn (statechart draws none above 500 states).';
  if (!d.changed) return 'No change in behavior.';
  const parts = [
    d.added.states.length && `${plural(d.added.states.length, 'state')} added`,
    d.added.edges.length && `${plural(d.added.edges.length, 'step')} added`,
    d.removed.states.length && `${plural(d.removed.states.length, 'state')} removed`,
    d.removed.edges.length && `${plural(d.removed.edges.length, 'step')} removed`,
  ].filter(Boolean);
  return `${parts.join(', ')}.`;
}

function ruleLine(f) {
  if (f.status === 'breaks') {
    return [`- ✗ **${f.name}** breaks in ${f.model}${f.atBase === 'breaks' ? ' (it broke at base too)' : ''}: ${quote(f.text)}`,
      ...f.path.map((p, i) => `  ${i + 1}. ${p}`)].join('\n');
  }
  if (f.status === 'holds') return `- ✓ **${f.name}** holds${f.atBase === 'breaks' ? ' (it broke at base)' : ''}: ${quote(f.text)}`;
  if (f.status === 'untouched') return `- **${f.name}** not run: this PR doesn’t touch ${f.model}: ${quote(f.text)}`;
  if (f.model) return `- ⚠ **${f.name}** not checked: ${f.model} didn’t run: ${quote(f.text)}`;
  return `- ⚠ **${f.name}** is checked by no model: ${quote(f.text)}`;
}

/**
 * `models`: per touched model, its marked head chart and delta (or its error). `modelSteps`: each
 * model step with its cuts and Jev's verdict. `link(cut)` renders a code link.
 */
export function behaviorSection({ base, findings, models = [], modelSteps = [], link }) {
  const out = ['### Behavior', ''];
  const has = (kind, status) => findings.find((f) => f.kind === kind && (!status || f.status === status));
  if (has('atlas', 'absent')) return [...out, 'No `.atlas/` here, so no behavior is checked. Models and rules live in `.atlas/models/` and `.atlas/rules.md`.', ''].join('\n');
  out.push(base?.sha ? `Compared with \`${base.sha.slice(0, 7)}\` (${base.how}).` : `No base commit found, so nothing is compared (${base?.how || 'pass --base'}).`, '');
  const notRun = has('not-run');
  if (notRun) out.push(`${notRun.models.join(', ')}: models not run: ${notRun.why}.`, '');
  for (const m of models) {
    out.push(`#### ${m.name}`, '');
    if (m.error) { out.push(`Didn’t run at ${m.side}: ${m.error}`, ''); continue; }
    out.push(deltaLine(m.delta), '');
    if (m.mermaid) out.push('```mermaid', m.mermaid.trim(), '```', '');
    if (m.delta.changed) {
      out.push('New states have an orange border; new steps end in “(new)”.');
      const gone = [...m.delta.removed.states.map((s) => `state “${s}”`), ...m.delta.removed.edges.map((e) => `“${e.from}” → “${e.to}”: ${e.label}`)];
      if (gone.length) out.push(`Removed: ${gone.join('; ')}.`);
      out.push('');
    }
  }
  const rules = findings.filter((f) => f.kind === 'rule');
  if (has('atlas', 'no-rules')) out.push('No `.atlas/rules.md`: none of these rules are yours yet. Write one `## Name` per rule, with your sentence under it.', '');
  else if (rules.length) out.push('**Your rules** (`.atlas/rules.md`)', '', ...rules.map(ruleLine), '');
  const extra = findings.filter((f) => f.kind === 'extra-rule');
  const broke = extra.filter((f) => f.status === 'breaks');
  if (broke.length) {
    out.push(...broke.map((f) => [`- ✗ **${f.name}** breaks in ${f.model} (not one of your rules)`, ...(f.path || []).map((p, i) => `  ${i + 1}. ${p}`)].join('\n')), '');
  }
  const rest = extra.filter((f) => f.status !== 'breaks');
  if (rest.length) out.push(`Checked, not one of your rules: ${rest.map((f) => `${f.name} ${f.status} (${f.model})`).join(', ')}.`, '');
  if (modelSteps.length) {
    const code = (s) => (s.codeError ? `⚠ ${s.codeError.replace(/\|/g, '\\|')}` : s.cuts.map(link).join('<br>') || '—');
    out.push('**Model steps checked against their code**', '', '| Step | Code | Check |', '|---|---|---|',
      ...modelSteps.map((s) => `| ${s.label} | ${code(s)} | ${CHECK[s.verdict] || '—'} |`), '');
  }
  return out.join('\n');
}

// ---------- the whole pass ----------

// A model step's code at head. model.json is the repo's text: a path outside the checkout is never read.
const cutAt = (root) => (src) => {
  const file = resolve(root, src.path);
  if (relative(root, file).startsWith('..') || isAbsolute(relative(root, file))) throw new Error(`${src.path}: outside the repo`);
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { throw new Error(`${src.path}: no such file at head`); }
  try { return { path: src.path, ...cut(text, src.from, src.to) }; } catch (e) { throw new Error(`${src.path}: ${e.message}`); }
};

/**
 * `git(...args)` returns git's raw stdout in the reviewed checkout; `root` is its top level.
 * `base` is `{ sha, how }` from moved-git.js resolveBase (sha null when there is none): the same
 * base Modules moved compares against.
 * Returns { findings, runs, usage, section(link) }. Never throws for a model: its failure is a finding.
 */
export async function runBehavior({ root, git, base, trust = false, ask, check = true, tools, log = () => {} }) {
  const head = readAtlasDir(root);
  const before = base?.sha ? readAtlasAt(git, base.sha) : null;
  const findings = [];
  const done = (extra = {}) => ({ findings, runs: [], usage: { usd: 0, estimated: false }, section: (link) => behaviorSection({ base, findings, link, ...extra }), ...extra });
  if (!head && !before) {
    findings.push({ kind: 'atlas', status: 'absent' });
    return done();
  }
  if (!base?.sha) findings.push({ kind: 'atlas', status: 'no-base' });
  if (head && !head.rules) findings.push({ kind: 'atlas', status: 'no-rules' });

  const changed = base?.sha ? git('diff', '--name-only', '--no-renames', base.sha, '--').split('\n').filter(Boolean) : [];
  const headModels = head?.models || [];
  const baseModels = before?.models || [];
  const names = [...new Set([...headModels, ...baseModels].map((m) => m.name))].sort(byText);
  const touched = names.filter((n) => [...headModels, ...baseModels].some((m) => m.name === n && changed.some((p) => covers(m, p))));
  const pair = (n) => ({ head: headModels.find((m) => m.name === n), base: baseModels.find((m) => m.name === n) });

  // Run each touched model at base and head (in parallel), when trusted and the tools are there.
  let runs = [];
  if (touched.length) {
    const t = trust ? (tools || findTools()) : { why: 'pass --trust-atlas on your own repo' };
    if (t.why) findings.push({ kind: 'not-run', models: touched, why: t.why });
    else {
      log(`running ${touched.join(', ')} at base and head`);
      runs = (await Promise.all(touched.flatMap((n) => {
        const { head: h, base: b } = pair(n);
        return [b && (b.error ? { model: n, side: 'base', error: b.error } : runModel(b, 'base', t)),
          h && (h.error ? { model: n, side: 'head', error: h.error } : runModel(h, 'head', t))];
      }))).filter(Boolean);
    }
  }
  for (const r of runs) if (r.error) findings.push({ kind: 'run', model: r.model, side: r.side, error: r.error });
  findings.push(...ruleFindings({ rules: head?.rules ?? null, runs, models: headModels, touched }));

  const models = [];
  for (const n of runs.length ? touched : []) {
    const h = runs.find((r) => r.model === n && r.side === 'head');
    const b = runs.find((r) => r.model === n && r.side === 'base');
    if (h?.error) { models.push({ name: n, side: 'head', error: h.error }); continue; }
    if (b?.error) continue;
    const d = delta(n, b || null, h || null);
    findings.push({ kind: 'delta', ...d });
    models.push({ name: n, delta: d, mermaid: h?.mermaid ? markChart(h.mermaid, d) : '' });
  }

  // Model fidelity: each step of a touched model, checked against its code at head (Jev).
  const steps = touched.flatMap((n) => {
    const m = pair(n).head;
    if (!m || m.error) return [];
    return m.steps.map((s) => {
      try { return { model: n, id: s.action, label: s.label, cuts: s.sources.map(cutAt(root)) }; } catch (e) { return { model: n, id: s.action, label: s.label, cuts: [], error: e.message, codeError: e.message }; }
    });
  });
  const canCheck = check && (ask || process.env.TYPESAFE_API_KEY);
  const ready = steps.filter((s) => !s.error);
  const answers = canCheck && ready.length ? await checkSteps(ready, ask ? { ask } : {}) : [];
  const modelSteps = steps.map((s) => {
    const a = answers[ready.indexOf(s)];
    const verdict = s.error ? 'unchecked' : a?.verdict || 'unchecked';
    const error = s.error || a?.error || (canCheck ? undefined : (check ? 'TYPESAFE_API_KEY not set' : 'step checks off'));
    return { ...s, verdict, error, usage: a?.usage || null };
  });
  for (const s of modelSteps) {
    findings.push({ kind: 'step', source: 'model', model: s.model, id: s.id, label: s.label, verdict: s.verdict, ...(s.error && { error: s.error }) });
  }

  // Changed source files that no model (at base or head) covers.
  for (const p of changed) {
    if (isSource(p) && ![...headModels, ...baseModels].some((m) => covers(m, p))) findings.push({ kind: 'uncovered', path: p });
  }

  const usage = { usd: modelSteps.reduce((n, s) => n + (s.usage?.usd || 0), 0), estimated: modelSteps.some((s) => s.usage?.estimated) };
  return {
    findings: order(findings), runs, usage, modelSteps,
    section: (link) => behaviorSection({ base, findings: order(findings), models, modelSteps, link }),
  };
}

const KINDS = ['atlas', 'not-run', 'run', 'rule', 'extra-rule', 'delta', 'step', 'uncovered'];
const order = (findings) => KINDS.flatMap((k) => findings.filter((f) => f.kind === k));
