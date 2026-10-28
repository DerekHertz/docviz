// Runs the user's own CLI. The extension never sees credentials; each CLI uses
// whatever account it is already logged in to.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

// An empty working dir so neither CLI picks up a project's CLAUDE.md / AGENTS.md.
const WORKDIR = join(homedir(), '.cache', 'docviz', 'work');
mkdirSync(WORKDIR, { recursive: true });

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

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
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
  if (res.is_error) throw httpError(502, `claude error: ${res.result || res.subtype}`);
  if (res.structured_output) return res.structured_output;
  try { return JSON.parse(res.result); } catch { throw httpError(502, 'claude returned no structured output'); }
}

async function runCodex({ system, prompt, schema, search = false, model, timeoutMs }) {
  const dir = mkdtempSync(join(tmpdir(), 'docviz-'));
  try {
    const schemaFile = join(dir, 'schema.json');
    const outFile = join(dir, 'out.json');
    writeFileSync(schemaFile, JSON.stringify(schema));
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only',
      '-C', WORKDIR, '--output-schema', schemaFile, '-o', outFile];
    if (search) args.push('--search');
    if (model) args.push('-m', model);
    args.push('-');
    // codex has no system-prompt flag; the instructions lead the prompt instead.
    await run('codex', args, `${system}\n\n---\n\n${prompt}`, timeoutMs);
    const text = readFileSync(outFile, 'utf8');
    try { return JSON.parse(text); } catch { throw httpError(502, `codex returned non-JSON: ${text.slice(0, 300)}`); }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function complete(provider, job) {
  if (provider === 'claude') return runClaude({ ...job, tools: job.research ? ['WebSearch', 'WebFetch'] : [] });
  return runCodex({ ...job, search: !!job.research });
}
