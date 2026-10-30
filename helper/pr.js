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

export const MARKER = '<!-- docviz-pr-diagrams -->';
const DOCVIZ_REPO = 'https://github.com/DerekHertz/docviz';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

const CHECK = { pass: '✓', review: '⚠ review', flag: '✗ doesn’t match', unchecked: '—' };

// "1 ✓, 1 ⚠, 1 ✗": only the outcomes that happened.
function checkSummary(checks) {
  const n = (v) => checks.filter((c) => c.verdict === v).length;
  const parts = [[n('pass'), '✓'], [n('review'), '⚠'], [n('flag'), '✗'], [n('unchecked'), 'not checked']].filter(([k]) => k).map(([k, s]) => `${k} ${s}`);
  return `steps checked by Jev: ${parts.join(', ')}`;
}

/**
 * `checks` (one per step, from helper/checks.js) adds a Check column; without it the footer says
 * the steps weren't checked. `costs` breaks the total into diagram and step checks.
 */
export function prComment({ card, steps, sha, repoUrl, usage, checked, version, checks, costs }) {
  const link = (c) => `[\`${c.path}:${c.start}-${c.end}\`](${repoUrl}/blob/${sha}/${c.path}#L${c.start}-L${c.end})`;
  const cost = costs ? `${money(usage)} (diagram ${money(costs.diagram)}, step checks ${money(costs.checks)})` : money(usage);
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
    `<sub>Diagram by [docviz](${DOCVIZ_REPO}) \`${version}\`, ${checked ? 'checked against Mermaid 11' : 'not syntax-checked'}, ${checks ? checkSummary(checks) : 'steps not checked'}, cost ${cost}.</sub>`,
  ].join('\n') + '\n';
}

// Syntax-checks with docviz's own Mermaid build in a headless browser. Playwright is
// optional (docviz has no dependencies): found in the PR's repo or next to docviz, else skipped.
async function mermaidChecker(repoRoot) {
  const bundle = join(ROOT, 'extension', 'vendor', 'mermaid.min.js');
  let chromium;
  for (const base of [join(repoRoot, 'package.json'), join(ROOT, 'package.json')]) {
    try { ({ chromium } = createRequire(base)('playwright')); break; } catch {}
  }
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

function docvizVersion() {
  try { return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
}

/** Returns { body, missing, usage }; throws with `usage` when the diagram can't be used. */
export async function runPr({ stepsFile, prUrl, title, glossaryFile, provider: requested, model, check = true, ask, log = () => {} }) {
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
  const root = git('rev-parse', '--show-toplevel');
  const sha = git('rev-parse', 'HEAD');
  const repoUrl = repoWebUrl(git('remote', 'get-url', 'origin'));
  if (git('status', '--porcelain', '--untracked-files=no')) log('warning: uncommitted changes; links point at HEAD as committed');

  const steps = JSON.parse(readFileSync(resolve(stepsFile), 'utf8')).steps.map((s) => ({
    ...s,
    cuts: s.sources.map((src) => {
      try { return { path: src.path, ...cut(readFileSync(resolve(root, src.path), 'utf8'), src.from, src.to) }; } catch (e) { throw new Error(`${src.path}: ${e.message}`); }
    }),
  }));
  const glossary = glossaryFile ? readFileSync(resolve(glossaryFile), 'utf8') : '';

  const provider = pickProvider(requested || 'auto', detectProviders());
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

  let card;
  try {
    card = await call(prCardPrompt({ page: { title: title || 'Pull request', url: prUrl }, steps, glossary }), 300_000);
  } catch (e) {
    const checks = await checking;
    throw Object.assign(e, { usage: sumUsage([...spent, ...(checks || []).map((c) => c.usage)]) });
  }
  const checker = await mermaidChecker(root);
  if (!checker) log('playwright not found: the diagram is not syntax-checked');
  try {
    let error = await checker?.check(card.mermaid);
    if (error) {
      card.mermaid = (await call(repairPrompt({ mermaid: card.mermaid, error }), 120_000)).mermaid;
      error = await checker.check(card.mermaid);
    }
    if (error) {
      const checks = await checking;
      throw Object.assign(new Error(`diagram doesn't parse: ${error.split('\n')[0]}`), { usage: sumUsage([...spent, ...(checks || []).map((c) => c.usage)]) });
    }
  } finally {
    await checker?.close();
  }

  const checks = await checking;
  for (const c of checks || []) if (c.error) log(`step ${c.id} not checked: ${c.error}`);
  const costs = checks ? { diagram: sumUsage(spent), checks: sumUsage(checks.map((c) => c.usage)) } : null;
  const usage = sumUsage([...spent, ...(checks || []).map((c) => c.usage)]);
  const body = prComment({ card, steps, sha, repoUrl, usage, checked: !!checker, version: docvizVersion(), checks, costs });
  return { body, missing: missingSteps(steps, card.mermaid), usage, checks };
}
