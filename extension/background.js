// Service worker: triggers, the helper client, the cache, and card state.
//
// Card records live in chrome.storage.session under `card:<key>`; per-tab
// state (progress + card keys) under `tab:<tabId>`. Cards and the side panel
// read them and listen for `card:updated` / `tab:updated` broadcasts.
import { getSettings, setSettings, DEPTHS, rollSpend, spendToday, money } from './settings.js';

const BATCH_SECTIONS = 5;
const BATCH_CHARS = 14_000;
const CACHE_MAX = 150;

// ---------- triggers ----------

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'dv-selection', title: 'Visualize selection with docviz', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'dv-page', title: 'Break down this page with docviz', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'dv-panel', title: 'Open docviz side panel', contexts: ['action'] });
  });
  const { onboarded, chip } = await getSettings();
  if (reason === 'install' && !onboarded) chrome.runtime.openOptionsPage();
  if (chip) await syncChip(true);
});

chrome.action.onClicked.addListener((tab) => {
  openPanel(tab);
  breakdown(tab).catch(console.warn);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'breakdown') { openPanel(tab); breakdown(tab).catch(console.warn); }
  if (command === 'visualize-selection') visualizeSelection(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'dv-selection') visualizeSelection(tab, { text: info.selectionText });
  if (info.menuItemId === 'dv-page') { openPanel(tab); breakdown(tab).catch(console.warn); }
  if (info.menuItemId === 'dv-panel') openPanel(tab);
});

// Must run inside the user gesture, so no awaits before it.
function openPanel(tab) {
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
}

// ---------- helper client ----------

let pending = 0;
let keepAlive = null;

// A long CLI call can outlast the service worker's idle timer; poking an
// extension API resets it while work is in flight.
function hold() {
  if (pending++ === 0) keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000);
}
function release() {
  if (--pending === 0) clearInterval(keepAlive);
}

async function callHelper(route, body) {
  const s = await getSettings();
  if (s.budget > 0 && spendToday(s.spend) >= s.budget) {
    throw new Error(`Today’s ${money(s.budget)} docviz budget is used up (${money(spendToday(s.spend))}). Raise it in settings to keep going.`);
  }
  hold();
  try {
    let res;
    try {
      res = await fetch(`${s.helperUrl}/v1/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-docviz-token': s.token },
        body: JSON.stringify({ provider: s.provider, model: s.model || undefined, prefs: s.prefs, ...body }),
      });
    } catch {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#c0392b' });
      throw new Error('Helper offline — run `docviz serve` in a terminal.');
    }
    chrome.action.setBadgeText({ text: '' });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('Pairing code rejected — paste the code `docviz` printed into docviz settings.');
    if (!res.ok) throw new Error(data.error || `Helper error ${res.status}`);
    await record(data.usage);
    return { result: data.result, usage: data.usage };
  } finally {
    release();
  }
}

// Every call is charged to the ledger as it returns — nothing is spent silently.
let ledger = Promise.resolve();
function record(usage) {
  if (!usage) return ledger;
  ledger = ledger.then(async () => {
    const { spend } = await chrome.storage.local.get('spend');
    await setSettings({ spend: rollSpend(spend, usage.usd) });
    broadcast({ type: 'spend:updated' });
  });
  return ledger;
}

// A card's cost is the sum of every call made for it; a breakdown batch is
// split evenly across the cards it produced.
function addCost(cost, what, usage, share = 1) {
  const c = cost || { usd: 0, estimated: false, items: [] };
  if (!usage) return c;
  const usd = usage.usd / share;
  return {
    usd: c.usd + usd,
    estimated: c.estimated || usage.estimated,
    items: [...c.items, { what: share > 1 ? `${what} (1/${share} of batch)` : what, usd, estimated: usage.estimated, provider: usage.provider, model: usage.model, tokens: usage.inputTokens + usage.outputTokens }],
  };
}

let caps = null;

export async function health() {
  const s = await getSettings();
  try {
    const res = await fetch(`${s.helperUrl}/v1/health`, { headers: { 'x-docviz-token': s.token } });
    const h = await res.json();
    if (h.paired) caps = h;
    return h;
  } catch {
    return { ok: false };
  }
}

// ---------- state ----------

const session = chrome.storage.session;

async function getTab(tabId) {
  return (await session.get(`tab:${tabId}`))[`tab:${tabId}`] || { keys: [], status: { phase: 'idle' } };
}
async function putTab(tabId, state) {
  await session.set({ [`tab:${tabId}`]: state });
  broadcast({ type: 'tab:updated', tabId });
}
async function getCard(key) {
  return (await session.get(`card:${key}`))[`card:${key}`];
}
async function putCard(rec) {
  await session.set({ [`card:${rec.key}`]: rec });
  broadcast({ type: 'card:updated', key: rec.key, tabId: rec.tabId });
}

async function forgetTab(tabId) {
  const old = await getTab(tabId);
  await session.remove([`tab:${tabId}`, ...old.keys.map((k) => `card:${k}`)]);
}

// Anchor clicks change the URL too; only a real navigation drops the cards.
const sansHash = (u) => (u || '').split('#')[0];
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url) return;
  const state = await getTab(tabId);
  if (state.url && sansHash(state.url) !== sansHash(info.url)) {
    await forgetTab(tabId);
    broadcast({ type: 'tab:updated', tabId });
  }
});
chrome.tabs.onRemoved.addListener((tabId) => { forgetTab(tabId); });

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

const newKey = () => crypto.randomUUID().slice(0, 8);

async function sha(value) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function cacheGet(hash) {
  return (await chrome.storage.local.get(`c:${hash}`))[`c:${hash}`]?.cards;
}
async function cachePut(hash, cards) {
  await chrome.storage.local.set({ [`c:${hash}`]: { t: Date.now(), cards } });
  const all = await chrome.storage.local.get(null);
  const entries = Object.entries(all).filter(([k]) => k.startsWith('c:')).sort((a, b) => b[1].t - a[1].t);
  if (entries.length > CACHE_MAX) await chrome.storage.local.remove(entries.slice(CACHE_MAX).map(([k]) => k));
}

// ---------- page plumbing ----------

async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

async function toTab(tabId, msg) {
  try { return await chrome.tabs.sendMessage(tabId, msg); } catch { return undefined; }
}

function toast(tabId, text, tone = 'info') {
  return toTab(tabId, { type: 'toast', text, tone });
}

function batchSections(sections) {
  const batches = [];
  let cur = [];
  let chars = 0;
  for (const s of sections) {
    if (cur.length && (cur.length >= BATCH_SECTIONS || chars + s.text.length > BATCH_CHARS)) {
      batches.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(s);
    chars += s.text.length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

// ---------- break down this page ----------

export async function breakdown(tab) {
  const tabId = tab.id;
  try {
    await inject(tabId);
  } catch {
    // No activeTab grant (e.g. the side panel button on a tab never invoked) or a chrome:// page.
    throw new Error('docviz can’t access this tab — click the toolbar icon or press Alt+Shift+D on the page.');
  }
  const extracted = await toTab(tabId, { type: 'extract' });
  if (!extracted?.sections?.length) return toast(tabId, 'No readable sections found — try selecting text instead.', 'error');

  const { page, sections } = extracted;
  const s = await getSettings();
  await toTab(tabId, { type: 'clear' });
  await forgetTab(tabId);
  const state = { url: page.url, title: page.title, keys: [], status: { phase: 'working', done: 0, total: sections.length } };
  await putTab(tabId, state);
  await toast(tabId, `docviz · reading ${sections.length} sections…`);

  const bySection = new Map(sections.map((x) => [x.id, x]));
  const place = async (spec, cost) => {
    const section = bySection.get(spec.sectionId);
    if (!section) return;
    const key = newKey();
    await putCard({ key, tabId, page, section, spec, cost, status: 'ready', view: 'diagram' });
    state.keys.push(key);
    await toTab(tabId, { type: 'insert', key, sectionId: spec.sectionId });
    if (s.prefs.pictures === 'auto') picture(key);
  };

  const hash = await sha([page.url, sections.map((x) => x.text), s.prefs, s.provider, s.model]);
  const cached = await cacheGet(hash);
  if (cached) {
    for (const spec of cached) await place(spec, { usd: 0, estimated: false, items: [{ what: 'cached — free', usd: 0 }] });
    state.status = { phase: 'done', done: sections.length, total: sections.length, cached: true };
    await putTab(tabId, state);
    return toast(tabId, `docviz · ${state.keys.length} cards (cached)`, 'done');
  }

  const all = [];
  const errors = [];
  await Promise.all(batchSections(sections).map(async (batch) => {
    try {
      const { result, usage } = await callHelper('cards', { page, sections: batch });
      const cards = (result.cards || []).filter((c) => bySection.has(c.sectionId));
      // A batch that found nothing to draw still cost something; the page total keeps it.
      if (!cards.length) state.unassigned = (state.unassigned || 0) + usage.usd;
      for (const spec of cards) {
        all.push(spec);
        await place(spec, addCost(null, 'breakdown', usage, cards.length));
      }
    } catch (e) {
      errors.push(e.message);
    }
    state.status.done += batch.length;
    await putTab(tabId, state);
    const spent = (await Promise.all(state.keys.map(getCard))).reduce((t, c) => t + (c?.cost?.usd || 0), state.unassigned || 0);
    await toast(tabId, `docviz · ${state.status.done}/${sections.length} sections · ${state.keys.length} cards · ${money(spent)} so far`);
  }));

  state.status.phase = errors.length && !all.length ? 'error' : 'done';
  state.status.error = errors[0];
  await putTab(tabId, state);
  if (!errors.length) await cachePut(hash, all);
  if (errors.length && !all.length) return toast(tabId, errors[0], 'error');
  if (!all.length) return toast(tabId, 'Nothing here behaves — switch coverage to “every section” to diagram anyway.', 'done');
  toast(tabId, `docviz · ${all.length} cards${errors.length ? ` · ${errors.length} batch failed` : ''}`, 'done');
}

// ---------- visualize selection ----------

export async function visualizeSelection(tab, given = {}) {
  const tabId = tab.id;
  try {
    await inject(tabId);
  } catch {
    return;
  }
  const sel = (await toTab(tabId, { type: 'selection' })) || {};
  const text = (given.text || sel.text || '').trim();
  if (!text) return toast(tabId, 'Select some text or code first.', 'error');

  const key = newKey();
  const page = { url: tab.url, title: tab.title };
  const section = { id: 'sel', heading: 'Selection', text: text.slice(0, 12_000) };
  await putCard({ key, tabId, page, section, spec: null, status: 'loading', loadingText: 'Painting the picture…', view: 'diagram', popover: true });
  await toTab(tabId, { type: 'popover', key, rect: given.rect || sel.rect });
  const state = await getTab(tabId);
  state.keys.push(key);
  await putTab(tabId, state);

  await generate(key, {});
}

// ---------- per-card actions ----------

async function generate(key, adjust) {
  const rec = await getCard(key);
  try {
    const { result: spec, usage } = await callHelper('card', { page: rec.page, section: rec.section, adjust, previous: rec.spec });
    spec.sectionId = rec.section.id;
    const what = adjust?.direction === 'simpler' ? 'simpler' : adjust?.direction === 'more' ? 'more detail' : adjust?.kind ? `as ${adjust.kind}` : 'diagram';
    const cur = await getCard(key);
    // A new diagram makes the old picture stale.
    await putCard({ ...cur, spec, cost: addCost(cur.cost, what, usage), status: 'ready', error: null, view: 'diagram', picture: null });
    if (rec.picture || (await getSettings()).prefs.pictures === 'auto') picture(key);
  } catch (e) {
    await putCard({ ...(await getCard(key)), status: rec.spec ? 'ready' : 'error', error: e.message });
  }
}

// Simpler / More detail also move the saved depth one step — visibly, with undo.
async function learn(key, direction) {
  const s = await getSettings();
  const i = DEPTHS.indexOf(s.prefs.depth);
  const j = Math.max(0, Math.min(DEPTHS.length - 1, i + (direction === 'more' ? 1 : -1)));
  if (i === j) return null;
  const change = { key, field: 'depth', from: DEPTHS[i], to: DEPTHS[j], at: Date.now() };
  await setSettings({ prefs: { ...s.prefs, depth: DEPTHS[j] }, lastPrefChange: change });
  broadcast({ type: 'prefs:updated' });
  return change;
}

async function adjust(key, { direction, kind }) {
  const rec = await getCard(key);
  await putCard({ ...rec, status: 'loading', loadingText: direction === 'simpler' ? 'Simplifying…' : direction === 'more' ? 'Adding detail…' : `Redrawing as ${kind}…` });
  if (direction) await learn(key, direction);
  await generate(key, { direction, kind });
}

async function explore(key) {
  const rec = await getCard(key);
  if (rec.explore) return putCard({ ...rec, view: 'explore' });
  await putCard({ ...rec, status: 'loading', loadingText: 'Reading the source and building a simulation… (1–3 min)' });
  try {
    const { result, usage } = await callHelper('explore', { page: rec.page, section: rec.section, card: rec.spec });
    const cur = await getCard(key);
    await putCard({ ...cur, explore: result, cost: addCost(cur.cost, 'simulation', usage), view: 'explore', status: 'ready', error: null });
  } catch (e) {
    await putCard({ ...(await getCard(key)), status: 'ready', error: e.message });
  }
}

// Pictures run beside the diagram (own status), so the card stays usable while Codex paints.
async function picture(key) {
  if (!caps) await health();
  if (!caps?.pictures) return;
  const rec = await getCard(key);
  if (!rec?.spec || rec.picture?.status === 'loading') return;
  // Same card text → same picture; never pay twice for it.
  const pkey = `p:${await sha([rec.spec.title, rec.spec.picture, (await getSettings()).prefs.depth === 'eli5'])}`;
  const known = (await chrome.storage.local.get(pkey))[pkey];
  if (known) {
    return putCard({ ...rec, picture: { status: 'ready', imageId: known }, cost: addCost(rec.cost, 'picture (cached — free)', { usd: 0, estimated: false, inputTokens: 0, outputTokens: 0 }) });
  }
  await putCard({ ...rec, picture: { status: 'loading' } });
  try {
    const { result, usage } = await callHelper('illustrate', { card: rec.spec });
    await chrome.storage.local.set({ [pkey]: result.imageId });
    const cur = await getCard(key);
    if (cur) await putCard({ ...cur, picture: { status: 'ready', imageId: result.imageId }, cost: addCost(cur.cost, 'picture', usage) });
  } catch (e) {
    const cur = await getCard(key);
    if (cur) await putCard({ ...cur, picture: { status: 'error', error: e.message } });
  }
}

async function undoPref() {
  const s = await getSettings();
  const c = s.lastPrefChange;
  if (!c) return;
  await setSettings({ prefs: { ...s.prefs, [c.field]: c.from }, lastPrefChange: null });
  broadcast({ type: 'prefs:updated' });
}

async function dismiss(key) {
  const rec = await getCard(key);
  if (!rec) return;
  await toTab(rec.tabId, { type: 'remove', key });
  const state = await getTab(rec.tabId);
  state.keys = state.keys.filter((k) => k !== key);
  await putTab(rec.tabId, state);
  await session.remove(`card:${key}`);
}

// ---------- optional highlight chip ----------

export async function syncChip(on) {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: ['dv-chip'] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: ['dv-chip'] });
  if (on && (await chrome.permissions.contains({ origins: ['<all_urls>'] }))) {
    await chrome.scripting.registerContentScripts([{ id: 'dv-chip', js: ['content.js'], matches: ['<all_urls>'], runAt: 'document_idle' }]);
  }
}

// ---------- messages from content script, cards, side panel, options ----------

const handlers = {
  'card:get': async ({ key }) => {
    if (!caps) await health();
    return { rec: await getCard(key), settings: await getSettings(), caps };
  },
  'card:picture': ({ key }) => { picture(key); },
  'card:adjust': ({ key, direction, kind }) => { adjust(key, { direction, kind }); },
  'card:explore': ({ key }) => { explore(key); },
  'card:view': async ({ key, view }) => putCard({ ...(await getCard(key)), view }),
  'card:retry': ({ key }) => { generate(key, {}); },
  'card:repair': async ({ key, mermaid, error }) => {
    const { result, usage } = await callHelper('repair', { mermaid, error });
    const rec = await getCard(key);
    if (rec) await putCard({ ...rec, cost: addCost(rec.cost, 'syntax repair', usage) });
    return result.mermaid;
  },
  'card:fix': async ({ key, mermaid }) => {
    const rec = await getCard(key);
    await putCard({ ...rec, spec: { ...rec.spec, mermaid } });
  },
  'card:dismiss': ({ key }) => dismiss(key),
  'prefs:undo': () => undoPref(),
  'panel:get': async ({ tabId }) => {
    const state = await getTab(tabId);
    const cards = (await Promise.all(state.keys.map(getCard))).filter(Boolean);
    return { state, cards };
  },
  'panel:breakdown': async ({ tabId }) => breakdown(await chrome.tabs.get(tabId)),
  'panel:scroll': async ({ key }) => {
    const rec = await getCard(key);
    if (rec) await toTab(rec.tabId, { type: 'scroll', key });
  },
  'health': () => health(),
  'chip:sync': ({ on }) => syncChip(on),
  'chip:visualize': (msg, sender) => { visualizeSelection(sender.tab, { text: msg.text, rect: msg.rect }); },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  Promise.resolve(h(msg, sender))
    .then((value) => sendResponse({ ok: true, value }))
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true;
});

// Test/automation hook.
globalThis.docviz = { breakdown, visualizeSelection, health };
