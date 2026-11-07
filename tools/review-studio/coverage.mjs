// The studio's read of a `docviz pr --coverage-out` result (helper/contracts.js ContractCoverage).
// Pure: validate the stored shape and turn it into rows the UI renders. Obligations, authority and
// execution stay separate fields; the author's summary only appears as an omission note.
import { digest } from './git.mjs';

export const STATUSES = ['violated', 'unverified', 'stale', 'supported-in-scope', 'not-applicable'];
const TONE = { violated: 'bad', unverified: 'pending', stale: 'pending', 'supported-in-scope': 'neutral', 'not-applicable': 'muted' };
const LABEL = { violated: 'Violated at this head', unverified: 'Not checked', stale: 'Evidence is stale', 'supported-in-scope': 'Held in the replayed scenario', 'not-applicable': 'Not touched by this change' };
const SHA = /^[a-f0-9]{40}$/;

/** Throws unless `result` is a well-formed, self-consistent ContractCoverage whose id matches its payload. */
export function validateCoverage(result) {
  const fail = (m) => { throw new Error(`Invalid contract coverage: ${m}.`); };
  if (!result || result.schema !== 1 || result.kind !== 'contract-coverage') fail('expected schema 1 contract-coverage');
  if (!SHA.test(result.head) || (result.base !== null && !SHA.test(result.base))) fail('head and base must be commits');
  if (!Array.isArray(result.obligations)) fail('obligations must be a list');
  const { id, ...payload } = result;
  if (id !== digest(payload)) fail('its fingerprint does not match its content');
  for (const o of result.obligations) {
    if (typeof o?.contractId !== 'string' || !STATUSES.includes(o.status) || typeof o.reason !== 'string') fail('an obligation needs an id, a known status and a reason');
    if (o.authority?.kind !== 'operator-selected') fail(`${o.contractId} has authority other than operator-selected`);
    const e = o.evidence;
    if (e !== null && (typeof e !== 'object' || !['executed-by-docviz', 'reported'].includes(e.provenance))) fail(`${o.contractId} evidence has unknown provenance`);
    const frames = e?.observed?.frames;
    if (frames !== undefined && (!Array.isArray(frames) || frames.some((f) => !f || typeof f.id !== 'string' || !f.id || typeof f.action !== 'string') || new Set(frames.map((f) => f.id)).size !== frames.length)) fail(`${o.contractId} has malformed recorded frames`);
    if (o.status === 'violated' || o.status === 'supported-in-scope') {
      const outcome = o.status === 'violated' ? 'fails' : 'holds';
      if (e?.provenance !== 'executed-by-docviz' || e.outcome !== outcome || e.head !== result.head || e.base !== result.base) fail(`${o.contractId} is ${o.status} without a matching docviz execution at this head`);
    }
  }
  return result;
}

const span = (g) => (g.resolved ? `${g.path}:${g.start}-${g.end}@${String(g.commit).slice(0, 7)}` : `${g.path} (unresolved)`);

/** ContractCoverage → { id, head, base, counts, needsReview, rows }. */
export function coverageView(result) {
  validateCoverage(result);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, result.obligations.filter((o) => o.status === s).length]));
  const rows = result.obligations.map((o) => ({
    contractId: o.contractId, title: o.title, status: o.status, reason: o.reason, tone: TONE[o.status], label: LABEL[o.status], detail: o.detail,
    applies: o.applicability?.applies ?? null, touched: o.applicability?.touched || [],
    omittedBySummary: !!o.summary?.omittedBySummary, omitted: o.summary?.omitted || [],
    authority: 'Operator-selected (not a signature)', governing: (o.authority.governing || []).map(span),
    // frames: the states the harness captured after each action, as recorded; null means none were recorded.
    evidence: o.evidence && { provenance: o.evidence.provenance, outcome: o.evidence.outcome, scope: o.evidence.scope, observed: o.evidence.observed, frames: o.evidence.observed?.frames ?? null, path: o.evidence.path, head: o.evidence.head, harness: o.evidence.harness?.id },
  })).sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status));
  return { id: result.id, head: result.head, base: result.base, counts, needsReview: counts.violated + counts.unverified + counts.stale > 0, rows };
}
