// Contract coverage for `docviz pr`: obligations from an operator-selected profile, never from the
// author's summary. Each contract's applicability comes from the changed paths; the summary only
// annotates which of its code anchors no step covers. Evidence counts only when docviz's own
// registered harness ran in this process at the exact repository, base, head, definition and harness.
//
// ContractCoverage and its statuses are documented in SPEC.md (PR mode) and consumed as is by
// tools/review-studio/coverage.mjs.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const STATUSES = ['violated', 'unverified', 'stale', 'supported-in-scope', 'not-applicable'];

// Registered harnesses: a profile names one by id; a path or argv from any input is never run.
export const HARNESSES = {
  'card-spend': { file: join(HERE, 'contracts', 'card-spend.mjs'), copies: ['extension/', 'package.json'] },
};

export const digest = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const harnessDigest = (id) => digest(readFileSync(HARNESSES[id].file));

// Only records the runner made in this process are executed evidence; a parsed record is reported.
const EXECUTED = new WeakSet();
export const isExecuted = (record) => typeof record === 'object' && record !== null && EXECUTED.has(record);

const FORBIDDEN = ['authority', 'confirmed', 'confirmedBy', 'status', 'evidence', 'result', 'outcome'];
const ID = /^[a-z0-9][a-z0-9._-]{0,80}$/;

/** The profile's text → its contracts; throws "contract profile: …" on anything it can't trust. */
export function parseProfile(text) {
  const fail = (m) => { throw new Error(`contract profile: ${m}`); };
  let doc;
  try { doc = JSON.parse(text); } catch (e) { fail(`not JSON (${e.message})`); }
  if (doc?.schema !== 1 || !Array.isArray(doc.contracts) || !doc.contracts.length) fail('needs schema 1 and a non-empty contracts list');
  const str = (v, what) => (typeof v === 'string' && v.trim() ? v : fail(`${what} must be text`));
  const marker = (m, what) => ({ path: str(m?.path, `${what}.path`), from: typeof m.from === 'string' ? m.from : '', to: typeof m.to === 'string' ? m.to : '' });
  const contracts = doc.contracts.map((c, i) => {
    const where = `contracts[${i}]`;
    for (const k of FORBIDDEN) if (Object.hasOwn(c, k)) fail(`${where} sets \`${k}\`; authority and results never come from a profile`);
    if (!ID.test(c.id || '')) fail(`${where}.id must be a short lowercase id`);
    if (c.check !== undefined) {
      const keys = Object.keys(c.check || {});
      if (keys.some((k) => k !== 'harness')) fail(`${c.id}.check may only name a registered harness, not ${keys.filter((k) => k !== 'harness').join(', ')}`);
      if (!Object.hasOwn(HARNESSES, c.check.harness)) fail(`${c.id}.check.harness “${c.check.harness}” is not registered (${Object.keys(HARNESSES).join(', ')})`);
    }
    if (!Array.isArray(c.code) || !c.code.length) fail(`${c.id}.code must list the code anchors the contract governs`);
    const code = c.code.map((a, j) => ({ id: /^[A-Za-z][\w.-]{0,80}$/.test(a?.id || '') ? a.id : fail(`${c.id}.code[${j}].id must be a short identifier`), ...marker(a, `${c.id}.code[${j}]`) }));
    if (new Set(code.map((a) => a.id)).size !== code.length) fail(`${c.id}.code repeats an id`);
    return {
      id: c.id, title: str(c.title, `${c.id}.title`), condition: str(c.condition, `${c.id}.condition`),
      expectation: str(c.expectation, `${c.id}.expectation`), violation: str(c.violation, `${c.id}.violation`),
      consequential: c.consequential !== false,
      governing: (Array.isArray(c.governing) ? c.governing : []).map((g, j) => marker(g, `${c.id}.governing[${j}]`)),
      code, dependsOn: (c.dependsOn || []).map((p) => str(p, `${c.id}.dependsOn`)),
      ...(c.check && { check: { harness: c.check.harness } }),
    };
  });
  if (new Set(contracts.map((c) => c.id)).size !== contracts.length) fail('repeats a contract id');
  return contracts;
}

export const definitionDigest = (contract) => digest(contract);

/** Reads the profile the operator named; one inside the reviewed checkout is the author's text, so it's refused. */
export function loadProfile(file, root) {
  const real = realpathSync(file);
  const rel = relative(realpathSync(root), real);
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error(`contract profile: ${file} is inside the reviewed checkout, where the author can edit it; keep it outside`);
  const text = readFileSync(real, 'utf8');
  return { contracts: parseProfile(text), digest: digest(text), label: basename(real) };
}

const touches = (paths, p) => paths.some((x) => (x.endsWith('/') ? p.startsWith(x) : p === x));

/**
 * One contract and the facts gathered about it → its Obligation. Pure.
 * facts: { binding: { repositoryRoot, base, head }, changedPaths, anchors: [{ id, path, start, end } | { id, path, missing }],
 *   governing: [{ path, side, commit, blob, start, end, resolved }], cuts: [{ path, start, end }],
 *   evidence: record|null, noRun: reason code when nothing ran, currentHarness: digest|null }
 */
export function judge(contract, facts) {
  const definition = definitionDigest(contract);
  const watched = [...new Set([...contract.code.map((a) => a.path), ...contract.dependsOn])];
  const touched = facts.binding.base ? facts.changedPaths.filter((p) => touches(watched, p)) : [];
  const applies = facts.binding.base ? touched.length > 0 : null;
  const applicability = {
    applies, touched,
    reason: applies === null ? 'No base commit, so docviz can’t tell what changed' : applies ? `Changed: ${touched.join(', ')}` : `No changed path touches ${watched.join(', ')}`,
  };
  const resolved = facts.anchors.filter((a) => !a.missing);
  const covered = (a) => facts.cuts.some((c) => c.path === a.path && c.start <= a.end && a.start <= c.end);
  const cited = resolved.filter(covered).map((a) => a.id);
  const omitted = resolved.filter((a) => !covered(a)).map((a) => a.id);
  const summary = { cited, omitted, unresolved: facts.anchors.filter((a) => a.missing).map((a) => a.id), omittedBySummary: omitted.length > 0 };

  const r = facts.evidence?.contractId === contract.id ? facts.evidence : null;
  const evidence = r && {
    kind: 'contract-execution', provenance: isExecuted(r) ? 'executed-by-docviz' : 'reported',
    contractId: r.contractId, definitionDigest: r.definitionDigest, harness: r.harness, repositoryRoot: r.repositoryRoot,
    base: r.base, head: r.head, outcome: r.outcome, observed: r.observed, path: r.path, scope: r.scope, detail: r.detail, startedAt: r.startedAt, id: r.id,
  };
  const status = (s, reason, detail) => ({ status: s, reason, detail });
  const verdict = (() => {
    if (applies === false) return status('not-applicable', 'untouched', applicability.reason);
    if (!r) {
      if (facts.evidence) return status('unverified', 'unrelated-evidence', `The only evidence checks \`${facts.evidence.contractId}\`, not this contract`);
      if (!contract.check) return status('unverified', 'no-harness', 'No registered harness checks this contract');
      return status('unverified', facts.noRun || 'not-trusted', {
        'not-trusted': 'Not run: pass --trust-head with this head to let docviz run its harness',
        'trust-other-head': '--trust-head names another commit, so nothing ran on this head',
      }[facts.noRun || 'not-trusted'] || 'Not run');
    }
    if (!isExecuted(r)) return status('unverified', 'reported-only', 'Evidence was supplied, not run by docviz here, so it proves nothing either way');
    const b = facts.binding;
    if (r.repositoryRoot !== b.repositoryRoot) return status('stale', 'other-repository', 'Evidence is from another repository');
    if (r.head !== b.head) return status('stale', 'other-head', `Evidence is from ${String(r.head).slice(0, 7)}, not this head`);
    if (r.base !== b.base) return status('stale', 'other-base', 'Evidence was compared with another base');
    if (r.definitionDigest !== definition) return status('stale', 'definition-changed', 'The contract’s definition changed since this evidence ran');
    if (r.harness?.digest !== facts.currentHarness) return status('stale', 'harness-changed', 'The harness changed since this evidence ran');
    if (r.outcome === 'fails') return status('violated', 'executed-fails', r.detail);
    if (r.outcome === 'inapplicable') return status('unverified', 'surface-missing', `The harness can’t drive this code: ${r.detail}`);
    if (r.outcome !== 'holds') return status('unverified', 'harness-error', `The harness didn’t finish: ${r.detail}`);
    if (facts.governing.some((x) => !x.resolved)) return status('unverified', 'governing-source-missing', 'Held on the scenario, but a governing source anchor is missing');
    return status('supported-in-scope', 'executed-holds', `Held on the replayed scenario only: ${r.detail}`);
  })();
  return {
    contractId: contract.id, title: contract.title, condition: contract.condition, expectation: contract.expectation, violation: contract.violation,
    consequential: contract.consequential, definitionDigest: definition,
    authority: { kind: 'operator-selected', note: 'Chosen by the operator on the command line; not an authenticated human signature.', governing: facts.governing },
    applicability, summary, ...verdict, evidence: evidence || null,
  };
}

/** Copies the target's committed files for a harness into a fresh folder and runs it in a child process. */
export function runHarness(contract, { gitRaw, gitBuffer, binding }) {
  const h = HARNESSES[contract.check.harness];
  const dir = mkdtempSync(join(tmpdir(), 'docviz-contract-'));
  const startedAt = new Date().toISOString();
  let out;
  try {
    const listed = gitRaw('ls-tree', '-r', '-z', '--name-only', binding.head, '--', ...h.copies).split('\0').filter(Boolean);
    for (const path of listed) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), gitBuffer('show', `${binding.head}:${path}`));
    }
    const res = execFileSync(process.execPath, [h.file, dir], {
      cwd: dir, encoding: 'utf8', timeout: 30_000, maxBuffer: 1 << 20, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH || '', NODE_OPTIONS: '', TZ: process.env.TZ || 'UTC' },
    });
    out = JSON.parse(res);
  } catch (e) {
    out = { outcome: 'error', observed: {}, path: [], scope: '', detail: String(e.message).split('\n')[0].slice(0, 300) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const payload = {
    kind: 'contract-execution', contractId: contract.id, definitionDigest: definitionDigest(contract),
    harness: { id: contract.check.harness, digest: harnessDigest(contract.check.harness) },
    repositoryRoot: binding.repositoryRoot, base: binding.base, head: binding.head,
    outcome: ['holds', 'fails', 'inapplicable'].includes(out.outcome) ? out.outcome : 'error',
    observed: out.observed || {}, path: out.path || [], scope: out.scope || '', detail: out.detail || '', startedAt,
  };
  const record = { ...payload, id: digest(payload) };
  EXECUTED.add(record);
  return record;
}

/**
 * Gathers facts from the reviewed checkout (git objects only) and judges every contract.
 * `trustHead` is the commit the operator allowed docviz's harnesses to run against.
 */
export function assessContracts({ profile, gitRaw, gitBuffer, binding, origin, steps, trustHead, log = () => {} }) {
  const show = (commit, path) => { try { return commit && gitRaw('show', `${commit}:${path}`); } catch { return null; } };
  const blob = (commit, path) => { try { return gitRaw('rev-parse', `${commit}:${path}`).trim(); } catch { return null; } };
  const lines = (text, from, to) => {
    const a = from ? text.indexOf(from) : 0;
    if (a < 0) return null;
    const b = to ? text.indexOf(to, a + 1) : text.length;
    if (b < 0) return null;
    const lineOf = (i) => text.slice(0, i).split('\n').length;
    return { start: lineOf(a), end: lineOf(Math.max(a, b - 1)) };
  };
  const changedPaths = binding.base ? gitRaw('diff', '--name-only', '-z', binding.base, binding.head).split('\0').filter(Boolean) : [];
  const cuts = steps.flatMap((s) => s.cuts.map((c) => ({ path: c.path, start: c.start, end: c.end })));
  const trusted = trustHead && (() => { try { return gitRaw('rev-parse', '--verify', `${trustHead}^{commit}`).trim(); } catch { return null; } })();
  const obligations = profile.contracts.map((contract) => {
    const anchors = contract.code.map((a) => {
      const text = show(binding.head, a.path);
      const at = text != null && lines(text, a.from, a.to);
      return at ? { id: a.id, path: a.path, ...at } : { id: a.id, path: a.path, missing: true };
    });
    const governing = contract.governing.map((g) => {
      for (const [side, commit] of [['head', binding.head], ['base', binding.base]]) {
        const text = show(commit, g.path);
        const at = text != null && lines(text, g.from, g.to);
        if (at) return { path: g.path, side, commit, blob: blob(commit, g.path), ...at, resolved: true };
      }
      return { path: g.path, side: null, commit: null, blob: null, start: null, end: null, resolved: false };
    });
    const facts = { binding, changedPaths, anchors, governing, cuts, evidence: null, currentHarness: contract.check ? harnessDigest(contract.check.harness) : null };
    const applicable = judge(contract, facts).status !== 'not-applicable';
    if (applicable && contract.check) {
      if (!trustHead) facts.noRun = 'not-trusted';
      else if (trusted !== binding.head) facts.noRun = 'trust-other-head';
      else {
        log(`contract ${contract.id}: running harness ${contract.check.harness} at ${binding.head.slice(0, 7)}`);
        facts.evidence = runHarness(contract, { gitRaw, gitBuffer, binding });
      }
    }
    return judge(contract, facts);
  });
  const payload = {
    schema: 1, kind: 'contract-coverage', repository: { origin, root: binding.repositoryRoot }, base: binding.base, head: binding.head,
    profile: { digest: profile.digest, label: profile.label }, changedPaths, summary: { kind: 'author-summary', stepIds: steps.map((s) => s.id) }, obligations,
  };
  return { ...payload, id: digest(payload) };
}

/** Verdict findings (helper/verdict.js): one per obligation. */
export const contractFindings = (coverage) => coverage.obligations.map((o) => ({
  kind: 'contract', id: o.contractId, title: o.title, status: o.status, reason: o.reason, detail: o.detail,
  omittedBySummary: o.summary.omittedBySummary, consequential: o.consequential,
}));

const MARK = { violated: '✗ violated', unverified: '⚠ not checked', stale: '⚠ stale evidence', 'supported-in-scope': '✓ held in scope', 'not-applicable': 'not applicable' };

/** The comment's Contracts section. `link` is pr.js codeLink for this head. */
export function contractsSection(coverage, link) {
  const rows = coverage.obligations.map((o) => {
    const applies = o.applicability.applies === null ? 'unknown' : o.applicability.applies ? `yes: ${o.applicability.touched.map((p) => `\`${p}\``).join(', ')}` : 'no';
    const summary = o.applicability.applies === false ? '' : o.summary.omitted.length ? `omits ${o.summary.omitted.join(', ')}` : 'covers its anchors';
    const ev = o.evidence ? `${o.evidence.provenance === 'executed-by-docviz' ? 'docviz ran' : 'reported'} \`${o.evidence.harness?.id}\` at \`${String(o.evidence.head).slice(0, 7)}\`: ${o.evidence.detail}` : '—';
    return `| ${o.title} (\`${o.contractId}\`) | ${applies} | ${summary} | ${MARK[o.status]}${o.evidence?.detail === o.detail ? '' : `: ${o.detail}`} | ${ev} |`;
  });
  const sources = coverage.obligations.flatMap((o) => o.authority.governing.map((g) => `\`${o.contractId}\` ← ${
    !g.resolved ? `\`${g.path}\` (anchor not found)` : g.side === 'head' ? link({ path: g.path, start: g.start, end: g.end }) : `\`${g.path}:${g.start}-${g.end}\` at base \`${g.commit.slice(0, 7)}\``}`));
  return [
    '### Contracts', '',
    `From the operator’s profile \`${coverage.profile.label}\` (\`${coverage.profile.digest.slice(0, 12)}\`), not from the summary above; operator-selected, not an authenticated signature.`, '',
    '| Contract | Applies | Summary | Status | Evidence |', '|---|---|---|---|---|', ...rows,
    ...(sources.length ? ['', `Governing text: ${sources.join('; ')}`] : []),
  ].join('\n');
}
