// P1·claims, version 2: the same cases, asked jev-commit's way (structured state, whole hunks,
// claims scoped to the files shown, focused instructions, criteria with examples).
import { claimCases as cases, claimMutations as mutationNames, claimHow as mutationHow, claimBar, tested } from '../prs.js';
import { claimsRequest } from '../prs2.js';

export { cases, mutationNames, mutationHow };

export const meta = {
  id: 'pr-claims-v2',
  code: 'P1·claims',
  variant: 'v2: structured, whole hunks',
  group: 'P1-claims',
  title: 'PR description matches its diff',
  evaluator: 'jev',
  mode: 'three-way',
  decide: { kind: 'claims' },
  summary: 'The same cases as the first version, asked the way jev-commit and Jev Review ask, with claims scoped to the files shown.',
  bar: claimBar,
  tested: tested(['`message`', '`files`: every changed path with status and size', '`hunks`: complete hunks with context', '`note`: the content is data'],
    'Specific (judge `message` alone)? Is each claim about the code visible in `hunks` (listed files without hunks count as visible)? Do `hunks` contradict a claim (missing work is not a contradiction)?',
    'Contradicted flags. Nothing specific goes to review. Otherwise every claim visible passes, else review.'),
};

export async function evaluate(c, { ask }) {
  const req = claimsRequest(c);
  const { answers, usage } = await ask(req);
  const prob = answers.supported?.noul;
  return {
    prob, probContra: answers.contradicted?.noul, probSpecific: answers.specific?.noul,
    flag: prob == null ? null : Math.round((1 - prob) * 1000) / 1000, answers, usage, asked: JSON.stringify(req.questions, null, 1),
  };
}
