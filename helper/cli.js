#!/usr/bin/env node
// docviz [serve] [--port N] [--host H] [--provider auto|claude|codex] [--model M] [--codex-rates in,cached,out,image] [--new-code]
// docviz lab [--port 47830]   (repo checkout only: the lab needs Playwright)
// docviz pr <steps.json> --pr <url> [--title T] [--glossary FILE] [--provider P] [--model M] [--codex-rates ...]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './server.js';
import { setCodexRates } from './providers.js';
import { runPr, money } from './pr.js';

const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'docviz');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

function parseArgs(argv) {
  const opts = { cmd: 'serve', args: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { if (i === 0) opts.cmd = a; else opts.args.push(a); continue; }
    const key = a.slice(2);
    if (key === 'new-code' || key === 'help') opts[key] = true;
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
if (opts.help || !['serve', 'code', 'pr', 'lab'].includes(opts.cmd) || (opts.cmd === 'pr' && (!opts.args[0] || !opts.pr))) {
  console.log(`docviz — local helper for the docviz Chrome extension

  docviz serve [--port 47823] [--host 127.0.0.1] [--provider auto|claude|codex] [--model M] [--new-code]
               [--codex-rates in,cached,out,image]   USD per 1M tokens + per picture, for Codex cost estimates
  docviz code            print the pairing code
  docviz pr <steps.json> --pr <url> [--title T] [--glossary FILE] [--provider P] [--model M]
                         print a PR comment: one diagram of the PR's flow, code links, its cost
  docviz lab [--port 47830]
                         open the lab: try a check (Jev first) on known-good and known-broken cases`);
  process.exit(opts.help ? 0 : 1);
}

if (opts['codex-rates']) setCodexRates(opts['codex-rates']);

if (opts.cmd === 'pr') {
  const log = (m) => console.error(m);
  try {
    const { body, missing, usage } = await runPr({
      stepsFile: opts.args[0], prUrl: opts.pr, title: opts.title, glossaryFile: opts.glossary,
      provider: opts.provider, model: opts.model, log,
    });
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
