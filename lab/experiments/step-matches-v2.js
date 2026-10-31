// C3 v2 on the function fixtures: the adopted two questions and cutoffs, asked with a structured
// state, a data note, focused instructions and criteria with examples (lab/c3v2.js).
import { cases, tested, BAR, mutationNames, mutationHow } from '../steps.js';
import { ADOPTED } from '../../helper/checks.js';
import { stepRequestV2, evaluateV2 } from '../c3v2.js';

export { cases, mutationNames, mutationHow };

export const meta = {
  id: 'step-matches-v2',
  code: 'C3',
  variant: 'v2: structured, focused, examples',
  group: 'C3',
  title: 'Step label matches its code',
  evaluator: 'jev',
  mode: 'three-way',
  decide: { kind: 'two' },
  summary: 'The adopted two-question check and cutoffs, asked the way jev-commit and Jev Review ask. Same cases as the other C3 versions.',
  bar: { ...BAR, ...ADOPTED },
  tested: tested('`step.label` against `code.text`: every claim shown (focus: callers, timing and inputs only if shown)? contradicted (focus: a claim not shown is not a contradiction)? Criteria with examples about unrelated code.',
    'The adopted rule: contradicted ≥ 0.5 flags; otherwise shown ≥ 0.6 passes; else review.'),
};

export const request = stepRequestV2;
export const evaluate = evaluateV2;
