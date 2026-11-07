// One verdict for a PR, from the findings of `docviz pr` (helper/behavior.js's Finding shapes,
// plus the PR's own step checks): needs you / look when you can / nothing for you. Pure: the same
// findings give the same verdict (the rerun rule), and anything unknown is "look" or worse (rule 1).

// Verdict = { level: 'needs'|'look'|'nothing', reasons: Reason[] }
// Reason  = { level, kind, text, ref? }                      kind is the table row that matched

export const LEVELS = ['needs', 'look', 'nothing'];

const last = (path) => (path?.length ? `, ending “${path.at(-1)}”` : '');
const stepName = (f) => `${f.source === 'model' ? `${f.model} step` : 'PR step'} “${f.label}”`;
const counted = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
const changes = (f) => [
  f.added.states.length && `${counted(f.added.states.length, 'state')} added`,
  f.added.edges.length && `${counted(f.added.edges.length, 'step')} added`,
  f.removed.states.length && `${counted(f.removed.states.length, 'state')} removed`,
  f.removed.edges.length && `${counted(f.removed.edges.length, 'step')} removed`,
].filter(Boolean).join(', ');

/**
 * DESIGN.md's table, one row per line, in its order. Each finding takes the first row it matches;
 * the verdict is the worst level among them. `text(f)` is the reason in the reader's words.
 */
export const TABLE = [
  { kind: 'rule-breaks', level: 'needs', // a rule breaks at head; a model invariant not in rules.md (or with no rules.md) too
    when: (f) => (f.kind === 'rule' || f.kind === 'extra-rule') && f.status === 'breaks',
    text: (f) => `${f.name} breaks in ${f.model}${last(f.path)}${f.kind === 'extra-rule' ? ' (the model checks it; it isn’t in your rules.md)' : ''}`,
    ref: (f) => f.model },
  { kind: 'contract-violated', level: 'needs', // docviz's own harness, run at this head, observed the contract fail (helper/contracts.js)
    when: (f) => f.kind === 'contract' && f.status === 'violated',
    text: (f) => `${f.title} (\`${f.id}\`) fails at this head: ${f.detail}${f.omittedBySummary ? '; the summary leaves it out' : ''}`,
    ref: (f) => f.id },
  { kind: 'contradicted', level: 'needs', // a PR step or model step contradicted by its code (Jev ✗)
    when: (f) => f.kind === 'step' && f.verdict === 'flag',
    text: (f) => `${stepName(f)} is contradicted by its code`, ref: (f) => f.id },
  { kind: 'model-failed', level: 'needs', // a model fails to run at head, or TLC errors
    when: (f) => f.kind === 'run' && f.side === 'head',
    text: (f) => `${f.model} didn’t run at head: ${f.error}`, ref: (f) => f.model },
  { kind: 'rule-fixed', level: 'look', // a rule broke at base and holds at head: the PR changed it, so never "nothing"
    when: (f) => f.kind === 'rule' && f.status === 'holds' && f.atBase === 'breaks',
    text: (f) => `${f.name} now holds; it broke before`, ref: (f) => f.model },
  { kind: 'rules-changed', level: 'look', // rules.md changed: an agent never edits it (rule 2), and docviz can't know who did
    when: (f) => f.kind === 'rules-changed',
    text: (f) => {
      const parts = [['added', f.added], ['removed', f.removed], ['reworded', f.reworded]].filter(([, l]) => l.length).map(([k, l]) => `${k} ${l.join(', ')}`);
      return `Your rules changed: ${parts.join('; ') || '`.atlas/rules.md` was edited outside any rule'}`;
    } },
  { kind: 'rule-redefined', level: 'look', // a rule's TLA+ definition changed: the change is the reason, whatever it became
    when: (f) => f.kind === 'rule-redefined',
    text: (f) => `${f.name}’s definition in the model changed (${f.model})`, ref: (f) => f.model },
  { kind: 'model-edited', level: 'look', // the spec changed and neither the chart nor a rule's definition shows how
    when: (f) => f.kind === 'model-edited',
    text: (f) => `${f.model}’s model changed, though its chart and your rules’ definitions read the same`, ref: (f) => f.model },
  { kind: 'model-removed', level: 'look', // a model, or all of .atlas/, removed
    when: (f) => f.kind === 'model-removed' || (f.kind === 'atlas' && f.status === 'removed'),
    text: (f) => (f.kind === 'atlas' ? '`.atlas/` removed: no model checks this repo any more' : `Model ${f.model} removed`),
    ref: (f) => f.model },
  { kind: 'behavior-changed', level: 'look', // behavior changed (Delta.changed) with rules holding
    when: (f) => f.kind === 'delta' && f.changed === true,
    text: (f) => `${f.model} behaves differently: ${changes(f)}`, ref: (f) => f.model },
  { kind: 'contract-unverified', level: 'look', // a contract that applies with no current executed evidence: missing is never "nothing", never a violation
    when: (f) => f.kind === 'contract' && (f.status === 'unverified' || f.status === 'stale'),
    text: (f) => `\`${f.id}\`: ${f.detail}${f.omittedBySummary ? ' (the summary leaves it out)' : ''}`,
    ref: (f) => f.id, group: () => 'Contracts not checked at this head' },
  { kind: 'step-unconfirmed', level: 'look', // a step ⚠ review, or unchecked (no key, Jev error)
    when: (f) => f.kind === 'step' && f.verdict !== 'pass',
    text: (f) => (f.verdict === 'review' ? `${stepName(f)} claims more than its code shows (⚠ review)` : `${stepName(f)} not checked: ${f.error || 'no answer'}`),
    ref: (f) => f.id },
  { kind: 'uncovered', level: 'look', // a changed source file no model covers
    when: (f) => f.kind === 'uncovered',
    text: (f) => `\`${f.path}\``, ref: (f) => f.path, group: () => 'Changed code no model covers' },
  { kind: 'not-run', level: 'look', // `.atlas/` absent, or models not run
    when: (f) => (f.kind === 'atlas' && (f.status === 'absent' || f.status === 'no-base')) || f.kind === 'not-run'
      || (f.kind === 'run' && f.side === 'base') || (f.kind === 'delta' && f.changed === null) || (f.kind === 'rule' && f.status === 'unchecked' && f.model),
    text: (f) => ({
      atlas: () => (f.status === 'absent' ? 'No `.atlas/` here, so behavior isn’t checked' : 'No base commit, so behavior isn’t compared'),
      'not-run': () => `${f.models.join(', ')} not run: ${f.why}`,
      run: () => `${f.model} didn’t run at base (${f.error}), so its change isn’t known`,
      delta: () => `${f.model}: behavior not compared (no chart drawn)`,
      rule: () => f.name,
    })[f.kind](),
    ref: (f) => f.model || f.name, group: (f) => f.kind === 'rule' && `Rules not checked (${f.model} didn’t run)` },
  { kind: 'rules-gap', level: 'look', // rules.md missing or a model invariant not in it
    when: (f) => (f.kind === 'atlas' && f.status === 'no-rules') || f.kind === 'extra-rule' || f.kind === 'rules-problem' || (f.kind === 'rule' && f.status === 'unchecked' && !f.model),
    text: (f) => ({
      atlas: () => 'No `.atlas/rules.md`: the models check no rule of yours',
      'rules-problem': () => f.text,
      'extra-rule': () => `${f.name} (${f.model}) ${f.status === 'breaks' ? 'breaks' : 'is checked'}, and it isn’t one of your rules`,
      rule: () => `${f.name} is checked by no model`,
    })[f.kind](),
    ref: (f) => f.model || f.name },
  { kind: 'fine', level: 'nothing', // none of the above
    when: (f) => (f.kind === 'rule' && (f.status === 'holds' || f.status === 'untouched')) || (f.kind === 'step' && f.verdict === 'pass') || (f.kind === 'delta' && f.changed === false)
      || (f.kind === 'contract' && (f.status === 'supported-in-scope' || f.status === 'not-applicable')),
    text: () => '' },
];

// A finding no row knows is unknown, so it can't be "nothing" (rule 1).
const UNKNOWN = { kind: 'unknown', level: 'look', text: (f) => `docviz can’t judge a finding of kind “${f.kind}”` };

/** Findings → the verdict: the worst level, with one reason per finding that isn't "nothing", worst first. */
export function verdict(findings) {
  const matched = findings.map((f) => {
    const row = TABLE.find((r) => r.when(f)) || UNKNOWN;
    const group = row.group?.(f);
    return { level: row.level, kind: row.kind, text: row.text(f), ...(row.ref?.(f) && { ref: row.ref(f) }), ...(group && { group }), rank: LEVELS.indexOf(row.level) * 100 + TABLE.indexOf(row) };
  });
  const reasons = matched.filter((r) => r.level !== 'nothing').map((r, i) => ({ ...r, i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(({ rank, i, ...r }) => r);
  return { level: reasons[0]?.level || 'nothing', reasons };
}

const HEADLINE = { needs: '**Needs you**', look: '**Look when you can**', nothing: '**Nothing for you**' };
const MARK = { needs: '✗', look: '⚠' };
/** The comment's opening: the verdict line, then its reasons; reasons of one group (files no model covers, rules a model didn't check) share a line. */
export function verdictLines(v) {
  if (v.level === 'nothing') return `${HEADLINE.nothing}\n\nNo rule breaks, every step is confirmed, and no behavior changed.\n`;
  const lines = [];
  const seen = new Set();
  for (const r of v.reasons) {
    if (!r.group) lines.push(`- ${MARK[r.level]} ${r.text}`);
    else if (!seen.has(r.group)) {
      seen.add(r.group);
      lines.push(`- ${MARK[r.level]} ${r.group}: ${v.reasons.filter((x) => x.group === r.group).map((x) => x.text).join(', ')}`);
    }
  }
  return [HEADLINE[v.level], '', ...lines].join('\n') + '\n';
}
