// P1·files, Jev: one request per PR asks, for every changed file, whether the description
// mentions or implies its change.
import { fileCases as cases, fileMutations as mutationNames, fileHow as mutationHow, filesRequest, fileBar, tested } from '../prs.js';

export { cases, mutationNames, mutationHow };

export const meta = {
  id: 'pr-files-jev',
  code: 'P1·files',
  variant: 'Jev',
  group: 'P1-files',
  title: 'Changed files the PR description never mentions',
  evaluator: 'jev',
  summary: '14 real commits from docviz, dimsumden and second-lead, their messages as the PR description, plus one file planted from another commit in the same repo. Which files are unmentioned work?',
  bar: fileBar,
  tested: tested(['the PR description', 'every changed file’s changed lines (up to 150 each)'],
    'Per file: is the change to this file mentioned or implied by the PR description?',
    'Jev’s “not mentioned” probability; at or above the tuned threshold the file is flagged as unmentioned work.'),
};

export async function evaluate(c, { ask, run = new Map() }) {
  let first = false;
  if (!run.has(c.pr)) { run.set(c.pr, ask(filesRequest(cases().filter((x) => x.pr === c.pr)))); first = true; }
  const { answers, usage } = await run.get(c.pr);
  const mentioned = answers[c.slot]?.noul;
  const flag = mentioned == null ? null : Math.round((1 - mentioned) * 1000) / 1000;
  return {
    flag, prob: mentioned, answers: { [c.slot]: answers[c.slot] },
    usage: first ? usage : { ...usage, usd: 0, inputTokens: 0, shared: true },
    asked: `Is the change to \`${c.file}\` mentioned or implied by the PR description?`,
  };
}
