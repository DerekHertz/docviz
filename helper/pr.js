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

export const MARKER = '<!-- docviz-pr-diagrams -->';
const DOCVIZ_REPO = 'https://github.com/DerekHertz/docviz';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The reviewed checkout's .git/config is untrusted: switch off the settings that run commands.
export const UNTRUSTED_GIT = ['-c', 'core.fsmonitor=', '-c', 'core.hooksPath=/dev/null'];

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

export function prComment({ card, steps, sha, repoUrl, usage, checked, version }) {
  const link = (c) => `[\`${c.path}:${c.start}-${c.end}\`](${repoUrl}/blob/${sha}/${c.path}#L${c.start}-L${c.end})`;
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
    '| Step | | Code |',
    '|---|---|---|',
    ...steps.map((s) => `| ${s.label} | ${s.changed ? 'new' : ''} | ${s.cuts.map(link).join('<br>')} |`),
    '',
    `<sub>Diagram by [docviz](${DOCVIZ_REPO}) \`${version}\`, ${checked ? 'checked against Mermaid 11' : 'not syntax-checked'}, cost ${money(usage)}.</sub>`,
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

function docvizVersion() {
  try { return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
}

/** Returns { body, missing, usage }; throws with `usage` when the diagram can't be used. */
export async function runPr({ stepsFile, prUrl, title, glossaryFile, provider: requested, model, log = () => {} }) {
  const git = (...a) => execFileSync('git', [...UNTRUSTED_GIT, ...a], { encoding: 'utf8' }).trim();
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

  const card = await call(prCardPrompt({ page: { title: title || 'Pull request', url: prUrl }, steps, glossary }), 300_000);
  const checker = await mermaidChecker();
  if (!checker) log('playwright not found: the diagram is not syntax-checked');
  try {
    let error = await checker?.check(card.mermaid);
    if (error) {
      card.mermaid = (await call(repairPrompt({ mermaid: card.mermaid, error }), 120_000)).mermaid;
      error = await checker.check(card.mermaid);
    }
    if (error) throw Object.assign(new Error(`diagram doesn't parse: ${error.split('\n')[0]}`), { usage: sumUsage(spent) });
  } finally {
    await checker?.close();
  }

  const usage = sumUsage(spent);
  const body = prComment({ card, steps, sha, repoUrl, usage, checked: !!checker, version: docvizVersion() });
  return { body, missing: missingSteps(steps, card.mermaid), usage };
}
