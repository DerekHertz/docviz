// P1·claims, Jev: does the PR description match its diff? Three questions in one request
// (specific? every claim shown? contradicted?), decided three-way.
import { claimCases as cases, claimMutations as mutationNames, claimHow as mutationHow, claimsRequest, claimBar, tested } from '../prs.js';

export { cases, mutationNames, mutationHow };

export const meta = {
  id: 'pr-claims-jev',
  code: 'P1·claims',
  variant: 'three questions',
  group: 'P1-claims',
  title: 'PR description matches its diff',
  evaluator: 'jev',
  mode: 'three-way',
  decide: { kind: 'claims' },
  summary: 'The same 14 commits. Each diff with its own description (good), another PR’s (broken), its own plus one false claim (broken), or filler (can’t tell: nothing to check).',
  bar: claimBar,
  tested: tested(['the PR description', 'the diff (up to 6 files, 150 changed lines each)'],
    'Does the description make a specific claim? Is every claim about the code shown by the diff (ignoring why or where it came from)? Does the diff contradict it?',
    'Contradicted flags. A description with nothing specific goes to review. Otherwise every claim shown passes, else review.'),
};

export async function evaluate(c, { ask }) {
  const req = claimsRequest(c);
  const { answers, usage } = await ask(req);
  const prob = answers.supported?.noul;
  return {
    prob, probContra: answers.contradicted?.noul, probSpecific: answers.specific?.noul,
    flag: prob == null ? null : Math.round((1 - prob) * 1000) / 1000, answers, usage,
    asked: Object.values(req.questions).map((q) => `${q.instructions}\nyes: ${q.criteria.true}\nno: ${q.criteria.false}`).join('\n\n'),
  };
}
