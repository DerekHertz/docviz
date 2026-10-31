// C3, two-question version: the yes/no and three-option versions passed labels that were
// consistent with the code but claimed more than it shows. "Does it match?" mixes two things;
// here they are asked apart: is every claim shown, and is anything contradicted?
// Adopted: the question and cutoffs live in helper/checks.js, which `docviz pr` runs.
import { cases, tested, BAR, mutationNames, mutationHow } from '../steps.js';
import { stepRequest, ADOPTED } from '../../helper/checks.js';

export { cases, mutationNames, mutationHow };

export const meta = {
  id: 'step-matches-two',
  code: 'C3',
  variant: 'two questions',
  group: 'C3',
  title: 'Step label matches its code',
  evaluator: 'jev',
  mode: 'three-way',
  decide: { kind: 'two' },
  summary: 'The same cases, asked as two separate yes/no questions: is every claim in the label shown by these lines, and does anything in them contradict it? '
    + 'Shown passes, contradicted flags, neither is “can’t tell”.',
  bar: { ...BAR, ...ADOPTED },
  tested: tested('Two questions, one request: “Is every claim in the step label shown by these lines?” and “Do these lines contradict the label?”',
    'Contradicted at or above “contradicted at” flags. Otherwise every claim shown at or above “shown at” passes. Anything else goes to review.'),
};

export const request = (c) => stepRequest(c.label, c.code);

export async function evaluate(c, { ask }) {
  const req = request(c);
  const { answers, usage } = await ask(req);
  const prob = answers.supported?.noul;
  const probContra = answers.contradicted?.noul;
  const q = req.questions;
  return {
    prob, probContra,
    // For the meter, calibration and drift: same scale as the other versions.
    flag: Math.round((1 - (prob ?? 0)) * 1000) / 1000,
    answers, usage,
    asked: Object.values(q).map((x) => `${x.instructions}\nyes: ${x.criteria.true}\nno: ${x.criteria.false}`).join('\n\n'),
  };
}
