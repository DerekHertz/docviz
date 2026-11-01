// Lab P1: does a PR say what it does? For agent-written PRs the description and the diff drift.
// Two questions, from jev-commit's design: which changed files does the description never
// mention (P1·files), and do its claims match the diff (P1·claims)?
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BAR } from './steps.js';
import { ADOPTED } from '../helper/checks.js';

const prs = () => JSON.parse(readFileSync(new URL('fixtures/pr-claims.json', import.meta.url), 'utf8'));
const hash = (s) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16);
const isTestOrDoc = (p) => /(^|\/)(test|tests)\/|\.test\.|README|\.md$|\.json$/i.test(p);
const fence = (lang, s) => `\`\`\`${lang}\n${s}\n\`\`\``;

// ---------- P1·files: unmentioned work ----------

/**
 * Every changed file of each PR (mentioned: they all are, docs and tests included), plus one
 * code file planted from the next commit in the same repo: work the description never mentions.
 */
export function fileCases() {
  const all = prs();
  return all.flatMap((pr) => {
    // From the next commits in the same repo: a file this PR doesn't change and its description
    // doesn't name, code before tests and docs. Anything else would be mentioned work, not planted.
    const same = all.filter((x) => x.repo === pr.repo);
    const donors = [...same.slice(same.indexOf(pr) + 1), ...same.slice(0, same.indexOf(pr))];
    const fits = (f) => !pr.files.some((g) => g.file === f.file) && !namedIn(f.file, pr.message);
    let plant;
    let donor;
    for (const wantCode of [true, false]) {
      for (const d of donors) {
        plant = d.files.find((f) => fits(f) && (!wantCode || !isTestOrDoc(f.file)));
        if (plant) { donor = d; break; }
      }
      if (plant) break;
    }
    if (!plant) throw new Error(`no file to plant into ${pr.id}`);
    const files = pr.files.map((f) => ({ ...f, planted: false, from: pr.id }));
    files.splice(hash(pr.id) % (files.length + 1), 0, { ...plant, planted: true, from: donor.id });
    return files.map((f, i) => ({
      id: `${pr.id}:${f.file}${f.planted ? ':planted' : ''}`, pr: pr.id, card: pr.id, repo: pr.repo, slot: `f${i}`,
      file: f.file, diff: f.diff, hunks: f.hunks, planted: f.planted, from: f.from, description: pr.message,
      mutation: f.planted ? 'planted' : 'own', note: f.planted ? 'A file from another commit' : 'The PR’s own file',
      cardTitle: `${pr.repo} · ${pr.message.split('\n')[0].slice(0, 60)}`, label: pr.message.split('\n')[0], code: f.diff,
      bad: f.planted, truth: f.planted ? 'bad' : 'good',
    }));
  });
}

export const fileMutations = { own: 'The PR’s own file (docs and tests count)', planted: 'A file from another commit in the same repo' };
export const fileHow = { own: 'as committed; its description names it or describes its work', planted: 'a code file from the next commit in the same repo, inserted among the PR’s files' };

/** One request per PR: the description, every file's changed lines, and one question per file. */
export function filesRequest(prCases) {
  const desc = prCases[0].description;
  return {
    state: { description: desc, files: prCases.map((c) => `### ${c.file}\n${fence('diff', c.diff)}`).join('\n\n') },
    questions: Object.fromEntries(prCases.map((c) => [c.slot, {
      type: 'noul',
      instructions: `Is the change to \`${c.file}\` mentioned or implied by the PR description?`,
      criteria: {
        true: 'The description names this file or describes the work its change does. Tests and docs for a described change count.',
        false: 'The description neither names this file nor describes what its change does.',
      },
    }])),
  };
}

const GENERIC = new Set(['test', 'tests', 'src', 'lib', 'index', 'scripts', 'apps', 'app', 'utils', 'main', 'docs', 'spec', 'helper', 'agents', 'bridge', 'migrations', 'supabase', 'database']);

/** The baseline: the file's name, its parts, or its folder appear in the description. */
export function namedIn(path, description) {
  const d = description.toLowerCase();
  const parts = path.toLowerCase().split('/');
  const stem = parts.at(-1).replace(/\.[^.]+$/, '').replace(/\.(test|spec)$/, '');
  const words = [stem, ...stem.split(/[-_.]/), parts.at(-2) || ''].filter((w) => w.length >= 3 && !GENERIC.has(w));
  return words.some((w) => d.includes(w));
}

// ---------- P1·claims: does the description match the diff? ----------

const FILLER = ['Update files', 'Fix stuff', 'wip', 'Address review feedback'];

export function claimCases() {
  const all = prs();
  return all.flatMap((pr, i) => {
    const other = all[(i + 1) % all.length];
    const diff = pr.files.map((f) => `### ${f.file}\n${fence('diff', f.diff)}`).join('\n\n');
    const base = { pr: pr.id, card: pr.id, repo: pr.repo, diff, code: diff, cardTitle: `${pr.repo} · ${pr.sha}`, table: pr.table, hunks: pr.files.flatMap((f) => (f.hunks || []).map((text) => ({ path: f.file, text }))) };
    const add = (mutation, description, truth, extra = {}) => ({
      ...base, id: `${pr.id}:${mutation}`, mutation, note: CLAIM_KINDS[mutation].note, description, label: description.split('\n')[0],
      truth, bad: truth === 'unclear' ? null : truth === 'bad', ...extra,
    });
    return [
      add('original', pr.message, 'good', { real: true }),
      add('swapped', other.message, 'bad', { from: other.id }),
      add('falseClaim', `${pr.message}\n\n${pr.falseClaim}`, 'bad', { claim: pr.falseClaim }),
      add('filler', FILLER[i % FILLER.length], 'unclear'),
    ];
  });
}

const CLAIM_KINDS = {
  original: { note: 'The commit’s own description', how: 'as the agent wrote it, co-author lines removed' },
  swapped: { note: 'Another PR’s description', how: 'the next commit’s message on this diff' },
  falseClaim: { note: 'Real description plus one false claim', how: 'a plausible sentence the diff doesn’t do, appended' },
  filler: { note: 'Filler description', how: '“Update files”, “Fix stuff”, “wip” or “Address review feedback”: nothing to check' },
};
export const claimMutations = Object.fromEntries(Object.entries(CLAIM_KINDS).map(([k, v]) => [k, v.note]));
export const claimHow = Object.fromEntries(Object.entries(CLAIM_KINDS).map(([k, v]) => [k, v.how]));

export const claimsRequest = (c) => ({
  state: { description: c.description, diff: c.diff },
  questions: {
    specific: {
      type: 'noul',
      instructions: 'Does the description make at least one specific claim about what the code change does?',
      criteria: { true: 'It names a concrete behavior, check, file or fix.', false: 'It is filler, such as “update files”, “fix stuff” or “wip”.' },
    },
    supported: {
      type: 'noul',
      instructions: 'Is every claim the description makes about what the code does shown by this diff?',
      criteria: {
        true: 'Each behavior the description says the change has is visible in the changed lines. Ignore statements about why or where the change came from (reviews, tickets, PR numbers).',
        false: 'At least one claim about what the code does is not visible in the changed lines.',
      },
    },
    contradicted: {
      type: 'noul',
      instructions: 'Does the diff contradict the description?',
      criteria: {
        true: 'The changed lines do something different from what the description says, or the opposite.',
        false: 'Nothing in the changed lines conflicts with the description, even if the description leaves things out.',
      },
    },
  },
});

/** Contradicted flags; a description with nothing specific goes to review; otherwise C3's rule. */
export function decideClaims({ prob, probContra, probSpecific }, bar = {}) {
  if (prob == null || probContra == null || probSpecific == null) return null;
  if (probContra >= (bar.contradictedAt ?? ADOPTED.contradictedAt)) return 'flag';
  if (probSpecific < (bar.specificAt ?? 0.5)) return 'review';
  return prob >= (bar.supportedAt ?? ADOPTED.supportedAt) ? 'pass' : 'review';
}

export const fileBar = { catch: 0.9, falseAlarm: 0.1, costPerCard: 0.001, changed: 0.05 };
export const claimBar = { ...BAR, ...ADOPTED, specificAt: 0.5 };

export const tested = (given, asked, decision) => ({
  given, asked,
  leftToCode: ['Which files a PR changed and their diffs: git.', 'Whether a file’s name appears in the description: a string match (the baseline).'],
  decision,
  real: 'one request per PR',
});
