// C3 on real PR steps: flow-level labels from five projects (JS, TS, TSX, Python), frozen by
// lab/snapshot-real.mjs. The function-level fixtures in steps.js passed; the first real
// `docviz pr` run sent 4 of 5 true steps to review, so the check is retested here.
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BAR } from './steps.js';
import { ADOPTED } from '../helper/checks.js';

const MUTATIONS = {
  original: { note: 'Real step, right code', how: 'the label written for the PR, with its function at HEAD', truth: 'good' },
  neighbor: { note: 'Real label, the next step’s code', how: 'the link points at another step of the same PR', truth: 'bad' },
  wrongAction: { note: 'Right code, label claims something else', how: 'a plausible label the code doesn’t do', truth: 'bad' },
  unclear: { note: 'Label needs code that isn’t shown', how: 'a claim about callers, screens or settings; about half held out to judge the cutoffs', truth: 'unclear' },
};
export const mutationNames = Object.fromEntries(Object.entries(MUTATIONS).map(([k, v]) => [k, v.note]));
export const mutationHow = Object.fromEntries(Object.entries(MUTATIONS).map(([k, v]) => [k, v.how]));

// The fixtures hold code from private repos, so they stay local (gitignored): without them this
// experiment has no cases. Rebuild with `node lab/snapshot-real.mjs`.
const FIXTURE = new URL('fixtures/real-steps.json', import.meta.url);
export const hasFixture = () => existsSync(FIXTURE);

export function cases() {
  if (!hasFixture()) return [];
  const steps = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  // Every other step in hash order is held out: a fixed half, whatever order the fixture is in.
  const hash = (s) => createHash('sha256').update(`${s.repo}:${s.id}`).digest('hex');
  const heldOut = new Set([...steps].sort((a, b) => (hash(a) < hash(b) ? -1 : 1)).filter((_, i) => i % 2).map((s) => `${s.repo}:${s.id}`));
  return steps.flatMap((s) => {
    const sameChange = steps.filter((x) => x.change === s.change);
    const next = sameChange[(sameChange.indexOf(s) + 1) % sameChange.length];
    const base = { step: `${s.repo}:${s.id}`, card: `${s.repo}:${s.id}`, repo: s.repo, lang: s.lang, change: s.change, file: s.file, fn: s.fn, cardTitle: `${s.repo} · ${s.fn}`, lines: s.lines };
    const add = (mutation, label, from, extra = {}) => {
      const truth = MUTATIONS[mutation].truth;
      const id = `${s.repo}:${s.id}:${mutation}`;
      return { ...base, id, mutation, note: MUTATIONS[mutation].note, label, code: from.code, context: from.context, truth, bad: truth === 'unclear' ? null : truth === 'bad', ...extra };
    };
    const held = heldOut.has(`${s.repo}:${s.id}`);
    return [
      add('original', s.label, s, { real: true }),
      add('neighbor', s.label, next, { shownFn: next.fn }),
      add('wrongAction', s.wrongLabel, s),
      add('unclear', s.unclearLabel, s, held ? { heldOut: true } : {}),
    ];
  });
}

export const tested = (given, asked) => ({
  given,
  asked,
  leftToCode: [
    'Which code a step links to: the markers in steps.json, cut by docviz.',
    'Which helpers count as context: names the step calls, minus built-ins and common methods, found in the repo (tests left out).',
  ],
  decision: 'The adopted rule: contradicted at or above “contradicted at” flags; otherwise every claim shown at or above “shown at” passes; anything else goes to review.',
  real: 'one request per step in a docviz pr comment',
});

export const bar = { ...BAR, ...ADOPTED };
