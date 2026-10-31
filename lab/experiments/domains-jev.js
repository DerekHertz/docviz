// D1, Jev: one request per changed file asks all five protection domains at once.
import { cases, mutationNames, mutationHow, diffRequest, tested, bar } from '../domains.js';

export { cases, mutationNames, mutationHow };

export const meta = {
  id: 'domains-jev',
  code: 'D1',
  variant: 'Jev',
  group: 'D1',
  title: 'Which protection domains a change touches',
  evaluator: 'jev',
  summary: '20 real file changes from public repos (docviz, dimsumden, second-lead). For each of five domains: does this change touch it? Feeds the Atlas security lens and review triage.',
  bar,
  tested: tested(['the file path', 'its changed lines (up to 120)'],
    'For each domain, one yes/no: does this change touch secrets / untrusted input / network / processes and files / access control?',
    'Jev’s yes-probability per domain; at or above the tuned threshold the change is marked as touching it.'),
};

// Evaluations in one lab run share one request per change; the server passes a fresh `run`.
export const freshRun = () => new Map();

export async function evaluate(c, { ask, run = freshRun() }) {
  let first = false;
  if (!run.has(c.change)) { run.set(c.change, ask(diffRequest(c))); first = true; }
  const { answers, usage } = await run.get(c.change);
  const prob = answers[c.domain]?.noul;
  return {
    flag: prob, prob, answers: { [c.domain]: answers[c.domain] },
    // The request is charged once, to the case that made it.
    usage: first ? usage : { ...usage, usd: 0, inputTokens: 0, shared: true },
    asked: `${diffRequest(c).questions[c.domain].instructions}\nyes: ${diffRequest(c).questions[c.domain].criteria.true}\nno: ${diffRequest(c).questions[c.domain].criteria.false}`,
  };
}
