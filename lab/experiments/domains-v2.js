// D1 v2: the five protection domains asked over complete hunks with context, with a data note,
// focused instructions and criteria with examples and what does not count (lab/domains2.js).
import { cases, mutationNames, mutationHow, tested, bar } from '../domains.js';
import { domainRequestV2 } from '../domains2.js';

export { cases, mutationNames, mutationHow };

export const meta = {
  id: 'domains-v2',
  code: 'D1',
  variant: 'Jev v2: whole hunks, focused, examples',
  group: 'D1',
  title: 'Which protection domains a change touches',
  evaluator: 'jev',
  summary: 'The same 100 cases as the first Jev version, asked over complete hunks with context, with focused questions and criteria that say what does not count.',
  bar,
  tested: tested(['the file path', 'complete hunks with 3 context lines (up to ~3k tokens)', 'a note that it is data'],
    'Per domain: does this change … (focus: the changed lines; context only explains them), with examples on both sides and what does not count.',
    'Jev’s yes-probability per domain; at or above the tuned threshold the change is marked as touching it.'),
};

export async function evaluate(c, { ask, run = new Map() }) {
  let first = false;
  if (!run.has(c.change)) { run.set(c.change, ask(domainRequestV2(c))); first = true; }
  const { answers, usage } = await run.get(c.change);
  const prob = answers[c.domain]?.noul;
  return {
    flag: prob, prob, answers: { [c.domain]: answers[c.domain] },
    usage: first ? usage : { ...usage, usd: 0, inputTokens: 0, shared: true },
    asked: JSON.stringify(domainRequestV2(c).questions[c.domain], null, 1),
  };
}
