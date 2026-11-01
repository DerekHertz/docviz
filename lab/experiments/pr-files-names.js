// P1·files, baseline: a file counts as mentioned when its name, a part of it, or its folder
// appears in the description. Free; Jev has to beat it.
import { fileCases as cases, fileMutations as mutationNames, fileHow as mutationHow, namedIn, fileBar, tested } from '../prs.js';

export { cases, mutationNames, mutationHow };

export const meta = {
  id: 'pr-files-names',
  code: 'P1·files',
  variant: 'file names',
  group: 'P1-files',
  title: 'Changed files the PR description never mentions',
  evaluator: 'names',
  summary: 'The same cases, answered by a string match: is the file’s name, a part of it, or its folder in the description?',
  bar: fileBar,
  tested: tested(['the PR description', 'the file path'], 'Does the file’s name, a part of it or its folder appear in the description?', 'No match flags the file as unmentioned.'),
};

export async function evaluate(c) {
  const named = namedIn(c.file, c.description);
  return { flag: named ? 0 : 1, prob: named ? 1 : 0, answers: { named }, usage: { provider: 'names', usd: 0, estimated: false }, asked: `name match for ${c.file}` };
}
