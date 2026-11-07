// The card-spend harness, run by helper/contracts.js in a child process over a copy of the target's
// committed extension/ files. This controller loads none of that code. The target's background.js runs
// in a child process under Node's permission model (card-spend-device.mjs). The controller holds
// chrome.* storage and the helper's HTTP replies, drives visualizeSelection and the registered Retry and
// Dismiss handlers, and computes every frame and the outcome from what the code did at that boundary.
// The child's messages are taken only as its chrome.storage and fetch calls and its runtime listener's
// replies, never as a value or result. No side-panel code runs. The side panel must be one a reviewer
// registered by content (card-spend-panel.mjs). docviz asks the background for panel:get the way that
// panel does, and computes the panel's page total from the reply with its own copy of the panel's code.
// It prints one JSON object: { outcome, observed, path, scope, detail }.
// Ported from historical-review/grounding/replay-pr1-dismiss-gap.mjs.
import { fork } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { knownPanel, refreshCards } from './card-spend-panel.mjs';

const DEVICE = join(dirname(fileURLToPath(import.meta.url)), 'card-spend-device.mjs');
const root = realpathSync(resolve(process.argv[2]));
const PATH = ['draw one card', 'call fails after spending', 'retry', 'dismiss while the call is out', 'helper returns usage', 'compare ledger with card and page totals'];
const SCOPE = 'Target’s committed extension code, run by a docviz controller that loads none of it. background.js runs in a Node child process under Node’s permission model (no file writes, no reads outside its copy, no child processes or workers); its messages are taken only as chrome.storage and fetch calls and its runtime listener’s replies, never as a value or result. The controller holds chrome.* storage and the helper’s replies, drives the exported visualizeSelection and the registered card:retry / card:dismiss handlers, and records the ledger, card and page total after each action (observed.frames). No side-panel code runs. The side panel (manifest side_panel page, sidepanel.html and every module and stylesheet it loads) must match, byte for byte, a side panel a reviewer registered in docviz (card-spend-panel.mjs); any other side panel is unsupported. After each action docviz sends the background the panel’s own panel:get { tabId } message and computes the page total from the reply with docviz’s copy of that panel’s refreshCards. The ledger is chrome.storage.local spend.total, which that panel reads directly. No browser, DOM or provider call. One scenario, not every path, and code that detects this harness can behave differently in Chrome.';
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

/** The child process holding the reviewed background.js, and the messages it sent, each checked before use. */
function device() {
  const child = fork(DEVICE, [root], {
    cwd: root, env: {}, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json',
    execArgv: ['--permission', `--allow-fs-read=${root}`, `--allow-fs-read=${DEVICE}`],
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
  child.on('error', (e) => stop('error', `the background process failed: ${said(e.message)}`));
  child.on('exit', (code, signal) => stop('error', `the reviewed code’s background process exited (${signal || `code ${code}`}) before the scenario finished`));
  return d;
}

// The side panel must be a registered one, matched by content; docviz never reads which of its lines run.
if (!existsSync(join(root, 'extension/background.js'))) await stop('inapplicable', 'extension/background.js is absent');
const known = knownPanel(root);
if (known.missing) await stop('inapplicable', known.missing);

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

const background = device();
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
  return r;
};

const usage = { usd: 1, estimated: false, provider: 'controlled-helper', inputTokens: 10, outputTokens: 10 };
// What the registered side panel shows right after an action. Its cards, unassigned spend and page total
// come from the background's reply to the panel's own panel:get { tabId }. Its ledger comes from
// chrome.storage.local, which that panel reads directly (settings.js getSettings, `s.spend?.total || 0`).
const frames = [];
const snapshot = async (id, action, key) => {
  const { response } = await act('send', { message: { type: 'panel:get', tabId: 1 } });
  let shown;
  try { shown = refreshCards(response); } catch (e) { return stop('error', `the side panel can’t show panel:get’s reply after: ${action} (${said(e?.message || e)})`); }
  if (!Number.isFinite(shown.page)) return stop('error', `the side panel’s page total is not a number after: ${action}`);
  const ledgerPaid = records.local.spend?.total || 0;
  if (!Number.isFinite(ledgerPaid)) return stop('error', `the ledger is not a number after: ${action}`);
  const card = shown.cards.find((c) => c.key === key);
  frames.push({
    id, action, ledgerPaid, ledgerCalls: records.local.spend?.calls ?? null,
    card: { present: !!card, status: card?.status ?? null, cost: card?.cost?.usd ?? null },
    tabCards: shown.cards.length, unassigned: shown.state.unassigned || 0, pageTotal: shown.page,
  });
  return shown.page;
};

try {
  const ready = await background.next('ready');
  if (!ready.visualizeSelection) await stop('inapplicable', 'background.js exports no visualizeSelection');
  if (!ready.listener) await stop('inapplicable', 'background.js registers no runtime message listener');

  const drawing = act('draw');
  const first = await nextRequest();
  const key = records.session['tab:1']?.keys?.[0];
  if (typeof key !== 'string') await stop('inapplicable', 'visualizeSelection made no card for the tab');
  const pageBeforeFirst = await snapshot('before-first-reply', 'draw one card; the helper call is out', key);
  first({ ok: false, status: 500, body: { error: 'controlled failure after spending', usage } });
  await drawing;
  await settle();
  const pageAfterFirst = await snapshot('after-failed-draw', 'the call fails after spending $1', key);

  await act('send', { message: { type: 'card:retry', key } });
  const second = await nextRequest();
  // Cards and unassigned spend the side panel showed just before Dismiss.
  const chargedBeforeDismiss = await snapshot('after-retry-request', 'Retry; a second call is out', key);
  await act('send', { message: { type: 'card:dismiss', key } });
  await settle();
  const pageBeforeLate = await snapshot('after-dismiss', 'Dismiss while the call is out', key);
  const dismissed = !records.session[`card:${key}`];

  second({ ok: true, status: 200, body: { result: { title: 'Returned', mermaid: 'flowchart TD\n A["Returned"]' }, usage } });
  await settle();
  const pageTotalAfter = await snapshot('after-late-return', 'the late call returns with $1 of usage', key);
  const ledgerPaid = frames.at(-1).ledgerPaid;
  const helperReported = 2 * usage.usd;
  // Each paid call is carried by a card or the unassigned total, so the page total rises by its usage
  // when it lands. Only that call lands between the two frames. A page that never moves can't carry
  // the spend, whatever it shows.
  const shownOnLanding = [pageAfterFirst - pageBeforeFirst, pageTotalAfter - pageBeforeLate];
  if (shownOnLanding.some((d) => d > usage.usd)) {
    await stop('error', `the side panel’s page total rose by ${shownOnLanding.join(' and ')} as each $${usage.usd} call landed, more than was paid, so docviz can’t tell which spend it shows`);
  }
  const unattributed = shownOnLanding.reduce((t, d) => t + (usage.usd - d), 0);
  const observed = { helperReported, ledgerPaid, chargedBeforeDismiss, dismissed, pageTotalAfter, shownOnLanding, unattributed, cardRecordAfter: records.session[`card:${key}`] ? 'present' : 'absent', frames };
  const holds = ledgerPaid === helperReported && unattributed === 0;
  print({ outcome: holds ? 'holds' : 'fails', observed,
    detail: holds ? 'every reported call is in the ledger and on a card or the page total'
      : `ledger ${ledgerPaid} for ${helperReported} reported; cards and page showed ${chargedBeforeDismiss} before Dismiss and show ${pageTotalAfter} after the late return; ${unattributed} unattributed (the page rose by ${shownOnLanding.join(' and ')} as each call landed)` });
} catch (e) {
  await stop('error', said(e?.message || e));
}
