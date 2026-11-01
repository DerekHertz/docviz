// C3, yes/no version: does a step's label describe what its lines of code do? One yes/no
// question; the middle of Jev's probability is the "can't tell" band (sent to review).
import { cases, state, tested, BAR, mutationNames, mutationHow, functionCode } from '../steps.js';

export { cases, mutationNames, mutationHow, functionCode };

export const meta = {
  id: 'step-matches-code',
  code: 'C3',
  variant: 'yes/no + bands',
  group: 'C3',
  title: 'Step label matches its code',
  evaluator: 'jev',
  mode: 'three-way',
  decide: { kind: 'bands' },
  summary: 'A PR diagram links each step to lines of code. Do those lines really do what the step says? '
    + 'Asked as one yes/no; an answer near the middle counts as “can’t tell” and goes to review.',
  bar: { ...BAR, passAt: 0.7, flagAt: 0.3 },
  tested: tested('Do these lines of code do what the step label says? (yes/no)',
    'Jev’s yes-probability: at or above “pass at” passes, at or below “flag at” flags, anything between goes to review.'),
};

export const request = (c) => ({
  state: state(c),
  questions: {
    matches: {
      type: 'noul',
      instructions: 'Do these lines of code do what the step label says?',
      criteria: {
        true: 'The code performs the action the label describes. The wording may differ.',
        false: 'The code does something different, does less than the label claims, or contradicts it.',
      },
    },
  },
});

export async function evaluate(c, { ask }) {
  const req = request(c);
  const { answers, usage } = await ask(req);
  const q = req.questions.matches;
  const prob = answers.matches?.noul;
  return { flag: Math.round((1 - (prob ?? 0)) * 1000) / 1000, prob, answers, usage, asked: `${q.instructions}\nyes: ${q.criteria.true}\nno: ${q.criteria.false}` };
}
