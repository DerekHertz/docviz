// Runs the user's own CLI. The extension never sees credentials; each CLI uses
// whatever account it is already logged in to.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

// An empty working dir so neither CLI picks up a project's CLAUDE.md / AGENTS.md.
const WORKDIR = join(homedir(), '.cache', 'docviz', 'work');
mkdirSync(WORKDIR, { recursive: true });
export const IMAGES = join(homedir(), '.cache', 'docviz', 'images');
mkdirSync(IMAGES, { recursive: true });
const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), '.codex');

// Codex reports tokens but no price, so dollars for it are an estimate from
// these per-1M-token rates (plus a flat per-picture rate). Override with
// `docviz serve --codex-rates in,cached,out,image` when you know your real ones.
export const CODEX_RATES = { input: 1.25, cached: 0.125, output: 10, image: 0.1 };
export function setCodexRates(csv) {
  // Blank fields keep their default: "2,,20" sets input and output only.
  const [input, cached, output, image] = String(csv).split(',').map((v) => (v.trim() === '' ? NaN : Number(v)));
  Object.assign(CODEX_RATES, Object.fromEntries(Object.entries({ input, cached, output, image }).filter(([, v]) => Number.isFinite(v))));
}

export function detectProviders() {
  const has = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' }).status === 0;
  return { claude: has('claude'), codex: has('codex') };
}

export function pickProvider(requested, available) {
  if (requested && requested !== 'auto') {
    if (!available[requested]) throw httpError(503, `${requested} CLI not found on PATH`);
    return requested;
  }
  if (available.claude) return 'claude';
  if (available.codex) return 'codex';
  throw httpError(503, 'Neither claude nor codex CLI found on PATH');
}

// `usage` rides on errors raised after the CLI already spent, so the caller can still charge it.
export function httpError(status, message, usage) {
  return Object.assign(new Error(message), { status }, usage && { usage });
}

function run(bin, args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: WORKDIR, env: process.env });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(httpError(504, `${bin} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(httpError(503, `${bin}: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(httpError(502, `${bin} exited ${code}: ${(err || out).slice(-800)}`));
      resolve(out);
    });
    child.stdin.end(input);
  });
}

async function runClaude({ system, prompt, schema, tools = [], model, timeoutMs }) {
  const args = [
    '-p', '--output-format', 'json',
    '--no-session-persistence',
    // Keep the CLI lean: no MCP servers, user settings, skills, or dynamic prompt sections.
    // Without these, a call carries ~90k tokens of the user's setup and takes 3x longer.
    '--strict-mcp-config', '--setting-sources', 'project', '--disable-slash-commands',
    '--exclude-dynamic-system-prompt-sections',
    '--system-prompt', system,
    '--json-schema', JSON.stringify(schema),
  ];
  if (tools.length) args.push('--tools', tools.join(','), '--allowedTools', tools.join(','));
  else args.push('--tools', '');
  if (model) args.push('--model', model);
  const out = await run('claude', args, prompt, timeoutMs);
  let res;
  try { res = JSON.parse(out); } catch { throw httpError(502, `claude returned non-JSON: ${out.slice(0, 300)}`); }
  const u = res.usage || {};
  const usage = {
    // Claude Code prices every call itself (list price; on a Pro/Max login that is
    // the API-equivalent of what the call used from your plan).
    usd: res.total_cost_usd ?? 0,
    estimated: false,
    inputTokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
    outputTokens: u.output_tokens || 0,
    model: Object.keys(res.modelUsage || {})[0] || model || '',
  };
  if (res.is_error) throw httpError(502, `claude error: ${res.result || res.subtype}`, usage);
  if (res.structured_output) return { output: res.structured_output, usage };
  try { return { output: JSON.parse(res.result), usage }; } catch { throw httpError(502, 'claude returned no structured output', usage); }
}

// `codex exec --json` streams events; the thread id names the folder generated
// images land in, and turn.completed carries the token counts.
function parseCodexEvents(stdout) {
  let threadId = '';
  const t = { input: 0, cached: 0, output: 0 };
  for (const line of stdout.split('\n')) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'thread.started') threadId = ev.thread_id;
    if (ev.type === 'turn.completed' && ev.usage) {
      t.input += ev.usage.input_tokens || 0;
      t.cached += ev.usage.cached_input_tokens || 0;
      t.output += (ev.usage.output_tokens || 0) + (ev.usage.reasoning_output_tokens || 0);
    }
  }
  return { threadId, t };
}

function codexUsage(t, model, images = 0) {
  const r = CODEX_RATES;
  const usd = ((t.input - t.cached) * r.input + t.cached * r.cached + t.output * r.output) / 1e6 + images * r.image;
  return { usd, estimated: true, inputTokens: t.input, outputTokens: t.output, images, model: model || 'codex default' };
}

const LEAN_CODEX = ['exec', '--skip-git-repo-check', '--ephemeral', '--json',
  // Skip the user's MCP servers, skills and rules: ~80k tokens of overhead down to ~20k.
  '--ignore-user-config', '--ignore-rules'];

async function runCodex({ system, prompt, schema, search = false, model, timeoutMs }) {
  const dir = mkdtempSync(join(tmpdir(), 'docviz-'));
  try {
    const schemaFile = join(dir, 'schema.json');
    const outFile = join(dir, 'out.json');
    writeFileSync(schemaFile, JSON.stringify(schema));
    const args = [...LEAN_CODEX, '--sandbox', 'read-only',
      '-C', WORKDIR, '--output-schema', schemaFile, '-o', outFile];
    if (search) args.push('--search');
    if (model) args.push('-m', model);
    args.push('-');
    // codex has no system-prompt flag; the instructions lead the prompt instead.
    const stdout = await run('codex', args, `${system}\n\n---\n\n${prompt}`, timeoutMs);
    const text = readFileSync(outFile, 'utf8');
    const usage = codexUsage(parseCodexEvents(stdout).t, model);
    try { return { output: JSON.parse(text), usage }; } catch { throw httpError(502, `codex returned non-JSON: ${text.slice(0, 300)}`, usage); }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Pictures always come from Codex's built-in image_gen tool. It saves under
// $CODEX_HOME/generated_images/<thread>/; we copy the newest one into our cache.
export async function illustrate({ prompt, model, timeoutMs }) {
  const args = [...LEAN_CODEX, '--enable', 'image_generation', '--sandbox', 'read-only', '-C', WORKDIR];
  if (model) args.push('-m', model);
  args.push('-');
  const stdout = await run('codex', args, prompt, timeoutMs);
  const { threadId, t } = parseCodexEvents(stdout);
  const dir = join(CODEX_HOME, 'generated_images', threadId);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => join(dir, f)); } catch {}
  if (!threadId || !files.length) throw httpError(502, 'codex finished without generating a picture', codexUsage(t, model));
  const newest = files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  const imageId = randomUUID();
  copyFileSync(newest, join(IMAGES, `${imageId}.png`));
  return { output: { imageId }, usage: codexUsage(t, model, 1) };
}

export function complete(provider, job) {
  if (provider === 'claude') return runClaude({ ...job, tools: job.research ? ['WebSearch', 'WebFetch'] : [] });
  return runCodex({ ...job, search: !!job.research });
}
