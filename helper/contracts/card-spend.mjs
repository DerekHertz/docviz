// The card-spend harness, run by helper/contracts.js in a child process over a copy of the target's
// committed extension/ files. It drives the target's own background.js through its exported
// visualizeSelection and its registered Retry and Dismiss handlers, with chrome.* storage and the
// helper's HTTP replies as controlled boundaries, then evaluates the side panel's own page-total
// expression. It prints one JSON object: { outcome, observed, path, scope, detail }.
// Ported from historical-review/grounding/replay-pr1-dismiss-gap.mjs.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2]);
const PATH = ['draw one card', 'call fails after spending', 'retry', 'dismiss while the call is out', 'helper returns usage', 'compare ledger with card and page totals'];
const SCOPE = 'Target’s committed extension code in a Node child process: its exported visualizeSelection and registered card:retry / card:dismiss handlers, with chrome.* storage and helper replies as controlled fixtures. The side panel’s page-total expression is evaluated on the captured state; no browser, DOM or provider call. One scenario, not every path.';
const print = (o) => process.stdout.write(JSON.stringify({ path: PATH, scope: SCOPE, ...o }));
const inapplicable = (detail) => { print({ outcome: 'inapplicable', observed: {}, detail }); process.exit(0); };

const backgroundFile = join(root, 'extension/background.js');
const sidepanelFile = join(root, 'extension/sidepanel.js');
if (!existsSync(backgroundFile)) inapplicable('extension/background.js is absent');
const pageExpr = existsSync(sidepanelFile) && readFileSync(sidepanelFile, 'utf8').match(/const page = (.*);/)?.[1];
if (!pageExpr) inapplicable('extension/sidepanel.js has no `const page = …;` page total');

const records = { local: { budget: 100, prefs: { depth: 'mechanism', pictures: 'off' }, spend: { day: new Date().toLocaleDateString('en-CA'), today: 0, total: 0, calls: 0 } }, session: {} };
const storage = (area) => ({
  async get(keys) {
    if (keys === null || keys === undefined) return structuredClone(records[area]);
    if (typeof keys === 'string') keys = [keys];
    if (!Array.isArray(keys)) keys = Object.keys(keys);
    return Object.fromEntries(keys.filter((k) => Object.hasOwn(records[area], k)).map((k) => [k, structuredClone(records[area][k])]));
  },
  async set(values) { Object.assign(records[area], structuredClone(values)); },
  async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete records[area][k]; },
});
let listener;
const replies = [];
const waiters = [];
const noop = () => ({ addListener() {} });
const nextRequest = () => new Promise((ok, fail) => {
  if (replies.length) return ok(replies.shift());
  waiters.push(ok);
  setTimeout(() => fail(new Error('no helper call was made')), 3000).unref();
});
globalThis.chrome = {
  storage: { local: storage('local'), session: storage('session') },
  runtime: { onInstalled: noop(), onStartup: noop(), onMessage: { addListener(fn) { listener = fn; } }, async sendMessage() {}, getPlatformInfo() {} },
  action: { onClicked: noop(), setBadgeText() {}, setBadgeBackgroundColor() {} },
  commands: { onCommand: noop() }, contextMenus: { onClicked: noop(), create() {}, removeAll(cb) { cb?.(); } },
  scripting: { async executeScript() {} }, sidePanel: { async open() {}, async setPanelBehavior() {} },
  tabs: { onUpdated: noop(), onRemoved: noop(), async sendMessage() {} },
};
globalThis.setInterval = () => 1;
globalThis.clearInterval = () => {};
globalThis.fetch = async () => new Promise((reply) => (waiters.length ? waiters.shift()(reply) : replies.push(reply)));
const usage = { usd: 1, estimated: false, provider: 'controlled-helper', inputTokens: 10, outputTokens: 10 };
const settle = () => new Promise((r) => setTimeout(r, 50));
const cardsOf = (tab) => (records.session[`tab:${tab}`]?.keys || []).map((k) => records.session[`card:${k}`]).filter(Boolean);
const costOf = (card) => card?.cost?.usd || 0;

try {
  const background = await import(pathToFileURL(backgroundFile).href);
  if (typeof background.visualizeSelection !== 'function') inapplicable('background.js exports no visualizeSelection');
  if (!listener) inapplicable('background.js registers no runtime message listener');
  const send = (message) => new Promise((done) => { if (listener(message, {}, done) !== true) setTimeout(done, 0); });

  const drawing = background.visualizeSelection({ id: 1, url: 'https://example.test', title: 'test' }, { text: 'fixture' });
  const first = await nextRequest();
  const key = records.session['tab:1']?.keys?.[0];
  if (!key) inapplicable('visualizeSelection made no card for the tab');
  first({ ok: false, status: 500, json: async () => ({ error: 'controlled failure after spending', usage }) });
  await drawing;
  await settle();

  await send({ type: 'card:retry', key });
  const second = await nextRequest();
  const chargedBeforeDismiss = cardsOf(1).reduce((t, c) => t + costOf(c), 0) + (records.session['tab:1']?.unassigned || 0);
  await send({ type: 'card:dismiss', key });
  await settle();
  const dismissed = !records.session[`card:${key}`];

  second({ ok: true, status: 200, json: async () => ({ result: { title: 'Returned', mermaid: 'flowchart TD\n A["Returned"]' }, usage }) });
  await settle();

  const state = records.session['tab:1'] || { keys: [] };
  const pageTotalAfter = Function('cards', 'state', `return (${pageExpr});`)(cardsOf(1), state);
  const ledgerPaid = records.local.spend.total;
  const helperReported = 2 * usage.usd;
  const unattributed = helperReported - chargedBeforeDismiss - pageTotalAfter;
  const observed = { helperReported, ledgerPaid, chargedBeforeDismiss, dismissed, pageTotalAfter, unattributed, cardRecordAfter: records.session[`card:${key}`] ? 'present' : 'absent' };
  const holds = ledgerPaid === helperReported && unattributed === 0;
  print({ outcome: holds ? 'holds' : 'fails', observed,
    detail: holds ? 'every reported call is in the ledger and on a card or the page total'
      : `ledger ${ledgerPaid} for ${helperReported} reported; cards and page show ${chargedBeforeDismiss + pageTotalAfter}; ${unattributed} unattributed` });
  process.exit(0);
} catch (e) {
  print({ outcome: 'error', observed: {}, detail: String(e?.message || e).slice(0, 400) });
  process.exit(0);
}
