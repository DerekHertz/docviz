// C3, two-question version: the yes/no and three-option versions passed labels that were
// consistent with the code but claimed more than it shows. "Does it match?" mixes two things;
// here they are asked apart: is every claim shown, and is anything contradicted?
import { cases, state, tested, BAR, mutationNames, mutationHow } from '../steps.js';

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
  bar: { ...BAR, supportedAt: 0.7, contradictedAt: 0.5 },
  tested: tested('Two questions, one request: “Is every claim in the step label shown by these lines?” and “Do these lines contradict the label?”',
    'Contradicted at or above “contradicted at” flags. Otherwise every claim shown at or above “shown at” passes. Anything else goes to review.'),
};

export const request = (c) => ({
  state: state(c),
  questions: {
    supported: {
      type: 'noul',
      instructions: 'Is every claim in the step label shown by these lines of code?',
      criteria: {
        true: 'Everything the label says happens is visible in the code shown. Rewording is fine.',
        false: 'At least one claim in the label (who calls it, where a value comes from, when or why it runs) is not visible in the code shown, or the code shows otherwise.',
      },
    },
    contradicted: {
      type: 'noul',
      instructions: 'Do these lines of code contradict the step label?',
      criteria: {
        true: 'The code shown does something different from the label, or plainly does less than the label claims.',
        false: 'Nothing in the code shown conflicts with the label, even if the label mentions things the code does not show.',
      },
    },
  },
});

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
