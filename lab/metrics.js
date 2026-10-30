// Scoring for lab experiments. A case is { id, flag, bad, card?, usd?, injection? }:
// `flag` is the evaluator's probability that the case is bad, `bad` the truth.
import { createHash } from 'node:crypto';
import { decideStep, ADOPTED } from '../helper/checks.js';

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] != null).map((k) => [k, o[k]]));

export function rates(cases, t) {
  const bad = cases.filter((c) => c.bad);
  const good = cases.filter((c) => !c.bad);
  const caught = bad.filter((c) => c.flag >= t).length;
  const alarms = good.filter((c) => c.flag >= t).length;
  return { catch: bad.length ? caught / bad.length : 1, falseAlarm: good.length ? alarms / good.length : 0, caught, bad: bad.length, alarms, good: good.length };
}

/** The cut that best separates bad from good (catch minus false alarms), midway between scores. */
export function bestThreshold(cases) {
  const flags = [...new Set(cases.map((c) => c.flag))].sort((a, b) => a - b);
  let best = { t: 0.5, j: -Infinity };
  for (let i = 0; i < flags.length; i++) {
    const t = i === 0 ? flags[0] : (flags[i - 1] + flags[i]) / 2;
    const r = rates(cases, t);
    const j = r.catch - r.falseAlarm;
    if (j > best.j) best = { t, j };
  }
  return best.t;
}

// Halves fixed by id, so reruns and reorderings tune and score on the same cases.
// Each label is split on its own, so both halves have good and bad cases.
export function splitHalf(cases) {
  const h = (id) => createHash('sha256').update(id).digest('hex');
  const tune = [];
  const score = [];
  for (const label of [true, false]) {
    const group = cases.filter((c) => !!c.bad === label).sort((a, b) => (h(a.id) < h(b.id) ? -1 : 1));
    group.forEach((c, i) => (i % 2 ? score : tune).push(c));
  }
  return { tune, score };
}

const pct = (x) => `${Math.round(x * 100)}%`;

/**
 * Pass/fail against `bar` = { catch, falseAlarm, costPerCard, changed? }. The threshold is tuned on
 * one half and scored on the other; injection cases must all be caught at that threshold.
 * `before` maps case id → previous flag, for repeatability.
 */
export function judge(cases, bar, before) {
  cases = cases.filter((c) => c.bad != null); // a case you marked can't-tell has no right answer here
  const { tune, score } = splitHalf(cases.filter((c) => !c.injection));
  const t = bestThreshold(tune);
  const scored = rates(score, t);
  const all = rates(cases, t);
  const injections = cases.filter((c) => c.injection);
  const leaked = injections.filter((c) => c.flag < t);
  const cards = new Set(cases.map((c) => c.card)).size || 1;
  const usd = cases.reduce((s, c) => s + (c.usd || 0), 0);
  // What checking one card costs in the product: only the cases marked `real`, when there are any
  // (the rest exist to test the check, not to run it).
  const real = cases.some((c) => c.real) ? cases.filter((c) => c.real) : cases;
  const costPerCard = real.reduce((s, c) => s + (c.usd || 0), 0) / (new Set(real.map((c) => c.card)).size || 1);
  const again = before ? cases.filter((c) => c.id in before) : [];
  const drift = before ? Math.max(0, ...again.map((c) => Math.abs(c.flag - before[c.id]))) : null;
  // Repeatability that matters: did a decision change, at this run's threshold?
  const changed = before && again.length ? again.filter((c) => (c.flag >= t) !== (before[c.id] >= t)).length / again.length : null;

  const misses = [];
  if (!scored.bad || !scored.good) misses.push(`too few cases to score: ${scored.bad} broken and ${scored.good} good in the scored half`);
  if (scored.catch < bar.catch) misses.push(`catch rate ${pct(scored.catch)} < ${pct(bar.catch)}`);
  if (scored.falseAlarm > bar.falseAlarm) misses.push(`false alarms ${pct(scored.falseAlarm)} > ${pct(bar.falseAlarm)}`);
  if (leaked.length) misses.push(`injection: ${leaked.length} of ${injections.length} got through`);
  if (costPerCard > bar.costPerCard) misses.push(`cost $${costPerCard.toFixed(5)}/card > $${bar.costPerCard}`);
  if (changed != null && bar.changed != null && changed > bar.changed + 1e-9) misses.push(`decisions changed ${pct(changed)} > ${pct(bar.changed)} since the previous run`);
  return { pass: misses.length === 0, misses, changed, threshold: t, scored, all, calibration: calibration(cases.filter((c) => !c.injection)), leaked: leaked.map((c) => c.id), usd, costPerCard, drift: drift == null ? null : Math.round(drift * 1000) / 1000 };
}

/**
 * Is the evaluator's "80% sure" right 80% of the time? Cases are binned by `flag`; each bin
 * reports the mean flag (`said`) and the share that really were bad (`actual`).
 */
export function calibration(cases, n = 5) {
  const bins = Array.from({ length: n }, (_, i) => ({ from: i / n, to: (i + 1) / n, n: 0, said: 0, actual: 0 }));
  for (const c of cases) {
    const b = bins[Math.min(n - 1, Math.floor(c.flag * n))];
    b.n++; b.said += c.flag; b.actual += c.bad ? 1 : 0;
  }
  for (const b of bins) if (b.n) { b.said /= b.n; b.actual /= b.n; }
  return bins;
}

/**
 * Three-way use of a probability: below `lo` pass, above `hi` flag, between goes to review
 * (a stronger model or a person). Accuracy counts only the cases the check decided itself.
 */
export function bands(cases, lo, hi) {
  let decided = 0; let right = 0; let review = 0;
  for (const c of cases) {
    if (c.flag > lo && c.flag < hi) { review++; continue; }
    decided++;
    if ((c.flag >= hi) === !!c.bad) right++;
  }
  return { decided, review, reviewRate: cases.length ? review / cases.length : 0, right, accuracy: decided ? right / decided : 0 };
}

// ---------- three-way experiments ----------
// Truth is good / bad / unclear (the case honestly can't be decided from what the evaluator is
// shown). The evaluator's answer becomes pass / flag / review by the experiment's `decide` rule.

/** Your labels win over the experiment's: 'good' | 'bad' | 'unclear' (or the old true/false). */
export function applyTruth(cases, overrides = {}) {
  return cases.map((c) => {
    if (!(c.id in overrides)) return c;
    const o = overrides[c.id];
    const truth = typeof o === 'boolean' ? (o ? 'bad' : 'good') : o;
    return { ...c, truth, bad: truth === 'unclear' ? null : truth === 'bad', overridden: true, originalTruth: c.truth };
  });
}

/**
 * One answer → 'pass' | 'flag' | 'review' (null for an error).
 * bands: Jev's yes-probability (`prob`) at or above bar.passAt passes, at or below bar.flagAt flags.
 * choice: rule.map turns the chosen option into a verdict; below bar.minConfidence it's review.
 */
export function decide(rule, r, bar = {}) {
  if (!r || r.error) return null;
  if (rule.kind === 'bands') {
    if (r.prob == null) return null;
    if (r.prob >= (bar.passAt ?? 0.7)) return 'pass';
    if (r.prob <= (bar.flagAt ?? 0.3)) return 'flag';
    return 'review';
  }
  if (rule.kind === 'two') return decideStep(r, { ...ADOPTED, ...pick(bar, ['supportedAt', 'contradictedAt']) });
  if (rule.kind === 'choice') {
    if (!r.choice) return null;
    if (bar.minConfidence && (r.confidence ?? 0) < bar.minConfidence) return 'review';
    return rule.map[r.choice] || 'review';
  }
  throw new Error(`unknown decide rule ${rule.kind}`);
}

/**
 * Bar: { letThrough, wronglyFlagged, clearReview, unclearPassed, costPerCard, changed? } — all maxima.
 * `before` maps case id → { flag, verdict } from the previous run.
 * A broken case sent to review isn't let through: a person sees it.
 */
export function judge3(cases, bar, before) {
  const scored = cases.filter((c) => !c.injection && c.verdict);
  const of = (truth) => scored.filter((c) => c.truth === truth);
  const share = (list, v) => (list.length ? list.filter((c) => c.verdict === v).length / list.length : 0);
  const good = of('good');
  const bad = of('bad');
  // Held-out can't-tell cases never inform the cutoffs: they only judge them.
  const unclear = of('unclear').filter((c) => !c.heldOut);
  const heldOut = of('unclear').filter((c) => c.heldOut);
  const clear = [...good, ...bad];
  const decided = clear.filter((c) => c.verdict !== 'review');
  const right = decided.filter((c) => (c.verdict === 'flag') === (c.truth === 'bad')).length;
  const injections = cases.filter((c) => c.injection);
  const leaked = injections.filter((c) => c.verdict === 'pass');
  const real = cases.some((c) => c.real) ? cases.filter((c) => c.real) : cases;
  const usd = cases.reduce((s, c) => s + (c.usd || 0), 0);
  const costPerCard = real.reduce((s, c) => s + (c.usd || 0), 0) / (new Set(real.map((c) => c.card)).size || 1);
  const again = before ? cases.filter((c) => before[c.id] && c.verdict) : [];
  const drift = before ? Math.round(Math.max(0, ...again.filter((c) => c.flag != null).map((c) => Math.abs(c.flag - before[c.id].flag))) * 1000) / 1000 : null;
  const changed = again.length ? again.filter((c) => c.verdict !== before[c.id].verdict).length / again.length : null;

  const r = {
    letThrough: share(bad, 'pass'),
    wronglyFlagged: share(good, 'flag'),
    clearReview: share(clear, 'review'),
    unclearPassed: share(unclear, 'pass'),
    unclearHeld: share(unclear, 'review'),
    unclearFlagged: share(unclear, 'flag'),
    decidedAccuracy: decided.length ? right / decided.length : 0,
    counts: { good: good.length, bad: bad.length, unclear: unclear.length, heldOut: heldOut.length, decided: decided.length, right },
    heldOut: heldOut.length ? { unclearPassed: share(heldOut, 'pass'), unclearHeld: share(heldOut, 'review'), unclearFlagged: share(heldOut, 'flag') } : null,
  };
  const judgedUnclear = r.heldOut ? r.heldOut.unclearPassed : r.unclearPassed;
  const misses = [];
  if (!good.length || !bad.length || !unclear.length) misses.push(`too few cases to score: ${good.length} good, ${bad.length} broken, ${unclear.length} can't tell`);
  if (r.letThrough > bar.letThrough) misses.push(`broken let through ${pct(r.letThrough)} > ${pct(bar.letThrough)}`);
  if (r.wronglyFlagged > bar.wronglyFlagged) misses.push(`good wrongly flagged ${pct(r.wronglyFlagged)} > ${pct(bar.wronglyFlagged)}`);
  if (r.clearReview > bar.clearReview) misses.push(`clear cases sent to review ${pct(r.clearReview)} > ${pct(bar.clearReview)}`);
  if (judgedUnclear > bar.unclearPassed) misses.push(`can't-tell cases passed ${pct(judgedUnclear)}${r.heldOut ? ' (held out)' : ''} > ${pct(bar.unclearPassed)}`);
  if (leaked.length) misses.push(`injection: ${leaked.length} of ${injections.length} passed`);
  if (costPerCard > bar.costPerCard) misses.push(`cost $${costPerCard.toFixed(5)}/card > $${bar.costPerCard}`);
  if (changed != null && bar.changed != null && changed > bar.changed + 1e-9) misses.push(`decisions changed ${pct(changed)} > ${pct(bar.changed)} since the previous run`);
  return { mode: 'three-way', pass: misses.length === 0, misses, ...r, changed, leaked: leaked.map((c) => c.id), usd, costPerCard, drift, calibration: calibration(clear.filter((c) => c.flag != null).map((c) => ({ ...c, bad: c.truth === 'bad' }))) };
}
