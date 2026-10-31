// C3 on real PR steps, + called definitions. Same cases as the other real-steps version (lab/real.js).
import { cases, mutationNames, mutationHow, tested, bar } from '../real.js';
import { stepRequest } from '../../helper/checks.js';

export { cases, mutationNames, mutationHow };

export const meta = {
  id: 'real-steps-context',
  code: 'C3·real',
  variant: '+ called definitions',
  group: 'C3-real',
  title: 'Real PR steps match their code',
  evaluator: 'jev',
  mode: 'three-way',
  decide: { kind: 'two' },
  summary: '19 steps from real changes in five projects (JS, TS, TSX, Python), labelled the way an agent writes a docviz pr steps file.',
  bar,
  tested: tested(['the step’s label (as written for the PR)', 'the step’s lines of code', 'the definitions of the project functions those lines call (one hop)'], 'Is every claim in the step label shown by these lines, or by the definitions of what they call? Do they contradict it?'),
};

export const request = (c) => stepRequest(c.label, c.code, c.context || undefined);

export async function evaluate(c, { ask }) {
  const req = request(c);
  const { answers, usage } = await ask(req);
  const prob = answers.supported?.noul;
  const probContra = answers.contradicted?.noul;
  return {
    prob, probContra, flag: Math.round((1 - (prob ?? 0)) * 1000) / 1000, answers, usage,
    asked: Object.values(req.questions).map((x) => `${x.instructions}\nyes: ${x.criteria.true}\nno: ${x.criteria.false}`).join('\n\n'),
  };
}
