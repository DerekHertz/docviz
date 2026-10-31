// D1, baseline: a text pattern per domain over the changed lines, like den's risk-check.
// Free and instant; Jev has to beat it to be worth adopting.
import { cases, mutationNames, mutationHow, patternFlag, DOMAINS, tested, bar } from '../domains.js';

export { cases, mutationNames, mutationHow };

export const meta = {
  id: 'domains-patterns',
  code: 'D1',
  variant: 'text patterns',
  group: 'D1',
  title: 'Which protection domains a change touches',
  evaluator: 'patterns',
  summary: 'The same 100 cases, answered by one text pattern per domain over the changed lines. No model, no cost.',
  bar,
  tested: tested(['the changed lines'], 'Does the domain’s pattern match any changed line?', 'A match marks the change as touching the domain.'),
};

export async function evaluate(c) {
  const flag = patternFlag(c.domain, c.diff);
  return { flag, prob: flag, answers: { pattern: String(DOMAINS[c.domain].pattern), match: !!flag }, usage: { provider: 'patterns', usd: 0, estimated: false }, asked: `pattern ${DOMAINS[c.domain].pattern}` };
}
