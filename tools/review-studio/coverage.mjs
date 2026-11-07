// The studio's read of a `docviz pr --coverage-out` result (helper/contracts.js ContractCoverage).
// Pure: validate the stored shape and turn it into rows the UI renders. Obligations, authority and
// execution stay separate fields; the author's summary only appears as an omission note.
//
// A stored file's fingerprints show it is self-consistent, not who wrote it: anyone who can write the
// data root can write a consistent file. So this checks integrity and binding only. A violated or
// supported row must carry an executed record that is bound, field by field, to this report's
// repository and comparison, the obligation's contract and definition, and the harness it selected.
import { digest } from './git.mjs';

export const STATUSES = ['violated', 'unverified', 'stale', 'supported-in-scope', 'not-applicable'];
const REASONS = {
  violated: ['executed-fails'], 'supported-in-scope': ['executed-holds'], 'not-applicable': ['untouched'],
  unverified: ['not-trusted', 'trust-other-head', 'no-harness', 'unrelated-evidence', 'reported-only', 'surface-missing', 'harness-error', 'governing-source-missing'],
  stale: ['other-repository', 'other-head', 'other-base', 'definition-changed', 'harness-changed'],
};
const TONE = { violated: 'bad', unverified: 'pending', stale: 'pending', 'supported-in-scope': 'neutral', 'not-applicable': 'muted' };
const LABEL = { violated: 'Violated at this head', unverified: 'Not checked', stale: 'Evidence is stale', 'supported-in-scope': 'Held in the replayed scenario', 'not-applicable': 'Not touched by this change' };
const SHA = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
// helper/contracts.js runHarness: the execution record's payload, in the order its id was computed.
const RECORD = ['kind', 'contractId', 'definitionDigest', 'harness', 'repositoryRoot', 'base', 'head', 'outcome', 'observed', 'path', 'scope', 'detail', 'startedAt'];
const recordId = (e) => digest(Object.fromEntries(RECORD.map((k) => [k, e[k]])));

export const INTEGRITY = 'Fingerprints show the stored result is self-consistent, not who wrote it; `docviz pr` is the canonical producer.';

/** Throws unless `result` is a well-formed, self-consistent ContractCoverage whose id matches its payload. */
export function validateCoverage(result) {
  const fail = (m) => { throw new Error(`Invalid contract coverage: ${m}.`); };
  if (!result || result.schema !== 1 || result.kind !== 'contract-coverage') fail('expected schema 1 contract-coverage');
  if (!SHA.test(result.head) || (result.base !== null && !SHA.test(result.base))) fail('head and base must be commits');
  const root = result.repository?.root;
  if (root !== null && !SHA.test(root)) fail('repository root must be a commit or null');
  if (!Array.isArray(result.obligations)) fail('obligations must be a list');
  const { id, ...payload } = result;
  if (id !== digest(payload)) fail('its fingerprint does not match its content');
  for (const o of result.obligations) {
    if (typeof o?.contractId !== 'string' || !STATUSES.includes(o.status) || !REASONS[o.status].includes(o.reason)) fail('an obligation needs an id, a known status and one of that status’s reasons');
    if (o.authority?.kind !== 'operator-selected') fail(`${o.contractId} has authority other than operator-selected`);
    if (o.check != null && (typeof o.check.harness !== 'string' || !HEX64.test(o.check.digest))) fail(`${o.contractId} names a harness without its digest`);
    const e = o.evidence;
    if (e !== null) {
      if (typeof e !== 'object' || !['executed-by-docviz', 'reported'].includes(e.provenance)) fail(`${o.contractId} evidence has unknown provenance`);
      if (e.contractId !== o.contractId) fail(`${o.contractId} carries evidence for another contract`);
      if (e.provenance === 'executed-by-docviz' && (e.kind !== 'contract-execution' || e.id !== recordId(e))) fail(`${o.contractId} execution record fingerprint does not match its content`);
    }
    const frames = e?.observed?.frames;
    if (frames !== undefined && (!Array.isArray(frames) || frames.some((f) => !f || typeof f.id !== 'string' || !f.id || typeof f.action !== 'string') || new Set(frames.map((f) => f.id)).size !== frames.length)) fail(`${o.contractId} has malformed recorded frames`);
    if (o.status === 'violated' || o.status === 'supported-in-scope') {
      const outcome = o.status === 'violated' ? 'fails' : 'holds';
      const bound = e?.provenance === 'executed-by-docviz' && e.outcome === outcome
        && e.repositoryRoot === root && e.head === result.head && e.base === result.base
        && e.definitionDigest === o.definitionDigest
        && o.check != null && e.harness?.id === o.check.harness && e.harness?.digest === o.check.digest;
      if (!bound) fail(`${o.contractId} is ${o.status} without a matching docviz execution at this repository, comparison, definition and selected harness`);
      if (o.status === 'supported-in-scope' && (o.authority.governing || []).some((g) => !g.resolved)) fail(`${o.contractId} is supported though a governing source is missing`);
    }
  }
  return result;
}

const span = (g) => (g.resolved ? `${g.path}:${g.start}-${g.end}@${String(g.commit).slice(0, 7)}` : `${g.path} (unresolved)`);
const short = (sha) => String(sha).slice(0, 7);

/**
 * Where the report sits against what it is attached to. `expected` is { repositoryRoot, scope: 'stack'|'layer',
 * layerId, base, head }; without it the report is read on its own comparison.
 */
function bindingOf(result, expected) {
  if (!expected) return { current: true, scope: 'report', layerId: null, reason: null, detail: null };
  const { scope, layerId = null } = expected, where = scope === 'layer' ? `layer ${layerId}` : 'this stack';
  const mismatch = result.repository?.root !== expected.repositoryRoot ? ['other-repository', `Recorded for another repository, not ${where}`]
    : result.head !== expected.head ? ['other-head', `Recorded at ${short(result.head)}, not the head of ${where} (${short(expected.head)})`]
      : result.base !== expected.base ? ['other-base', `Recorded against base ${short(result.base)}, not the base of ${where} (${short(expected.base)})`]
        : null;
  return { current: !mismatch, scope, layerId, reason: mismatch?.[0] ?? null, detail: mismatch?.[1] ?? null };
}

/** ContractCoverage (+ the comparison it is attached to) → { id, head, base, binding, integrity, counts, needsReview, rows }. */
export function coverageView(result, expected) {
  validateCoverage(result);
  const binding = bindingOf(result, expected);
  const rows = result.obligations.map((o) => {
    const row = {
      contractId: o.contractId, title: o.title, condition: o.condition, expectation: o.expectation, violation: o.violation,
      status: o.status, reason: o.reason, tone: TONE[o.status], label: LABEL[o.status], detail: o.detail, recorded: null,
      applies: o.applicability?.applies ?? null, touched: o.applicability?.touched || [],
      omittedBySummary: !!o.summary?.omittedBySummary, omitted: o.summary?.omitted || [], anchors: o.summary ?? null,
      authority: 'Operator-selected (not a signature)', governing: (o.authority.governing || []).map(span), sources: o.authority.governing || [],
      check: o.check ?? null,
      // frames: the states the harness captured after each action, as recorded; null means none were recorded.
      evidence: o.evidence && { provenance: o.evidence.provenance, outcome: o.evidence.outcome, scope: o.evidence.scope, observed: o.evidence.observed, frames: o.evidence.observed?.frames ?? null, path: o.evidence.path, head: o.evidence.head, harness: o.evidence.harness?.id, record: o.evidence },
    };
    // A report for another repository or comparison says nothing current here: its rows read stale, the recorded result kept.
    if (binding.current) return row;
    return { ...row, status: 'stale', reason: binding.reason, tone: TONE.stale, label: LABEL.stale, detail: binding.detail, recorded: { status: o.status, reason: o.reason, detail: o.detail } };
  }).sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
  return { id: result.id, head: result.head, base: result.base, binding, integrity: INTEGRITY, counts, needsReview: counts.violated + counts.unverified + counts.stale > 0, rows };
}
