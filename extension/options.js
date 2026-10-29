import { getSettings, setSettings, spendToday, money } from './settings.js';
import { renderPrefs, save } from './prefs-form.js';

// Calibration: the same idea at every depth. Static, so learning costs nothing.
const SAMPLES = [
  ['eli5', 'Like I’m 5', '📬 Think of a mailbox. Letters keep arriving, and the mail carrier only comes once nobody has dropped one in for a little while. In code: debounce(fn, wait) runs fn once, wait ms after the last call.'],
  ['concept', 'Concept', 'debounce(fn, wait) collapses a burst of calls into a single call of fn, made after the burst goes quiet for wait ms.'],
  ['mechanism', 'Mechanism', 'Each call clears the pending timer and starts a new setTimeout(wait). Only when wait ms pass with no new call does fn run — with the last call’s arguments.'],
  ['implementation', 'Implementation', 'Tracks lastCallTime and timerId. leading invokes on the first call; trailingEdge fires at lastCallTime + wait; maxWait forces a call via remainingWait(); cancel() clears timerId; flush() invokes immediately.'],
];

const $ = (id) => document.getElementById(id);
const s = await getSettings();

$('code').value = s.token;
$('url').value = s.helperUrl;
$('provider').value = s.provider;
$('model').value = s.model;
$('chip').checked = s.chip;
renderPrefs($('prefs'), s.prefs);
$('budget').value = s.budget;
$('spent').textContent = `Spent so far: ${money(spendToday(s.spend))} today · ${money(s.spend?.total || 0)} all time.`;
$('budget').onchange = async () => {
  const v = Math.max(0, Number.parseFloat($('budget').value) || 0);
  $('budget').value = v;
  await setSettings({ budget: v });
};

function renderCalib(depth) {
  $('calib').replaceChildren(...SAMPLES.map(([value, label, text]) => {
    const b = document.createElement('button');
    b.setAttribute('aria-pressed', String(depth === value));
    const h = document.createElement('b');
    h.textContent = label;
    b.append(h, text);
    b.onclick = async () => {
      await save({ depth: value });
      renderCalib(value);
      renderPrefs($('prefs'), (await getSettings()).prefs);
    };
    return b;
  }));
}
renderCalib(s.prefs.depth);
// Storage, not runtime messages: this page's own dropdowns change depth too.
chrome.storage.onChanged.addListener((changes) => {
  if (changes.prefs) renderCalib(changes.prefs.newValue.depth);
});

async function saveConnection() {
  await setSettings({
    token: $('code').value.trim().toUpperCase(),
    helperUrl: $('url').value.trim().replace(/\/+$/, '') || 'http://127.0.0.1:47823',
    provider: $('provider').value,
    model: $('model').value.trim(),
  });
}

async function test() {
  await saveConnection();
  const status = $('status');
  status.className = '';
  status.textContent = 'Checking…';
  const res = await chrome.runtime.sendMessage({ type: 'health' });
  const h = res?.value || {};
  if (!h.ok) {
    status.className = 'bad';
    status.textContent = 'Can’t reach the helper — is `docviz serve` running?';
  } else if (!h.paired) {
    status.className = 'bad';
    status.textContent = 'Helper found, but that code doesn’t match.';
  } else {
    const found = Object.entries(h.providers).filter(([, v]) => v).map(([k]) => k).join(' + ');
    status.className = 'ok';
    status.textContent = `Connected · ${found}`;
  }
}

$('test').onclick = test;
for (const id of ['url', 'provider', 'model']) $(id).onchange = saveConnection;
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') test(); });

$('chip').onchange = async () => {
  let on = $('chip').checked;
  // Must be requested from the click itself.
  if (on) on = await chrome.permissions.request({ origins: ['<all_urls>'] });
  else await chrome.permissions.remove({ origins: ['<all_urls>'] }).catch(() => {});
  $('chip').checked = on;
  await setSettings({ chip: on });
  await chrome.runtime.sendMessage({ type: 'chip:sync', on });
};

$('finish').onclick = async () => {
  await saveConnection();
  await setSettings({ onboarded: true });
  window.close();
};

if (s.token) test();
