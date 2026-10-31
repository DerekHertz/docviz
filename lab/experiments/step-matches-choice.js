// C3, three-option version: same cases as the yes/no version, but Jev may answer "can't tell"
// outright. Options are named by meaning, not yes/no: option names alone can sway a typed
// decision model ("Type-Safe Is Not Error-Free", arXiv 2609.26758).
import { cases, state, tested, BAR, mutationNames, mutationHow } from '../steps.js';

export { cases, mutationNames, mutationHow };

const OPTIONS = {
  matches: 'The code shown performs the action the label describes. The wording may differ.',
  differs: 'The code shown does something different, does less than the label claims, or contradicts it.',
  cantTell: 'The label depends on code or context that is not shown (callers, settings, other files), so these lines can neither confirm nor rule it out.',
};

export const meta = {
  id: 'step-matches-choice',
  code: 'C3',
  variant: 'three options',
  group: 'C3',
  title: 'Step label matches its code',
  evaluator: 'jev',
  mode: 'three-way',
  decide: { kind: 'choice', map: { matches: 'pass', differs: 'flag', cantTell: 'review' } },
  summary: 'The same cases as the yes/no version, but Jev picks one of three options: matches, differs, or can’t tell from these lines.',
  bar: { ...BAR, minConfidence: 0 },
  tested: tested('Which describes these lines against the step label: matches, differs, or can’t tell from these lines?',
    'Jev’s chosen option: matches passes, differs flags, can’t tell goes to review. Below “min confidence” any answer goes to review.'),
};

export const request = (c) => ({
  state: state(c),
  questions: {
    matches: {
      type: 'choice',
      instructions: 'Compare the step label with the code shown. Which describes them?',
      criteria: OPTIONS,
    },
  },
});

export async function evaluate(c, { ask }) {
  const req = request(c);
  const { answers, usage } = await ask(req);
  const a = answers.matches || {};
  const p = a.probabilities || {};
  return {
    choice: a.choice, probabilities: p, confidence: a.confidence,
    // P(it doesn't match), for the meter, calibration and drift: same scale as the yes/no version.
    flag: Math.round((1 - (p.matches ?? 0)) * 1000) / 1000,
    prob: p.matches, answers, usage,
    asked: `${req.questions.matches.instructions}\n${Object.entries(OPTIONS).map(([k, v]) => `${k}: ${v}`).join('\n')}`,
  };
}
