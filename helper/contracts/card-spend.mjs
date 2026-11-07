// The card-spend harness, run by helper/contracts.js in a child process over a copy of the target's
// committed extension/ files. This controller loads none of that code. The target's background.js runs
// in one child process and the side panel's page-total expression in another (card-spend-device.mjs),
// each under Node's permission model. The controller holds chrome.* storage and the helper's HTTP
// replies, drives visualizeSelection and the registered Retry and Dismiss handlers, and computes every
// frame and the outcome from what the code did at that boundary. A child's messages are the target's
// effects, never a result: what the reviewed code prints, sends or patches can't author the outcome.
// It prints one JSON object: { outcome, observed, path, scope, detail }.
// Ported from historical-review/grounding/replay-pr1-dismiss-gap.mjs.
import { fork } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEVICE = join(dirname(fileURLToPath(import.meta.url)), 'card-spend-device.mjs');
const root = realpathSync(resolve(process.argv[2]));
const PATH = ['draw one card', 'call fails after spending', 'retry', 'dismiss while the call is out', 'helper returns usage', 'compare ledger with card and page totals'];
const SCOPE = 'Target’s committed extension code, run by a docviz controller that loads none of it: background.js in one Node child process and the side panel’s page-total expression in another, each under Node’s permission model (no file writes, no reads outside its copy, no child processes or workers). The controller holds chrome.* storage and the helper’s replies, drives the exported visualizeSelection and the registered card:retry / card:dismiss handlers, and records the ledger, card and page total after each action (observed.frames); nothing the reviewed code prints or sends is taken as a result. No browser, DOM or provider call. One scenario, not every path, and code that detects this harness can behave differently in Chrome.';
const LIMIT = { messages: 10_000, quietMs: 50, requestMs: 3000, totalMs: 20_000 };

const children = new Set();
let printed = false;
const print = (o) => {
  if (printed) return;
  printed = true;
  for (const c of children) c.kill('SIGKILL');
  process.stdout.write(JSON.stringify({ path: PATH, scope: SCOPE, ...o }), () => process.exit(0));
};
const stop = (outcome, detail) => { print({ outcome, observed: {}, detail }); return new Promise(() => {}); };
const said = (text) => String(text).split('\n')[0].slice(0, 300);
setTimeout(() => stop('error', `the scenario did not finish in ${LIMIT.totalMs / 1000} s`), LIMIT.totalMs);

/** A child process holding reviewed code, and the messages it sent, each checked before use. */
function device(role, readable) {
  const child = fork(DEVICE, [role, root], {
    cwd: root, env: {}, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json',
    execArgv: ['--permission', ...readable.map((p) => `--allow-fs-read=${p}`)],
  });
  children.add(child);
  const waiting = new Map();
  let count = 0;
  let last = Date.now();
  const d = {
    post: (m) => child.send(m),
    handle: () => false,
    next: (type, seq) => new Promise((ok) => waiting.set(`${type}:${seq ?? ''}`, ok)),
    lastMessageAt: () => last,
  };
  child.on('message', (m) => {
    last = Date.now();
    if (++count > LIMIT.messages) return stop('error', `the reviewed code sent the harness more than ${LIMIT.messages} messages`);
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return stop('error', 'the reviewed code sent the harness a message it doesn’t understand');
    const key = `${m.type}:${m.seq ?? ''}`;
    if (waiting.has(key)) { const ok = waiting.get(key); waiting.delete(key); return ok(m); }
    if (!d.handle(m)) stop('error', `the reviewed code sent the harness an unexpected “${said(m.type).slice(0, 40)}” message`);
  });
  child.on('error', (e) => stop('error', `the ${role} process failed: ${said(e.message)}`));
  child.on('exit', (code, signal) => stop('error', `the reviewed code’s ${role} process exited (${signal || `code ${code}`}) before the scenario finished`));
  return d;
}

const backgroundFile = join(root, 'extension/background.js');
const sidepanelFile = join(root, 'extension/sidepanel.js');
if (!existsSync(backgroundFile)) await stop('inapplicable', 'extension/background.js is absent');
const pageExpr = existsSync(sidepanelFile) && readFileSync(sidepanelFile, 'utf8').match(/const page = (.*);/)?.[1];
if (!pageExpr) await stop('inapplicable', 'extension/sidepanel.js has no `const page = …;` page total');

// chrome.storage as the target wrote it. Null-prototype areas: a stored "__proto__" is just a key.
const area = (values = {}) => Object.assign(Object.create(null), values);
const records = { local: area({ budget: 100, prefs: { depth: 'mechanism', pictures: 'off' }, spend: { day: new Date().toLocaleDateString('en-CA'), today: 0, total: 0, calls: 0 } }), session: area() };
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const keysOf = (arg) => (typeof arg === 'string' ? [arg] : Array.isArray(arg) ? arg : Object.keys(arg ?? {})).filter((k) => typeof k === 'string');
const STORAGE = {
  get: (r, arg) => Object.fromEntries((arg === null ? Object.keys(r) : keysOf(arg)).filter((k) => Object.hasOwn(r, k)).map((k) => [k, clone(r[k])])),
  set: (r, arg) => { for (const [k, v] of Object.entries(arg && typeof arg === 'object' ? arg : {})) r[k] = clone(v); return null; },
  remove: (r, arg) => { for (const k of keysOf(arg)) delete r[k]; return null; },
};

const background = device('background', [root, DEVICE]);
const requests = [];
const waiters = [];
background.handle = (m) => {
  if (m.type === 'failed') return stop('error', `background.js threw while loading: ${said(m.detail)}`);
  if (!Number.isSafeInteger(m.id)) return false;
  if (m.type === 'storage') {
    if (!Object.hasOwn(records, m.area) || !Object.hasOwn(STORAGE, m.method)) return false;
    background.post({ type: 'reply', id: m.id, value: STORAGE[m.method](records[m.area], m.arg) });
    return true;
  }
  if (m.type === 'fetch') { if (waiters.length) waiters.shift()(m.id); else requests.push(m.id); return true; }
  return false;
};
const replyTo = (id) => ({ ok, status, body }) => background.post({ type: 'reply', id, value: { ok, status, body } });
const nextRequest = () => new Promise((ok) => {
  if (requests.length) return ok(replyTo(requests.shift()));
  const timer = setTimeout(() => stop('error', 'no helper call was made'), LIMIT.requestMs);
  waiters.push((id) => { clearTimeout(timer); ok(replyTo(id)); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Settled: the reviewed code has sent nothing for a quiet period.
const settle = async () => { do await sleep(LIMIT.quietMs); while (Date.now() - background.lastMessageAt() < LIMIT.quietMs); };
let seq = 0;
const act = async (type, fields) => {
  const n = ++seq;
  const done = background.next(type === 'draw' ? 'drawn' : 'sent', n);
  background.post({ type, seq: n, ...fields });
  const r = await done;
  if (!r.ok) await stop('error', `${type === 'draw' ? 'visualizeSelection' : `${fields.message.type}`} threw: ${said(r.detail)}`);
};

const usage = { usd: 1, estimated: false, provider: 'controlled-helper', inputTokens: 10, outputTokens: 10 };
const cardsOf = (tab) => (records.session[`tab:${tab}`]?.keys || []).map((k) => records.session[`card:${k}`]).filter(Boolean);
const costOf = (card) => card?.cost?.usd || 0;
// What storage held right after an action: the ledger, the card record and what the side panel reads.
const frames = [];
const pageInputs = [];
const snapshot = (id, action, key) => {
  const card = key ? records.session[`card:${key}`] : undefined;
  const state = records.session['tab:1'] || { keys: [] };
  frames.push({
    id, action, ledgerPaid: records.local.spend.total, ledgerCalls: records.local.spend.calls,
    card: { present: !!card, status: card?.status ?? null, cost: card?.cost?.usd ?? null },
    tabCards: state.keys.length, unassigned: state.unassigned || 0, pageTotal: null,
  });
  pageInputs.push(clone({ cards: cardsOf(1), state }));
};

try {
  const ready = await background.next('ready');
  if (!ready.visualizeSelection) await stop('inapplicable', 'background.js exports no visualizeSelection');
  if (!ready.listener) await stop('inapplicable', 'background.js registers no runtime message listener');

  const drawing = act('draw');
  const first = await nextRequest();
  const key = records.session['tab:1']?.keys?.[0];
  if (typeof key !== 'string') await stop('inapplicable', 'visualizeSelection made no card for the tab');
  snapshot('before-first-reply', 'draw one card; the helper call is out', key);
  first({ ok: false, status: 500, body: { error: 'controlled failure after spending', usage } });
  await drawing;
  await settle();
  snapshot('after-failed-draw', 'the call fails after spending $1', key);

  await act('send', { message: { type: 'card:retry', key } });
  const second = await nextRequest();
  snapshot('after-retry-request', 'Retry; a second call is out', key);
  const chargedBeforeDismiss = cardsOf(1).reduce((t, c) => t + costOf(c), 0) + (records.session['tab:1']?.unassigned || 0);
  await act('send', { message: { type: 'card:dismiss', key } });
  await settle();
  snapshot('after-dismiss', 'Dismiss while the call is out', key);
  const dismissed = !records.session[`card:${key}`];

  second({ ok: true, status: 200, body: { result: { title: 'Returned', mermaid: 'flowchart TD\n A["Returned"]' }, usage } });
  await settle();
  snapshot('after-late-return', 'the late call returns with $1 of usage', key);

  // The side panel is its own page: its expression runs apart from background.js, on the states recorded above.
  const page = device('page', [DEVICE]);
  const totals = page.next('totals');
  page.handle = (m) => { if (m.type !== 'failed') return false; return stop('error', `the side panel’s page total threw: ${said(m.detail)}`); };
  page.post({ expr: pageExpr, inputs: pageInputs });
  const { values } = await totals;
  if (!Array.isArray(values) || values.length !== frames.length || !values.every(Number.isFinite)) await stop('error', 'the side panel’s page total is not a number at every frame');
  frames.forEach((f, i) => { f.pageTotal = values[i]; });

  const pageTotalAfter = frames.at(-1).pageTotal;
  const ledgerPaid = records.local.spend.total;
  const helperReported = 2 * usage.usd;
  const unattributed = helperReported - chargedBeforeDismiss - pageTotalAfter;
  const observed = { helperReported, ledgerPaid, chargedBeforeDismiss, dismissed, pageTotalAfter, unattributed, cardRecordAfter: records.session[`card:${key}`] ? 'present' : 'absent', frames };
  const holds = ledgerPaid === helperReported && unattributed === 0;
  print({ outcome: holds ? 'holds' : 'fails', observed,
    detail: holds ? 'every reported call is in the ledger and on a card or the page total'
      : `ledger ${ledgerPaid} for ${helperReported} reported; cards and page showed ${chargedBeforeDismiss} before Dismiss and show ${pageTotalAfter} after the late return; ${unattributed} unattributed` });
} catch (e) {
  await stop('error', said(e?.message || e));
}
