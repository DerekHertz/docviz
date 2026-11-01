// A card dismissed while one of its calls is in flight: the call still spends,
// so its cost must land on the page total. Runs the real service worker
// against a fake chrome.* and a fetch whose replies the test releases.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const area = () => {
  const data = {};
  return {
    data,
    async get(keys) {
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(patch) { Object.assign(data, structuredClone(patch)); },
    async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
  };
};
const event = () => {
  const fns = [];
  return { fns, addListener: (f) => fns.push(f) };
};

const local = area();
local.data.budget = 0; // the cases together spend past the default cap
const session = area();
const onMessage = event();
const onTabUpdated = event();
globalThis.chrome = {
  storage: { local, session },
  runtime: { onInstalled: event(), onMessage, sendMessage: async () => {}, getPlatformInfo: () => {}, openOptionsPage: () => {} },
  action: { onClicked: event(), setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
  commands: { onCommand: event() },
  contextMenus: { onClicked: event(), removeAll: () => {}, create: () => {} },
  tabs: { onUpdated: onTabUpdated, onRemoved: event(), sendMessage: async () => {} },
  scripting: { executeScript: async () => {} },
  sidePanel: { open: async () => {} },
};

// Each helper call waits until the test answers it.
const calls = [];
globalThis.fetch = async (url) => {
  const route = String(url).split('/v1/')[1];
  if (route === 'health') return { status: 200, json: async () => ({ ok: true, paired: true, pictures: true }) };
  if (route.startsWith('image/')) return { status: 404 };
  return new Promise((resolve) => calls.push({ route, reply: (status, body) => resolve({ ok: status < 400, status, json: async () => body }) }));
};

await import('../extension/background.js');

const send = (msg) => new Promise((resolve) => onMessage.fns[0](msg, {}, resolve));
const tick = () => new Promise((r) => setImmediate(r));
async function nextCall(route) {
  for (let i = 0; i < 200; i++) {
    const at = calls.findIndex((c) => c.route === route);
    if (at >= 0) return calls.splice(at, 1)[0];
    await tick();
  }
  throw new Error(`no ${route} call`);
}
const settle = async () => { for (let i = 0; i < 50; i++) await tick(); };
const usage = (usd) => ({ usd, estimated: false, inputTokens: 10, outputTokens: 5 });

let n = 0;
async function seed() {
  const tabId = ++n;
  const key = `k${tabId}`;
  const page = { url: `https://example.test/${tabId}`, title: 'T' };
  const spec = { sectionId: 's', title: 'T', mermaid: 'flowchart TD\nA-->B', picture: 'brief' };
  const cost = { usd: 0.1, estimated: false, items: [{ what: 'diagram', usd: 0.1 }] };
  await session.set({
    [`tab:${tabId}`]: { url: page.url, keys: [key], status: { phase: 'done' } },
    [`card:${key}`]: { key, tabId, page, section: { id: 's', heading: 'S', text: 'x' }, spec, cost, status: 'ready', view: 'diagram' },
  });
  return { tabId, key };
}
const tab = (tabId) => session.data[`tab:${tabId}`];

const cases = [
  { name: 'Retry (generate) succeeds', route: 'card', start: (key) => send({ type: 'card:retry', key }), status: 200, body: { result: { title: 'T', mermaid: 'x' } } },
  { name: 'Simpler (generate) fails after spending', route: 'card', start: (key) => send({ type: 'card:adjust', key, direction: 'simpler' }), status: 500, body: { error: 'bad output' } },
  { name: 'explore succeeds', route: 'explore', start: (key) => send({ type: 'card:explore', key }), status: 200, body: { result: { html: '<p>' } } },
  { name: 'explore fails after spending', route: 'explore', start: (key) => send({ type: 'card:explore', key }), status: 500, body: { error: 'no' } },
  { name: 'picture succeeds', route: 'illustrate', start: (key) => send({ type: 'card:picture', key }), status: 200, body: { result: { imageId: 'img' } } },
  { name: 'picture fails after spending', route: 'illustrate', start: (key) => send({ type: 'card:picture', key }), status: 500, body: { error: 'no picture' } },
  { name: 'syntax repair succeeds', route: 'repair', start: (key) => { send({ type: 'card:repair', key, mermaid: 'x', error: 'e' }); }, status: 200, body: { result: { mermaid: 'y' } } },
  { name: 'syntax repair fails after spending', route: 'repair', start: (key) => { send({ type: 'card:repair', key, mermaid: 'x', error: 'e' }); }, status: 500, body: { error: 'no' } },
];

for (const c of cases) {
  test(`dismissed mid-call: ${c.name} → cost goes to the page total`, async () => {
    const { tabId, key } = await seed();
    c.start(key);
    const call = await nextCall(c.route);
    await send({ type: 'card:dismiss', key });
    assert.equal(session.data[`card:${key}`], undefined);
    call.reply(c.status, { ...c.body, usage: usage(0.25) });
    await settle();
    assert.equal(session.data[`card:${key}`], undefined, 'a dismissed card stays dismissed');
    assert.ok(Math.abs((tab(tabId).unassigned || 0) - 0.25) < 1e-9, `page total keeps the $0.25, got ${tab(tabId).unassigned}`);
    assert.deepEqual(tab(tabId).keys, []);
  });
}

test('a card still showing is charged itself, not the page total', async () => {
  const { tabId, key } = await seed();
  send({ type: 'card:retry', key });
  (await nextCall('card')).reply(200, { result: { title: 'T', mermaid: 'x' }, usage: usage(0.25) });
  await settle();
  assert.ok(Math.abs(session.data[`card:${key}`].cost.usd - 0.35) < 1e-9);
  assert.equal(tab(tabId).unassigned, undefined);
});

test('the page navigated away mid-call: the new page is not charged', async () => {
  const { tabId, key } = await seed();
  send({ type: 'card:retry', key });
  const call = await nextCall('card');
  for (const f of onTabUpdated.fns) await f(tabId, { url: 'https://example.test/other' });
  call.reply(200, { result: { title: 'T', mermaid: 'x' }, usage: usage(0.25) });
  await settle();
  assert.equal(tab(tabId), undefined);
  assert.equal(session.data[`card:${key}`], undefined);
});
