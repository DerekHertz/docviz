#!/usr/bin/env node
// docviz [serve] [--port N] [--host H] [--provider auto|claude|codex] [--model M] [--codex-rates in,cached,out,image] [--new-code]
// docviz lab [--port 47830]   (repo checkout only: the lab needs Playwright)
// docviz pr <steps.json> --pr <url> [--title T] [--glossary FILE] [--base REF] [--provider P] [--model M] [--codex-rates ...] [--no-check]
//           [--trust-atlas] [--contracts PROFILE.json [--trust-head SHA] [--coverage-out FILE]]
// docviz pr --rules [--glossary FILE]   |   docviz pr --lint <steps.json>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './server.js';
import { setCodexRates } from './providers.js';
import { runPr, lintDoc, money } from './pr.js';
import { prAgentRules } from './prompts.js';

const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'docviz');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

function parseArgs(argv) {
  const opts = { cmd: 'serve', args: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { if (i === 0) opts.cmd = a; else opts.args.push(a); continue; }
    const key = a.slice(2);
    if (key === 'new-code' || key === 'help' || key === 'no-check' || key === 'rules' || key === 'trust-atlas') opts[key] = true;
    else opts[key] = argv[++i];
  }
  return opts;
}

// Unambiguous alphabet: no 0/O, 1/I/L.
function newCode() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({ length: 4 }, () => abc[randomInt(abc.length)]).join('');
  return `${part()}-${part()}`;
}

function loadConfig(regenerate) {
  let cfg = {};
  try { cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch {}
  if (!cfg.token || regenerate) {
    cfg.token = newCode();
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  }
  return cfg;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help || !['serve', 'code', 'pr', 'lab'].includes(opts.cmd) || (opts.cmd === 'pr' && !opts.rules && !opts.lint && (!opts.args[0] || !opts.pr))) {
  console.log(`docviz — local helper for the docviz Chrome extension

  docviz serve [--port 47823] [--host 127.0.0.1] [--provider auto|claude|codex] [--model M] [--new-code]
               [--codex-rates in,cached,out,image]   USD per 1M tokens + per picture, for Codex cost estimates
  docviz code            print the pairing code
  docviz pr <steps.json> --pr <url> [--title T] [--glossary FILE] [--base REF] [--provider P] [--model M] [--no-check]
                         print a PR comment: one diagram of the PR's flow, code links, its cost.
                         With TYPESAFE_API_KEY set, Jev checks each step's label against its code.
                         A "card": { "caption", "mermaid" } in steps.json is used as is: no model call
            [--base REF] compare modules and behavior with REF (default: merge base with origin/main, else HEAD~1)
            [--trust-atlas]
                         run the repo's .atlas/ models (TLC, via pstack's statechart) at base and head.
                         It imports the model's view.mjs: pass it on your own repos only
            [--contracts PROFILE.json]
                         check the contracts in your profile (kept outside the reviewed checkout) whatever
                         the summary covers: which apply to the changed files, and which steps leave them out
            [--trust-head SHA]
                         run docviz's registered contract harnesses against exactly this commit's code.
                         SHA is HEAD's full SHA (git rev-parse HEAD); short SHAs, tags and branches are refused
            [--coverage-out FILE]
                         write the contract coverage result as JSON (for the review studio)
  docviz pr --rules [--glossary FILE]
                         print the rules for the diagram an agent writes itself
  docviz pr --lint <steps.json>
                         check that card: one failure per line, exit 1 if any
  docviz lab [--port 47830]
                         open the lab: try a check (Jev first) on known-good and known-broken cases`);
  process.exit(opts.help ? 0 : 1);
}

if (opts['codex-rates']) setCodexRates(opts['codex-rates']);

if (opts.cmd === 'pr' && opts.rules) {
  console.log(prAgentRules(opts.glossary ? readFileSync(opts.glossary, 'utf8') : ''));
  process.exit(0);
}

if (opts.cmd === 'pr' && opts.lint) {
  try {
    const { errors, parsed } = await lintDoc(JSON.parse(readFileSync(opts.lint, 'utf8')));
    if (errors.length) console.log(errors.join('\n'));
    else console.log(parsed ? 'ok' : 'ok (Mermaid not parsed: playwright not found)');
    process.exit(errors.length ? 1 : 0);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}

if (opts.cmd === 'pr') {
  const log = (m) => console.error(m);
  try {
    if ((opts['trust-head'] || opts['coverage-out']) && !opts.contracts) throw new Error('--trust-head and --coverage-out need --contracts PROFILE.json');
    const { body, missing, usage, coverage } = await runPr({
      stepsFile: opts.args[0], prUrl: opts.pr, title: opts.title, glossaryFile: opts.glossary,
      provider: opts.provider, model: opts.model, check: !opts['no-check'], base: opts.base, trustAtlas: !!opts['trust-atlas'],
      contracts: opts.contracts, trustHead: opts['trust-head'], log,
    });
    if (opts['coverage-out']) writeFileSync(opts['coverage-out'], JSON.stringify(coverage, null, 2) + '\n');
    if (missing.length) log(`warning: steps not drawn as nodes: ${missing.join(', ')}`);
    log(`cost: ${money(usage)}`);
    process.stdout.write(body);
    process.exit(0);
  } catch (e) {
    console.error(e.message);
    if (e.usage) console.error(`cost: ${money(e.usage)}`);
    process.exit(2);
  }
}

if (opts.cmd === 'lab') {
  // The lab lives next to the helper in a repo checkout; the published package leaves it out.
  const lab = await import('../lab/server.js').catch((e) => {
    console.error(e.code === 'ERR_MODULE_NOT_FOUND'
      ? `The lab needs a docviz checkout with dev dependencies (npm install): ${e.message.split('\n')[0]}`
      : e.message);
    process.exit(1);
  });
  await lab.startLab({ port: Number(opts.port || 47830) });
} else {
  const cfg = loadConfig(opts['new-code']);
  if (opts.cmd === 'code') {
    console.log(cfg.token);
    process.exit(0);
  }

  const port = Number(opts.port || process.env.DOCVIZ_PORT || 47823);
  const host = opts.host || '127.0.0.1';
  const provider = opts.provider || 'auto';
  const log = (m) => console.log(`${new Date().toLocaleTimeString()}  ${m}`);

  startServer({ host, port, token: cfg.token, provider, model: opts.model, log })
    .then(({ available }) => {
      const found = Object.entries(available).filter(([, v]) => v).map(([k]) => k);
      console.log(`
    docviz helper listening on http://${host}:${port}
    CLIs found:    ${found.join(', ') || 'none — install Claude Code or Codex'}
    Using:         ${provider === 'auto' ? `${found[0] || '—'} (auto)` : provider}
    Pictures:      ${available.codex ? 'codex (image_gen)' : 'off — install Codex to enable'}

    Pairing code:  ${cfg.token}
    Paste it into the extension's setup page once.
  `);
    })
    .catch((e) => {
      console.error(e.code === 'EADDRINUSE' ? `Port ${port} is in use — is docviz already running?` : e.message);
      process.exit(1);
    });
}
