#!/usr/bin/env node
// verify-docviz harness. Every command writes its proof under the run's evidence folder, which
// cleanup never removes. Usage: see ../SKILL.md.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCVIZ = resolve(SKILL, '../../..');
const [cmd, runId = process.env.RUN_ID, ...rest] = process.argv.slice(2);
const flags = new Set(rest);
const scratch = (id) => join(tmpdir(), `docviz-verify-${id}`);
const evidence = (id) => join(process.env.DOCVIZ_VERIFY_OUT || join(homedir(), '.local/state/docviz-verify'), id);
const sh = (bin, args, opts = {}) => execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const has = (bin) => { try { sh('sh', ['-c', `command -v ${bin}`]); return true; } catch { return false; } };
const save = (id, name, data) => { mkdirSync(evidence(id), { recursive: true }); writeFileSync(join(evidence(id), name), typeof data === 'string' ? data : JSON.stringify(data, null, 2)); };
const need = () => { if (!runId) { console.error('give a run id: verify.mjs <cmd> <run-id>'); process.exit(64); } };

function playwright() {
  try { return createRequire(join(DOCVIZ, 'package.json'))('playwright'); } catch { return null; }
}

const commands = {
  // Read-only: is this checkout worth driving?
  doctor() {
    const node = process.versions.node;
    const report = {
      docviz: DOCVIZ,
      head: sh('git', ['-C', DOCVIZ, 'rev-parse', '--short', 'HEAD']),
      dirty: !!sh('git', ['-C', DOCVIZ, 'status', '--porcelain', '--untracked-files=no']),
      node, nodeOk: Number(node.split('.')[0]) >= 22,
      git: has('git'), claude: has('claude'), codex: has('codex'),
      playwright: !!playwright(), mermaidBundle: existsSync(join(DOCVIZ, 'extension/vendor/mermaid.min.js')),
      jevKey: !!process.env.TYPESAFE_API_KEY,
    };
    report.ok = report.nodeOk && report.git && (report.claude || report.codex);
    console.log(JSON.stringify(report, null, 2));
    if (runId) save(runId, 'doctor.json', report);
    process.exit(report.ok ? 0 : 1);
  },

  // A disposable checkout of a fixture's repo at its commit, plus its steps.json.
  fixture() {
    need();
    const name = rest[0];
    const f = JSON.parse(readFileSync(join(SKILL, 'fixtures', `${name}.json`), 'utf8'));
    const dir = scratch(runId);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const src = f.source === '.' ? DOCVIZ : f.source;
    sh('git', ['clone', '--quiet', '--no-checkout', src, join(dir, 'repo')]);
    sh('git', ['-C', join(dir, 'repo'), '-c', 'advice.detachedHead=false', 'checkout', '--quiet', f.sha]);
    sh('git', ['-C', join(dir, 'repo'), 'remote', 'set-url', 'origin', f.origin]);
    writeFileSync(join(dir, 'steps.json'), JSON.stringify({ steps: f.steps }, null, 2));
    writeFileSync(join(dir, 'fixture.json'), JSON.stringify({ name, pr: f.pr, title: f.title }));
    save(runId, 'fixture.json', { name, sha: f.sha, pr: f.pr, scratch: dir });
    console.log(`fixture ${name} at ${f.sha.slice(0, 7)} in ${dir}`);
  },

  // The user path: run `docviz pr` from inside the reviewed checkout.
  pr() {
    need();
    const dir = scratch(runId);
    const fx = JSON.parse(readFileSync(join(dir, 'fixture.json'), 'utf8'));
    const args = [join(DOCVIZ, 'helper/cli.js'), 'pr', join(dir, 'steps.json'), '--pr', fx.pr, '--title', fx.title];
    if (flags.has('--no-check')) args.push('--no-check');
    const t0 = Date.now();
    const r = spawnSync('node', args, { cwd: join(dir, 'repo'), encoding: 'utf8', timeout: 600_000 });
    const stdout = r.stdout || '', stderr = r.stderr || '', exit = r.status ?? 1;
    const seconds = (Date.now() - t0) / 1000;
    save(runId, 'comment.md', stdout);
    save(runId, 'pr-run.json', { command: ['node', ...args].join(' '), cwd: join(dir, 'repo'), exit, seconds, stderr });
    console.log(JSON.stringify({ exit, seconds, stderr: stderr.trim().split('\n').slice(-4) }, null, 2));
    process.exit(exit);
  },

  // Parse the comment's Mermaid with docviz's own bundle and render it to a PNG.
  async mermaid() {
    need();
    const pw = playwright();
    if (!pw) { console.error('playwright not found next to docviz: cannot render'); process.exit(1); }
    const md = readFileSync(join(evidence(runId), 'comment.md'), 'utf8');
    const src = md.match(/```mermaid\n([\s\S]*?)```/)?.[1];
    if (!src) { console.error('no mermaid block in comment.md'); process.exit(1); }
    const browser = await pw.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 2 });
    await page.setContent('<body style="background:#0d1117;margin:0;padding:24px"><div id="d"></div></body>');
    await page.addScriptTag({ path: join(DOCVIZ, 'extension/vendor/mermaid.min.js') });
    const result = await page.evaluate(async (s) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' });
      try { await mermaid.parse(s); const { svg } = await mermaid.render('m', s); document.getElementById('d').innerHTML = svg; return { parsed: true }; }
      catch (e) { return { parsed: false, error: String(e.message || e) }; }
    }, src);
    if (result.parsed) await page.locator('#d svg').screenshot({ path: join(evidence(runId), 'diagram-dark.png') });
    await browser.close();
    save(runId, 'mermaid.json', result);
    console.log(JSON.stringify(result));
    process.exit(result.parsed ? 0 : 1);
  },

  // The helper API on a free port, with its own config folder so it never touches the user's pairing.
  async api() {
    need();
    const port = await new Promise((ok) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
    const cfg = join(scratch(runId), 'config');
    mkdirSync(cfg, { recursive: true });
    const child = spawn('node', [join(DOCVIZ, 'helper/cli.js'), 'serve', '--port', String(port)], { env: { ...process.env, XDG_CONFIG_HOME: cfg }, stdio: 'ignore' });
    writeFileSync(join(scratch(runId), 'api.pid'), String(child.pid));
    let health = null;
    for (let i = 0; i < 40 && !health; i++) {
      await new Promise((r) => setTimeout(r, 250));
      health = await fetch(`http://127.0.0.1:${port}/v1/health`).then((r) => r.json()).catch(() => null);
    }
    const token = JSON.parse(readFileSync(join(cfg, 'docviz/config.json'), 'utf8')).token;
    const paired = await fetch(`http://127.0.0.1:${port}/v1/health`, { headers: { 'x-docviz-token': token } }).then((r) => r.json()).catch((e) => ({ error: e.message }));
    const refused = await fetch(`http://127.0.0.1:${port}/v1/card`, { method: 'POST', headers: { 'x-docviz-token': 'WRONG-CODE' }, body: '{}' }).then((r) => r.status).catch(() => null);
    child.kill();
    save(runId, 'api.json', { port, health, paired, wrongTokenStatus: refused });
    console.log(JSON.stringify({ port, health, paired, wrongTokenStatus: refused }, null, 2));
    process.exit(health && refused === 401 ? 0 : 1);
  },

  // Remove what this run created; the evidence folder stays.
  cleanup() {
    need();
    const dir = scratch(runId);
    const pidFile = join(dir, 'api.pid');
    if (existsSync(pidFile)) { try { process.kill(Number(readFileSync(pidFile, 'utf8')), 0) && process.kill(Number(readFileSync(pidFile, 'utf8'))); } catch {} }
    rmSync(dir, { recursive: true, force: true });
    console.log(`removed ${dir}; evidence kept in ${evidence(runId)}`);
  },
};

if (!commands[cmd]) {
  console.error('verify.mjs doctor|fixture|pr|mermaid|api|cleanup <run-id> [args]');
  process.exit(64);
}
await commands[cmd]();
