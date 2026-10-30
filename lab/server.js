#!/usr/bin/env node
// docviz lab: a local page for trying a new evaluator (Jev first) on known-good and
// known-broken cases, watching each decision arrive, and recording whether to adopt it.
//   npm run lab [-- --port 47830]
// Experiments are modules in lab/experiments/ exporting meta, cases() and evaluate().
import { createServer } from 'node:http';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { askJev } from '../helper/jev.js';
import { judge, judge3, decide, applyTruth } from './metrics.js';
import { render } from './render.js';

const LAB = new URL('.', import.meta.url).pathname;
const RUNS = join(LAB, 'runs');
const DECISIONS = join(LAB, 'decisions.json');
const CONCURRENCY = 4;

const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return fallback; } };

async function loadExperiments() {
  const out = {};
  for (const f of readdirSync(join(LAB, 'experiments')).filter((n) => n.endsWith('.js')).sort()) {
    const mod = await import(join(LAB, 'experiments', f));
    out[mod.meta.id] = mod;
  }
  return out;
}

const runFiles = (id) => {
  const dir = join(RUNS, id);
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.json')).sort().map((n) => join(dir, n)) : [];
};
const lastRun = (id) => { const f = runFiles(id).at(-1); return f ? readJson(f, null) : null; };
// The run saved just before `run`, for repeatability.
const runBefore = (id, run) => {
  const earlier = runFiles(id).map((f) => readJson(f, null)).filter((r) => r && r.at < run.at);
  return earlier.at(-1) || null;
};

// The truth for a case: the experiment's label, unless the user overrode it in the lab.
const withTruth = (cases, overrides) => applyTruth(cases, overrides);

// Labels belong to the cases, not to one way of asking: versions in the same group (C3 yes/no
// and three options) share them, saved under "labels:<group>".
const labelsKey = (exp) => (exp.meta.group ? `labels:${exp.meta.group}` : exp.meta.id);
function decisionFor(all, exp) {
  const own = all[exp.meta.id];
  const overrides = exp.meta.group ? all[labelsKey(exp)]?.overrides : own?.overrides;
  return own || overrides ? { ...own, overrides: overrides || {} } : null;
}

function summarize(exp, run, decision) {
  if (!run) return null;
  const truth = withTruth(exp.cases(), decision?.overrides);
  const byId = Object.fromEntries(truth.map((c) => [c.id, c]));
  const bar = { ...exp.meta.bar, ...decision?.bar };
  // The previous run's answers, judged by today's bar: a change here is the model, not the bar.
  const prev = runBefore(exp.meta.id, run)?.results.filter((r) => r.flag != null) || null;
  if (exp.meta.mode === 'three-way') {
    const before = prev && Object.fromEntries(prev.map((r) => [r.id, { flag: r.flag, verdict: decide(exp.meta.decide, r, bar) }]));
    const rows = run.results.filter((r) => byId[r.id]).map((r) => ({ ...byId[r.id], flag: r.flag, verdict: decide(exp.meta.decide, r, bar), usd: r.usage?.usd || 0 }));
    return judge3(rows, bar, before || undefined);
  }
  const before = prev && Object.fromEntries(prev.map((r) => [r.id, r.flag]));
  const scored = run.results.filter((r) => r.flag != null && byId[r.id]).map((r) => ({ ...byId[r.id], flag: r.flag, usd: r.usage?.usd || 0 }));
  return judge(scored, bar, before || undefined);
}

export async function startLab({ port = 47830, host = '127.0.0.1', log = console.log } = {}) {
  const experiments = await loadExperiments();
  const decisions = () => readJson(DECISIONS, {});
  const PAGE = join(LAB, 'page');
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://lab');
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    // Local only: a page elsewhere can't reach us by DNS rebinding, and can't POST without the
    // custom header (it forces a CORS preflight this server never answers).
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) return json(403, { error: 'bad host' });
    if (req.method === 'POST' && req.headers['x-docviz-lab'] !== '1') return json(403, { error: 'missing x-docviz-lab' });

    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname.startsWith('/page/'))) {
        const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(6);
        if (!/^[\w.-]+$/.test(name)) return json(404, { error: 'not found' });
        res.writeHead(200, { 'content-type': TYPES[extname(name)] || 'text/plain', 'content-security-policy': "default-src 'self'; img-src 'self'; style-src 'self'" });
        return res.end(readFileSync(join(PAGE, name)));
      }

      if (req.method === 'GET' && url.pathname === '/api/experiments') {
        const d = decisions();
        return json(200, Object.values(experiments).map((e) => {
          const run = lastRun(e.meta.id);
          return { ...e.meta, cases: e.cases().length, lastRun: run && { at: run.at, usd: run.usd }, verdict: summarize(e, run, decisionFor(d, e)), decision: decisionFor(d, e) };
        }));
      }

      let m = url.pathname.match(/^\/api\/experiments\/([\w-]+)$/);
      if (req.method === 'GET' && m && experiments[m[1]]) {
        const e = experiments[m[1]];
        const d = decisionFor(decisions(), e);
        const run = lastRun(m[1]);
        const cases = withTruth(e.cases(), d?.overrides);
        return json(200, { meta: e.meta, mutations: e.mutationNames || {}, kinds: kinds(e, cases), hasImage: !!e.image, cases, run, verdict: summarize(e, run, d), decision: d || null });
      }

      m = url.pathname.match(/^\/api\/image\/([\w-]+)\/(.+)$/);
      if (req.method === 'GET' && m && experiments[m[1]]) {
        const c = experiments[m[1]].cases().find((x) => x.id === decodeURIComponent(m[2]));
        if (!c) return json(404, { error: 'no such case' });
        if (!experiments[m[1]].image) return json(404, { error: 'this experiment has no images' });
        const { mermaid: src, ...opts } = experiments[m[1]].image(c);
        const png = await render(src, opts).catch((e) => { if (e.kind === 'render') return null; throw e; });
        if (!png) return json(422, { error: 'render' });
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=3600' });
        return res.end(png);
      }

      m = url.pathname.match(/^\/api\/run\/([\w-]+)$/);
      if (req.method === 'POST' && m && experiments[m[1]]) return runExperiment(experiments[m[1]], req, res, log);

      m = url.pathname.match(/^\/api\/decision\/([\w-]+)$/);
      if (req.method === 'POST' && m && experiments[m[1]]) {
        const body = JSON.parse(await readBody(req));
        const all = decisions();
        const e = experiments[m[1]];
        const { overrides, ...rest } = pick(body, ['verdict', 'note', 'bar', 'overrides']);
        if (overrides) {
          const key = labelsKey(e);
          all[key] = { ...all[key], overrides };
        }
        if (Object.keys(rest).length || !e.meta.group) all[m[1]] = { ...all[m[1]], ...rest, at: new Date().toISOString() };
        writeFileSync(DECISIONS, `${JSON.stringify(all, null, 2)}\n`);
        const d = decisionFor(all, e);
        return json(200, { decision: d, verdict: summarize(e, lastRun(m[1]), d), cases: withTruth(e.cases(), d?.overrides) });
      }

      json(404, { error: 'not found' });
    } catch (err) {
      log(`✗ ${url.pathname}: ${err.message}`);
      if (!res.headersSent) json(500, { error: err.message });
      else res.end();
    }
  });

  await new Promise((r) => server.listen(port, host, r));
  log(`docviz lab on http://${host}:${port}`);
  return server;
}

// One row per kind of case, for the "what's tested" table: what it is, how it's made, its truth.
function kinds(exp, cases) {
  return Object.entries(exp.mutationNames || {}).map(([key, note]) => {
    const of = cases.filter((c) => c.mutation === key);
    return { key, note, how: exp.mutationHow?.[key] || '', truth: of[0]?.truth || (of.some((c) => c.bad) ? 'bad' : 'good'), injection: of.some((c) => c.injection), n: of.length };
  });
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (d) => { s += d; if (s.length > 1e6) reject(new Error('body too large')); });
    req.on('end', () => resolve(s || '{}'));
    req.on('error', reject);
  });
}

// Streams one NDJSON line per decision as it lands, then the verdict. The run is saved even if
// the page goes away, and every call's spend is in it.
async function runExperiment(exp, req, res, log) {
  const body = JSON.parse(await readBody(req));
  const decision = decisionFor(readJson(DECISIONS, {}), exp);
  let cases = withTruth(exp.cases(), decision?.overrides);
  if (Array.isArray(body.only)) cases = cases.filter((c) => body.only.includes(c.id));
  const prev = lastRun(exp.meta.id);
  const previous = prev ? Object.fromEntries(prev.results.filter((r) => r.flag != null).map((r) => [r.id, r.flag])) : null;

  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
  const send = (o) => { if (!res.writableEnded) res.write(`${JSON.stringify(o)}\n`); };
  send({ type: 'start', total: cases.length });
  log(`→ ${exp.meta.id}: ${cases.length} cases`);

  const results = [];
  let usd = 0;
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const c = cases[next++];
      send({ type: 'asking', id: c.id });
      const started = Date.now();
      try {
        const r = await exp.evaluate(c, { render, ask: askJev });
        usd += r.usage.usd;
        const row = { id: c.id, flag: r.flag, prob: r.prob, probContra: r.probContra, choice: r.choice, probabilities: r.probabilities, confidence: r.confidence, answers: r.answers, usage: r.usage, asked: r.asked, ms: Date.now() - started };
        results.push(row);
        send({ type: 'case', ...row, usdSoFar: usd });
      } catch (err) {
        usd += err.usage?.usd || 0;
        const row = { id: c.id, flag: null, error: err.message, kind: err.kind || 'evaluator', usage: err.usage || null, ms: Date.now() - started };
        results.push(row);
        send({ type: 'case', ...row, usdSoFar: usd });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const run = { experiment: exp.meta.id, at: new Date().toISOString(), usd, previous, results };
  // A partial rerun ("only") merges into the last full run, so the verdict still covers every case.
  if (body.only && prev) {
    const fresh = new Set(results.map((r) => r.id));
    run.results = [...prev.results.filter((r) => !fresh.has(r.id)), ...results];
  }
  mkdirSync(join(RUNS, exp.meta.id), { recursive: true });
  writeFileSync(join(RUNS, exp.meta.id, `${run.at.replace(/[:.]/g, '-')}.json`), JSON.stringify(run));
  const verdict = summarize(exp, run, decision);
  log(`✓ ${exp.meta.id}: ${verdict?.pass ? 'PASS' : 'FAIL'} · $${usd.toFixed(5)}`);
  send({ type: 'done', usd, verdict, errors: results.filter((r) => r.error).length });
  res.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--port');
  startLab({ port: i > 0 ? Number(process.argv[i + 1]) : 47830 }).catch((e) => { console.error(e.message); process.exit(1); });
}
