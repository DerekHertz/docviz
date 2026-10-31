// Lab D1: which protection domains does a file change touch? Feeds the Atlas security lens
// (tickets 03 and 10) and review triage. Jev and plain text patterns answer the same cases;
// if patterns do as well, Jev isn't needed here.
import { readFileSync } from 'node:fs';

export const DOMAINS = {
  secrets: {
    name: 'Secrets',
    q: 'Does this change touch how credentials, tokens, API keys or pairing codes are handled, sent or stored?',
    yes: 'The changed lines read, send, check, store or guard a credential, token, key or pairing code.',
    no: 'No changed line handles a credential, token, key or pairing code.',
    pattern: /token|secret|api[_-]?key|password|credential|bearer|authorization|pairing|\.aws|\.ssh/i,
  },
  untrusted: {
    name: 'Untrusted input',
    q: 'Does this change touch how content from outside the program’s control is parsed, logged, rendered or passed on?',
    yes: 'The changed lines handle content the program does not control: web pages, model output, remote responses, user input, or files and commands written by others.',
    no: 'The changed lines only handle the program’s own data.',
    pattern: /innerHTML|JSON\.parse|postMessage|e\.data|argv|parse|sanitiz|escape|untrusted|eval\(|prompt/i,
  },
  network: {
    name: 'Network',
    q: 'Does this change touch network requests, served routes, or what is exposed to other origins?',
    yes: 'The changed lines make or serve a network request, or change which origins or routes are reachable.',
    no: 'No changed line makes, serves or exposes a network request.',
    pattern: /fetch\(|https?:\/\/|createServer|listen\(|cors|access-control|\borigin\b|\breq\.|\bres\.|\/v1\//i,
  },
  processFs: {
    name: 'Processes and files',
    q: 'Does this change spawn processes, or read, write or delete files or folders?',
    yes: 'The changed lines start a process or browser, or read, write, lock or delete files or folders.',
    no: 'No changed line starts a process or touches the filesystem.',
    pattern: /spawn|exec(File)?(Sync)?\(|child_process|writeFile|readFile|createReadStream|mkdir|rmSync|\brm\(|realpath|lstat|\bopen\(|unlink|chromium\.launch|^\+\s*run:/im,
  },
  access: {
    name: 'Access control',
    q: 'Does this change alter who or what may do something: permissions, grants, auth checks, origin checks, sandboxing, guards or allow-lists?',
    yes: 'The changed lines add, remove or change a permission, grant, auth or origin check, sandbox setting, guard or allow-list.',
    no: 'No changed line affects who or what may do something.',
    pattern: /permission|grant|revoke|\bcsp\b|content-security|sandbox|securityLevel|allow|deny|guard|\bauth|401|403|origin/i,
  },
};

const changes = () => JSON.parse(readFileSync(new URL('fixtures/domain-diffs.json', import.meta.url), 'utf8'));

export const mutationNames = Object.fromEntries(Object.entries(DOMAINS).map(([k, d]) => [k, d.name]));
export const mutationHow = Object.fromEntries(Object.entries(DOMAINS).map(([k, d]) => [k, d.q]));

/** One case per change × domain; `bad` means the change touches that domain. */
export function cases() {
  return changes().flatMap((ch) => Object.keys(DOMAINS).map((domain) => ({
    id: `${ch.id}:${domain}`, change: ch.id, card: ch.id, repo: ch.repo, sha: ch.sha, file: ch.file, diff: ch.diff,
    domain, mutation: domain, note: DOMAINS[domain].name, cardTitle: `${ch.repo} · ${ch.file}`,
    label: DOMAINS[domain].q, code: ch.diff,
    bad: ch.touches.includes(domain), truth: ch.touches.includes(domain) ? 'bad' : 'good',
  })));
}

export const diffRequest = (c) => ({
  state: { file: c.file, change: `\`\`\`diff\n${c.diff}\n\`\`\`` },
  questions: Object.fromEntries(Object.entries(DOMAINS).map(([k, d]) => [k, { type: 'noul', instructions: d.q, criteria: { true: d.yes, false: d.no } }])),
});

export const patternFlag = (domain, diff) => (DOMAINS[domain].pattern.test(diff) ? 1 : 0);

export const tested = (given, asked, decision) => ({
  given, asked,
  leftToCode: ['Which files a PR changed and their diffs: git.', 'Which places those files connect to: the Atlas index, not a model.'],
  decision,
  real: 'one request per changed file in a PR (five questions in it)',
});

export const bar = { catch: 0.9, falseAlarm: 0.2, costPerCard: 0.001, changed: 0.05 };
