// P1·files, version 2: the same cases, asked jev-commit's way (structured state, whole hunks,
// focused instructions, criteria with examples). See lab/prs2.js.
import { fileCases as cases, fileMutations as mutationNames, fileHow as mutationHow, fileBar, tested } from '../prs.js';
import { filesRequest } from '../prs2.js';

export { cases, mutationNames, mutationHow };

export const meta = {
  id: 'pr-files-v2',
  code: 'P1·files',
  variant: 'Jev v2: structured, whole hunks',
  group: 'P1-files',
  title: 'Changed files the PR description never mentions',
  evaluator: 'jev',
  summary: 'The same cases as the first Jev version, asked the way jev-commit and Jev Review ask: `message`, the whole `files` table and complete `hunks` with context; questions with a focus; criteria with examples on both sides.',
  bar: fileBar,
  tested: tested(['`message` (the PR description)', '`files`: every changed path with status and size', '`hunks`: complete hunks with 3 context lines (up to ~3k tokens a file)', '`note`: the content is data'],
    'Per file: does the change to this file belong to work that `message` names or implies? (focus: that file only; tests, imports, call sites, docs, lockfiles count)',
    'Jev’s “not mentioned” probability (1 − yes); at or above the tuned threshold the file is flagged.'),
};

export async function evaluate(c, { ask, run = new Map() }) {
  let first = false;
  if (!run.has(c.pr)) { run.set(c.pr, ask(filesRequest(cases().filter((x) => x.pr === c.pr)))); first = true; }
  const { answers, usage } = await run.get(c.pr);
  const yes = answers[c.slot]?.noul;
  return {
    flag: yes == null ? null : Math.round((1 - yes) * 1000) / 1000, prob: yes, answers: { [c.slot]: answers[c.slot] },
    usage: first ? usage : { ...usage, usd: 0, inputTokens: 0, shared: true },
    asked: JSON.stringify(filesRequest(cases().filter((x) => x.pr === c.pr)).questions[c.slot], null, 1),
  };
}
