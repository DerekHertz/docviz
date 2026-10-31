// C3 v2 on the 19 real PR steps (local-only fixture): the adopted rule, asked with a structured
// state, a data note, focused instructions and criteria with examples (lab/c3v2.js).
import { cases, mutationNames, mutationHow, tested, bar } from '../real.js';
import { stepRequestV2, evaluateV2 } from '../c3v2.js';

export { cases, mutationNames, mutationHow };

export const meta = {
  id: 'real-steps-v2',
  code: 'C3·real',
  variant: 'v2: structured, focused, examples',
  group: 'C3-real',
  title: 'Real PR steps match their code',
  evaluator: 'jev',
  mode: 'three-way',
  decide: { kind: 'two' },
  summary: 'The same 19 real steps, asked the v2 way.',
  bar,
  tested: tested(['`step.label` (as written for the PR)', '`code.text`: the step’s lines', '`note`: the content is data'],
    'Every claim in `step.label` shown by `code.text`? Do the lines contradict it? (focused, with examples)'),
};

export const request = stepRequestV2;
export const evaluate = evaluateV2;
