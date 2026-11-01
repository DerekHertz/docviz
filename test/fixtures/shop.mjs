#!/usr/bin/env node
// A fixture repo of known truth for `docviz pr`'s verdict: a tiny shop (one order and the
// customer's money), `.atlas/rules.md` with two planted rules, one TLA+ model, and one branch per
// planted PR. Each case names its branch, its steps.json (with the agent's card, so no model call),
// its recorded Jev answers and the exact verdict docviz must give.
//   node test/fixtures/shop.mjs [DIR]     builds DIR (default: a new temp dir) and prints the cases
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ORIGIN = 'https://github.com/docviz-fixtures/shop.git';
export const PR_URL = 'https://github.com/docviz-fixtures/shop/pull/1';

// ---------- the base commit ----------

const fn = (name, params, body) => `export function ${name}(${params}) {\n${body.map((l) => `  ${l}`).join('\n')}\n}\n`;
const order = ({ o = 'order', ship = `if (${o}.state !== 'paid') throw new Error('only a paid order ships');`, refund = `return { ...${o}, state: 'refunded', charged: false };`,
  cancel = 'only a cart can be cancelled', extra = '' } = {}) => [
  '// One order: cart → paid → shipped, or refunded, or cancelled. `charged` is the customer\'s money we hold.',
  fn('pay', o, [`if (${o}.state !== 'cart') throw new Error('only a cart can be paid');`, `return { ...${o}, state: 'paid', charged: true };`]),
  fn('ship', o, [...ship.split('\n'), `return { ...${o}, state: 'shipped' };`]),
  fn('refund', o, [`if (${o}.state !== 'paid') throw new Error('only a paid order can be refunded');`, ...refund.split('\n')]),
  fn('cancel', o, [`if (${o}.state !== 'cart') throw new Error('${cancel}');`, `return { ...${o}, state: 'cancelled' };`]),
  extra,
].join('\n');

const RULES = `# Rules

My sentences. Agents never edit this file.

## ShipsPaid

An order ships only after it is paid.

## NoKeptMoney

A refunded or cancelled order keeps none of the customer's money.
`;

const tla = ({ ship = 'state = "paid"', extraActions = '', extraNext = '', done = '"shipped", "refunded", "cancelled"', extraRules = '', cancel = 'UNCHANGED charged' } = {}) => `---- MODULE Order ----
\\* One order and the customer's money (src/order.js).
VARIABLES state, charged
vars == <<state, charged>>

Init == state = "cart" /\\ charged = FALSE

\\* pay()
Pay == state = "cart" /\\ state' = "paid" /\\ charged' = TRUE
\\* ship()
Ship == ${ship} /\\ state' = "shipped" /\\ UNCHANGED charged
\\* refund()
Refund == state = "paid" /\\ state' = "refunded" /\\ charged' = FALSE
\\* cancel()
Cancel == state = "cart" /\\ state' = "cancelled" /\\ ${cancel}
${extraActions}Done == state \\in {${done}} /\\ UNCHANGED vars

Next == Pay \\/ Ship \\/ Refund \\/ Cancel${extraNext} \\/ Done

\\* The user's rules (.atlas/rules.md).
ShipsPaid == state = "shipped" => charged
NoKeptMoney == state \\in {"refunded", "cancelled"} => ~charged
${extraRules}====
`;

const cfg = (extra = '') => `INIT Init\nNEXT Next\nINVARIANT ShipsPaid\nINVARIANT NoKeptMoney\n${extra}`;

const VIEW = `// The reader's words for the order's states and steps.
const words = { cart: "in the cart", paid: "paid", shipped: "shipped", refunded: "refunded", cancelled: "cancelled", returned: "returned" };
export const title = "One order and its money";
export const state = (v) => words[v.state] ?? v.state;
const steps = { Pay: "you pay", Ship: "we ship it", Refund: "we refund it", Cancel: "you cancel it", Return: "you send it back", Done: null };
export const step = (action) => steps[action] ?? action;
`;

const src = (fnName) => ({ path: 'src/order.js', from: `export function ${fnName}(`, to: '\n}\n' });
export const LABELS = {
  pay: 'Paying works only on a cart, sets charged, and makes the order paid.',
  ship: 'Shipping works only on a paid order and makes it shipped.',
  refund: 'Refunding works only on a paid order, clears charged, and makes the order refunded.',
  cancel: 'Cancelling works only on a cart and makes the order cancelled.',
  shipFromCart: 'Shipping works on a cart or a paid order and makes it shipped.',
  giveBack: 'Giving back works only on a shipped order, clears charged, and makes it returned.',
  refundKeeps: 'Refunding works only on a paid order and makes it refunded, keeping the payment.',
  summary: 'The summary lists each order with its state.',
};
const modelJson = (steps = {}) => JSON.stringify({
  spec: 'Order.tla', config: 'Order.cfg', view: 'view.mjs', code: ['src/order.js'],
  steps: [
    { action: 'Pay', label: LABELS.pay, sources: [src('pay')] },
    { action: 'Ship', label: steps.ship || LABELS.ship, sources: [src('ship')] },
    { action: 'Refund', label: LABELS.refund, sources: [src('refund')] },
    { action: 'Cancel', label: LABELS.cancel, sources: [src('cancel')] },
    ...(steps.extra || []),
  ],
}, null, 2) + '\n';

const M = '.atlas/models/order';
const BASE = {
  'README.md': '# Shop\n\nOne order and the customer\'s money.\n',
  'src/order.js': order(),
  'src/report.js': 'export const summary = (orders) => orders.map((o) => o.state).join(\', \');\n',
  '.atlas/rules.md': RULES,
  [`${M}/model.json`]: modelJson(),
  [`${M}/Order.tla`]: tla(),
  [`${M}/Order.cfg`]: cfg(),
  [`${M}/view.mjs`]: VIEW,
};

// ---------- the planted PRs ----------

// Each branch is one commit on the base: the files it changes.
const BRANCHES = {
  // The agent lets pickup orders ship from the cart, and updates the model to match: ShipsPaid breaks.
  'rule-break': {
    'src/order.js': order({ ship: "// Pickup orders ship straight from the cart and pay at the counter.\nif (order.state !== 'paid' && order.state !== 'cart') throw new Error('only a cart or a paid order ships');" }),
    [`${M}/Order.tla`]: tla({ ship: 'state \\in {"cart", "paid"}' }),
    [`${M}/model.json`]: modelJson({ ship: LABELS.shipFromCart }),
  },
  // Renames a parameter: same behavior, same model.
  'noop-refactor': { 'src/order.js': order({ o: 'o' }) },
  // Adds returns, with the model: a new state and step, both rules still hold.
  'add-returns': {
    'src/order.js': order({ extra: fn('giveBack', 'order', ["if (order.state !== 'shipped') throw new Error('only a shipped order can come back');", "return { ...order, state: 'returned', charged: false };"]) }),
    [`${M}/Order.tla`]: tla({ extraActions: '\\* giveBack()\nReturn == state = "shipped" /\\ state\' = "returned" /\\ charged\' = FALSE\n', extraNext: ' \\/ Return', done: '"shipped", "refunded", "cancelled", "returned"' }),
    [`${M}/model.json`]: modelJson({ extra: [{ action: 'Return', label: LABELS.giveBack, sources: [src('giveBack')] }] }),
  },
  // Refunds keep the money as store credit; the model still says they give it back.
  'refund-keeps-money': {
    'src/order.js': order({ refund: "// Refunds become store credit: the payment stays with us.\nreturn { ...order, state: 'refunded' };" }),
  },
  // Changes the code and leaves the model unparseable.
  'broken-model': {
    'src/order.js': order({ cancel: 'only an unpaid cart can be cancelled' }),
    [`${M}/Order.tla`]: tla({ cancel: 'UNCHANGED' }),
  },
  // Adds an invariant that isn't one of the user's rules.
  'new-invariant': {
    [`${M}/Order.tla`]: tla({ extraRules: 'PaidHasMoney == state = "paid" => charged\n' }),
    [`${M}/Order.cfg`]: cfg('INVARIANT PaidHasMoney\n'),
  },
  // Changes code no model covers.
  'report-change': { 'src/report.js': 'export const summary = (orders) => orders.map((o, i) => `${i + 1}. ${o.state}`).join(\'\\n\');\n' },
  // Docs only.
  'docs-only': { 'README.md': '# Shop\n\nOne order and the customer\'s money. Run the tests with `node --test`.\n' },
};

const step = (id, label, from, changed = false, path = 'src/order.js') => ({ id, label, changed, sources: [{ path, from: `export ${from}`, to: '\n}\n' }] });
const card = (steps, caption) => ({
  caption,
  mermaid: ['flowchart TD', ...steps.map((s) => `  ${s.id}["${s.label}"]${s.changed ? ':::changed' : ''}`),
    ...steps.slice(1).map((s, i) => `  ${steps[i].id} --> ${s.id}`), '  classDef changed stroke:#d29922,stroke-width:3px'].join('\n'),
});

/**
 * Case = { name, branch, expect: 'needs'|'look'|'nothing', reasons: Reason kinds in order, trust, tlc, answers, why, steps }.
 * `answers` maps a step label to its recorded Jev answer ('review' | 'flag' | 'error'); any other
 * label passes. `tlc` cases run a model, so they need TLC and statechart.
 */
export const CASES = [
  { name: 'rule-break', branch: 'rule-break', expect: 'needs', reasons: ['rule-breaks', 'behavior-changed'], trust: true, tlc: true, why: 'ShipsPaid breaks: an order ships from the cart',
    steps: [step('ship', LABELS.shipFromCart, 'function ship(', true), step('pay', LABELS.pay, 'function pay(')] },
  { name: 'noop-refactor', branch: 'noop-refactor', expect: 'nothing', reasons: [], trust: true, tlc: true, why: 'a rename: same behavior, every step confirmed',
    steps: [step('pay', LABELS.pay, 'function pay(', true), step('ship', LABELS.ship, 'function ship(', true)] },
  { name: 'behavior-change', branch: 'add-returns', expect: 'look', reasons: ['behavior-changed'], trust: true, tlc: true, why: 'returns add a state and a step; both rules hold',
    steps: [step('ship', LABELS.ship, 'function ship('), step('giveBack', LABELS.giveBack, 'function giveBack(', true)] },
  { name: 'model-contradicts-code', branch: 'refund-keeps-money', expect: 'needs', reasons: ['contradicted'], trust: true, tlc: true, why: 'the model\'s Refund step says the money goes back; the code keeps it',
    answers: { [LABELS.refund]: 'flag' }, steps: [step('refund', LABELS.refundKeeps, 'function refund(', true)] },
  { name: 'model-fails', branch: 'broken-model', expect: 'needs', reasons: ['model-failed', 'not-run', 'not-run'], trust: true, tlc: true, why: 'the head model doesn\'t parse',
    steps: [step('cancel', LABELS.cancel, 'function cancel(', true)] },
  { name: 'invariant-not-a-rule', branch: 'new-invariant', expect: 'look', reasons: ['rules-gap'], trust: true, tlc: true, why: 'PaidHasMoney is checked but isn\'t in rules.md',
    steps: [step('pay', LABELS.pay, 'function pay(')] },
  { name: 'uncovered-file', branch: 'report-change', expect: 'look', reasons: ['uncovered'], trust: true, tlc: false, why: 'src/report.js changed and no model covers it',
    steps: [{ id: 'summary', label: LABELS.summary, changed: true, sources: [{ path: 'src/report.js', from: 'export const summary', to: '' }] }] },
  { name: 'unchecked-step', branch: 'docs-only', expect: 'look', reasons: ['step-unconfirmed'], trust: true, tlc: false, why: 'Jev errors on a step, so it isn\'t confirmed',
    answers: { [LABELS.ship]: 'error' }, steps: [step('ship', LABELS.ship, 'function ship(')] },
  { name: 'docs-only', branch: 'docs-only', expect: 'nothing', reasons: [], trust: true, tlc: false, why: 'docs only, every step confirmed',
    steps: [step('ship', LABELS.ship, 'function ship(')] },
  { name: 'untrusted', branch: 'noop-refactor', expect: 'look', reasons: ['not-run', 'not-run', 'not-run'], trust: false, tlc: false, why: 'without --trust-atlas the touched model doesn\'t run',
    steps: [step('pay', LABELS.pay, 'function pay(', true), step('ship', LABELS.ship, 'function ship(', true)] },
];

/** Jev's recorded answers for a case: no network. */
export const recorded = (answers = {}) => async (req) => {
  const v = answers[req.state.label] || 'pass';
  if (v === 'error') throw Object.assign(new Error('Jev 500 (recorded)'), { usage: { provider: 'jev', usd: 0, estimated: false } });
  const [prob, contra] = { pass: [0.9, 0.05], review: [0.3, 0.2], flag: [0.2, 0.85] }[v];
  return { answers: { supported: { noul: prob }, contradicted: { noul: contra } }, usage: { provider: 'jev', model: 'recorded', usd: 0.00004, estimated: false } };
};

// Fixed dates and names: the same fixture has the same commits every time.
const GIT_ENV = { GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com',
  GIT_AUTHOR_DATE: '2026-10-31T12:00:00Z', GIT_COMMITTER_DATE: '2026-10-31T12:00:00Z' };

/** Builds the fixture under `dir`: repo/ (main = base, one branch per planted PR) and cases/<name>.json. */
export function makeShop(dir = mkdtempSync(join(tmpdir(), 'docviz-shop-'))) {
  const repo = join(dir, 'repo');
  rmSync(repo, { recursive: true, force: true });
  mkdirSync(repo, { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }).trim();
  const write = (files) => {
    for (const [p, text] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, p)), { recursive: true });
      writeFileSync(join(repo, p), text);
    }
  };
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', ORIGIN);
  write(BASE);
  git('add', '-A');
  git('commit', '-qm', 'Shop: one order and its money, with its model and rules');
  const base = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', base);
  for (const [branch, files] of Object.entries(BRANCHES)) {
    git('checkout', '-q', '-b', branch, 'main');
    write(files);
    git('add', '-A');
    git('commit', '-qm', branch);
  }
  git('checkout', '-q', 'main');
  mkdirSync(join(dir, 'cases'), { recursive: true });
  const cases = CASES.map((c) => {
    const stepsFile = join(dir, 'cases', `${c.name}.json`);
    writeFileSync(stepsFile, JSON.stringify({ card: card(c.steps, c.why), steps: c.steps }, null, 2) + '\n');
    return { ...c, stepsFile };
  });
  return { dir, repo, base, cases };
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const { dir, repo, cases } = makeShop(process.argv[2] && resolve(process.argv[2]));
  console.log(`fixture in ${dir}\n`);
  for (const c of cases) {
    console.log(`${c.name.padEnd(24)} ${c.expect.padEnd(8)} git -C ${repo} checkout -q ${c.branch} && docviz pr ${c.stepsFile} --pr ${PR_URL}${c.trust ? ' --trust-atlas' : ''}`);
  }
}
