// `docviz pr`: one diagram of a pull request's main flow, with the steps it adds
// or changes highlighted and a table linking each step to its code at HEAD.
// Prints the PR comment; posting it is the caller's job.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { complete, detectProviders, pickProvider } from './providers.js';
import { prCardPrompt, repairPrompt } from './prompts.js';
import { checkSteps } from './checks.js';
import { lintCard } from './lint.js';
import { movedSinceBase, resolveBase } from './moved-git.js';
import { runBehavior } from './behavior.js';
import { UNTRUSTED_GIT } from './git.js';

export const MARKER = '<!-- docviz-pr-diagrams -->';
const DOCVIZ_REPO = 'https://github.com/DerekHertz/docviz';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export { UNTRUSTED_GIT };

/** The text from `from` up to `to` (exclusive; empty means the end) and its 1-based line range. */
export function cut(text, from, to) {
  const a = from ? text.indexOf(from) : 0;
  if (a < 0) throw new Error(`marker not found: ${from}`);
  let b = to ? text.indexOf(to, a + 1) : -1;
  if (b < 0) b = text.length;
  const lineOf = (i) => text.slice(0, i).split('\n').length;
  return { text: text.slice(a, b), start: lineOf(a), end: lineOf(Math.max(a, b - 1)) };
}

export const repoWebUrl = (remote) => remote.trim().replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');

export const missingSteps = (steps, mermaid) => steps.filter((s) => !new RegExp(`\\b${s.id}\\b`).test(mermaid)).map((s) => s.id);

export function sumUsage(list) {
  return { usd: list.reduce((n, u) => n + (u?.usd || 0), 0), estimated: list.some((u) => u?.estimated) };
}

// Same format as the extension's card costs (extension/settings.js money()).
export const money = (u) => `${u.estimated ? '~' : ''}$${u.usd < 0.01 ? u.usd.toFixed(3) : u.usd.toFixed(2)}`;

export const codeLink = (repoUrl, sha) => (c) => `[\`${c.path}:${c.start}-${c.end}\`](${repoUrl}/blob/${sha}/${c.path}#L${c.start}-L${c.end})`;

const CHECK = { pass: '✓', review: '⚠ review', flag: '✗ doesn’t match', unchecked: '—' };

// "1 ✓, 1 ⚠, 1 ✗": only the outcomes that happened.
function checkSummary(checks) {
  const n = (v) => checks.filter((c) => c.verdict === v).length;
  const parts = [[n('pass'), '✓'], [n('review'), '⚠'], [n('flag'), '✗'], [n('unchecked'), 'not checked']].filter(([k]) => k).map(([k, s]) => `${k} ${s}`);
  return `steps checked by Jev: ${parts.join(', ')}`;
}

/**
 * `checks` (one per step, from helper/checks.js) adds a Check column; without it the footer says
 * the steps weren't checked. `costs` breaks the total into what spent it: diagram, step checks,
 * model checks (a single part is named without its figure, which is the total). `sections`
 * (markdown: Behavior, Modules moved) go after the step table, before the footer; `tlc` says TLC
 * ran, at no cost.
 */
export function prComment({ card, steps, sha, repoUrl, usage, checked, version, checks, costs, drawnBy, sections = [], tlc = false }) {
  const link = codeLink(repoUrl, sha);
  const agent = drawnBy === 'agent';
  const parts = costs ? [['diagram', costs.diagram], ['step checks', costs.checks], ['model checks', costs.models]].filter(([, u]) => u)
    : agent && checks ? [['step checks', usage]] : [];
  const cost = money(usage)
    + (parts.length > 1 ? ` (${parts.map(([k, u]) => `${k} ${money(u)}`).join(', ')})` : parts.length ? ` (${parts[0][0]})` : '')
    + (tlc ? '; TLC runs locally, free' : '');
  return [
    MARKER,
    '## How this PR works',
    '',
    card.caption,
    '',
    '```mermaid',
    card.mermaid.trim(),
    '```',
    steps.some((s) => s.changed) ? '\nBoxes with an orange border are new or changed in this PR.' : '',
    '',
    `### Where in the code (at \`${sha.slice(0, 7)}\`)`,
    '',
    checks ? '| Step | | Code | Check |' : '| Step | | Code |',
    checks ? '|---|---|---|---|' : '|---|---|---|',
    ...steps.map((s, i) => `| ${s.label} | ${s.changed ? 'new' : ''} | ${s.cuts.map(link).join('<br>')} |${checks ? ` ${CHECK[checks[i]?.verdict] || '—'} |` : ''}`),
    checks?.some((c) => c.verdict === 'review' || c.verdict === 'flag')
      ? '\n⚠ the label claims something these lines don’t show (a person should look); ✗ the lines contradict the label.' : '',
    '',
    ...sections.flatMap((s) => [s.trimEnd(), '']),
    `<sub>Diagram by ${agent ? 'the calling agent, formatted by ' : ''}[docviz](${DOCVIZ_REPO}) \`${version}\`, ${checked ? 'checked against Mermaid 11' : 'not syntax-checked'}, ${checks ? checkSummary(checks) : 'steps not checked'}, cost ${cost}.</sub>`,
  ].join('\n') + '\n';
}

// Syntax-checks with docviz's own Mermaid build in a headless browser. Playwright is
// optional (docviz has no dependencies): found next to docviz, else skipped. Never resolved
// from the reviewed repo: its node_modules is untrusted code.
async function mermaidChecker() {
  const bundle = join(ROOT, 'extension', 'vendor', 'mermaid.min.js');
  let chromium;
  try { ({ chromium } = createRequire(join(ROOT, 'package.json'))('playwright')); } catch {}
  if (!chromium || !existsSync(bundle)) return null;
  const browser = await chromium.launch();
  const tab = await browser.newPage();
  await tab.addScriptTag({ path: bundle });
  await tab.evaluate(() => mermaid.initialize({ startOnLoad: false }));
  return {
    check: (src) => tab.evaluate(async (s) => {
      try { await mermaid.parse(s); return null; } catch (e) { return String(e.message || e); }
    }, src),
    close: () => browser.close(),
  };
}

/** Lint errors for a steps document's card, with whether Mermaid parsed it (false when Playwright is missing). */
export async function lintDoc({ steps, card }) {
  const errors = lintCard(steps, card);
  if (!card?.mermaid?.trim()) return { errors, parsed: false };
  const checker = await mermaidChecker();
  try {
    const error = await checker?.check(card.mermaid);
    if (error) errors.push(`Mermaid does not parse: ${error.split('\n')[0]}`);
  } finally {
    await checker?.close();
  }
  return { errors, parsed: !!checker };
}

function docvizVersion() {
  try { return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
}

// One base for Modules moved and Behavior. A bad --base fails here, before any model call; with no
// base to default to (a repo's first commit) both sections say they weren't compared.
function baseFor(ref, cwd, log) {
  try {
    return resolveBase(ref, { cwd });
  } catch (e) {
    if (ref) throw e;
    log(`base: ${e.message}`);
    return { sha: null, how: e.message };
  }
}

/** Returns { body, missing, usage, moved, behavior }; throws with `usage` when the diagram can't be used. */
export async function runPr({ stepsFile, prUrl, title, glossaryFile, provider: requested, model, check = true, ask, base: baseRef, trustAtlas = false, log = () => {} }) {
  const git = (...a) => execFileSync('git', [...UNTRUSTED_GIT, ...a], { encoding: 'utf8' }).trim();
  const root = git('rev-parse', '--show-toplevel');
  const gitRaw = (...a) => execFileSync('git', [...UNTRUSTED_GIT, ...a], { encoding: 'utf8', cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const sha = git('rev-parse', 'HEAD');
  const repoUrl = repoWebUrl(git('remote', 'get-url', 'origin'));
  if (git('status', '--porcelain', '--untracked-files=no')) log('warning: uncommitted changes; links point at HEAD as committed');

  const base = baseFor(baseRef, root, log);
  const movedPart = movedSinceBase(base, sha, { cwd: root });

  const doc = JSON.parse(readFileSync(resolve(stepsFile), 'utf8'));
  let parsed = false;
  if (doc.card) {
    const lint = await lintDoc(doc);
    if (lint.errors.length) throw new Error(lint.errors.join('\n'));
    parsed = lint.parsed;
    if (!parsed) log('playwright not found: the diagram is not syntax-checked');
  }
  const steps = doc.steps.map((s) => ({
    ...s,
    cuts: s.sources.map((src) => {
      try { return { path: src.path, ...cut(readFileSync(resolve(root, src.path), 'utf8'), src.from, src.to) }; } catch (e) { throw new Error(`${src.path}: ${e.message}`); }
    }),
  }));
  const glossary = glossaryFile ? readFileSync(resolve(glossaryFile), 'utf8') : '';

  const provider = doc.card ? null : pickProvider(requested || 'auto', detectProviders());
  const spent = [];
  const call = async (job, timeoutMs) => {
    try {
      const { output, usage } = await complete(provider, { ...job, model, timeoutMs });
      spent.push(usage);
      return output;
    } catch (e) {
      spent.push(e.usage);
      throw Object.assign(e, { usage: sumUsage(spent) });
    }
  };

  // Step checks (Jev) run alongside the diagram; they never fail the comment.
  const canCheck = check && (ask || process.env.TYPESAFE_API_KEY);
  if (check && !canCheck) log('TYPESAFE_API_KEY not set: steps not checked');
  const checking = canCheck ? checkSteps(steps, ask ? { ask } : {}) : null;
  // Behavior (helper/behavior.js) runs alongside too: models at base and head, rules, model steps.
  const behaving = runBehavior({ root, git: gitRaw, base, trust: trustAtlas, ask, check, log }).catch((e) => ({
    findings: [{ kind: 'run', model: '.atlas', side: 'head', error: e.message }], runs: [], usage: null, section: () => `### Behavior\n\nNot checked: ${e.message}`,
  }));
  const otherSpend = async () => [...((await checking) || []).map((c) => c.usage), (await behaving).usage];

  // The fallback for a person at a terminal: a model draws the diagram, and a second call repairs it.
  const draw = async () => {
    let card;
    try {
      card = await call(prCardPrompt({ page: { title: title || 'Pull request', url: prUrl }, steps, glossary }), 300_000);
    } catch (e) {
      throw Object.assign(e, { usage: sumUsage([...spent, ...(await otherSpend())]) });
    }
    const checker = await mermaidChecker();
    if (!checker) log('playwright not found: the diagram is not syntax-checked');
    try {
      let error = await checker?.check(card.mermaid);
      if (error) {
        card.mermaid = (await call(repairPrompt({ mermaid: card.mermaid, error }), 120_000)).mermaid;
        error = await checker.check(card.mermaid);
      }
      if (error) {
        throw Object.assign(new Error(`diagram doesn't parse: ${error.split('\n')[0]}`), { usage: sumUsage([...spent, ...(await otherSpend())]) });
      }
    } finally {
      await checker?.close();
    }
    return { card, parsed: !!checker };
  };
  const drawnBy = doc.card ? 'agent' : 'docviz';
  const { card, parsed: checked } = doc.card ? { card: doc.card, parsed } : await draw();

  const checks = await checking;
  for (const c of checks || []) if (c.error) log(`step ${c.id} not checked: ${c.error}`);
  const behavior = await behaving;
  const models = behavior.modelSteps?.length ? behavior.usage : null;
  const costs = checks || models ? {
    ...(!doc.card && { diagram: sumUsage(spent) }), ...(checks && { checks: sumUsage(checks.map((c) => c.usage)) }), ...(models && { models }),
  } : null;
  const usage = sumUsage([...spent, ...(await otherSpend())]);
  const body = prComment({
    card, steps, sha, repoUrl, usage, checked, version: docvizVersion(), checks, costs, drawnBy,
    sections: [behavior.section(codeLink(repoUrl, sha)), movedPart.markdown], tlc: behavior.runs.length > 0,
  });
  return { body, missing: missingSteps(steps, card.mermaid), usage, checks, moved: movedPart.moved, behavior };
}
