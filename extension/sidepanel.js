import { getSettings, spendToday, money } from './settings.js';
import { renderPrefs } from './prefs-form.js';

const $ = (id) => document.getElementById(id);
let tabId = null;

async function send(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res?.ok) throw new Error(res?.error || 'docviz is not responding');
  return res.value;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
}

async function refreshHealth() {
  const h = await send('health').catch(() => ({ ok: false }));
  $('dot').className = `dot ${h.ok && h.paired ? 'on' : 'off'}`;
  const off = $('offline');
  if (!h.ok) off.textContent = 'Helper offline — run `docviz serve` (or /docviz in Claude Code).';
  else if (!h.paired) off.textContent = 'Helper running but not paired — paste its code in Settings.';
  off.hidden = h.ok && h.paired;
  $('dot').title = h.ok ? `Helper: ${Object.entries(h.providers || {}).filter(([, v]) => v).map(([k]) => k).join(', ')}` : 'Helper offline';
}

async function refreshCards() {
  if (tabId == null) return;
  const { state, cards } = await send('panel:get', { tabId });
  const st = state.status || {};
  const progress = $('progress');
  progress.replaceChildren();
  if (st.phase === 'working') {
    const spin = document.createElement('div');
    spin.className = 'spinner';
    progress.append(spin, `Reading ${st.done}/${st.total} sections · ${cards.length} cards`);
  } else if (st.phase === 'error') {
    progress.append(st.error || 'Something went wrong');
  } else if (st.phase === 'done') {
    progress.append(`${cards.length} cards${st.cached ? ' (cached)' : ''}`);
  }

  const list = $('cards');
  list.replaceChildren(...cards.map((c) => {
    const li = document.createElement('li');
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = c.view === 'explore' ? 'sim' : c.spec?.kind || '…';
    const t = document.createElement('span');
    t.className = 't';
    const b = document.createElement('b');
    b.textContent = c.spec?.title || c.section.heading;
    const small = document.createElement('small');
    small.textContent = c.status === 'loading' ? 'working…' : c.popover ? 'selection' : c.section.heading;
    t.append(b, small);
    const cost = document.createElement('span');
    cost.className = 'c';
    cost.textContent = c.cost ? money(c.cost.usd, c.cost.estimated) : '';
    li.append(pill, t, cost);
    li.onclick = () => send('panel:scroll', { key: c.key });
    return li;
  }));
  $('empty').hidden = cards.length > 0;
  const page = cards.reduce((t, c) => t + (c.cost?.usd || 0), state.unassigned || 0);
  $('sp-page').textContent = money(page, cards.some((c) => c.cost?.estimated));
}

async function refreshSpend() {
  const s = await getSettings();
  const today = spendToday(s.spend);
  $('sp-today').textContent = money(today);
  $('sp-total').textContent = money(s.spend?.total || 0);
  const bar = $('sp-bar');
  bar.hidden = !(s.budget > 0);
  bar.classList.toggle('over', today >= s.budget);
  bar.firstElementChild.style.width = `${Math.min(100, (today / s.budget) * 100)}%`;
  $('sp-budget').textContent = s.budget > 0
    ? `${money(today)} of your ${money(s.budget)} daily budget${today >= s.budget ? ' — new cards are paused until tomorrow or you raise it in Settings.' : ''}`
    : 'No daily budget set — add one in Settings.';
}

async function refreshPrefs() {
  const s = await getSettings();
  renderPrefs($('prefs'), s.prefs);
  const box = $('change');
  const c = s.lastPrefChange;
  box.hidden = !c;
  if (c) {
    const undo = document.createElement('button');
    undo.textContent = 'Undo';
    undo.onclick = () => send('prefs:undo');
    box.replaceChildren(`Learned: ${c.field} ${c.from} → ${c.to}`, undo);
  }
}

$('go').onclick = async () => {
  await activeTab();
  if (tabId != null) send('panel:breakdown', { tabId }).catch((e) => { $('progress').textContent = e.message; });
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'tab:updated' && msg.tabId === tabId) refreshCards();
  if (msg.type === 'card:updated' && msg.tabId === tabId) refreshCards();
  if (msg.type === 'prefs:updated') refreshPrefs();
  if (msg.type === 'spend:updated') refreshSpend();
});
chrome.tabs.onActivated.addListener(async () => { await activeTab(); refreshCards(); });
chrome.tabs.onUpdated.addListener((id, info) => { if (id === tabId && info.status === 'complete') refreshCards(); });

await activeTab();
refreshHealth();
refreshCards();
refreshPrefs();
refreshSpend();
setInterval(refreshHealth, 15_000);
