import { getSettings, setSettings } from './settings.js';
import { renderPrefs } from './prefs-form.js';

const $ = (id) => document.getElementById(id);
const s = await getSettings();

$('code').value = s.token;
$('url').value = s.helperUrl;
$('provider').value = s.provider;
$('model').value = s.model;
$('chip').checked = s.chip;
renderPrefs($('prefs'), s.prefs);

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
