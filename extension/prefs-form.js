// Preference controls shared by the setup page and the side panel.
import { getSettings, setSettings } from './settings.js';

export const PREF_FIELDS = [
  { name: 'depth', label: 'Depth', options: [['eli5', 'Explain like I’m 5'], ['concept', 'Concept'], ['mechanism', 'Mechanism'], ['implementation', 'Implementation']] },
  { name: 'style', label: 'Style', options: [['illustrated', 'Illustrated — cartoons welcome'], ['strict', 'Strict diagrams']] },
  { name: 'coverage', label: 'Coverage', options: [['behavior', 'Only where something behaves'], ['all', 'Every section']] },
  { name: 'pictures', label: 'Pictures', options: [['demand', 'When I click 🎨 (Codex)'], ['auto', 'On every card (Codex, costs more)'], ['off', 'Never']] },
];

export function renderPrefs(container, prefs) {
  container.replaceChildren();
  for (const f of PREF_FIELDS) {
    const label = document.createElement('label');
    label.className = 'pref';
    const span = document.createElement('span');
    span.textContent = f.label;
    const select = document.createElement('select');
    select.name = f.name;
    for (const [value, text] of f.options) select.append(new Option(text, value, false, prefs[f.name] === value));
    select.onchange = () => save({ [f.name]: select.value });
    label.append(span, select);
    container.append(label);
  }
  const think = document.createElement('label');
  think.className = 'pref';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = !!prefs.thinkFirst;
  box.onchange = () => save({ thinkFirst: box.checked });
  const span = document.createElement('span');
  span.textContent = 'Think first — ask a question before revealing each diagram';
  think.append(box, span);
  container.append(think);
}

export async function save(patch) {
  const s = await getSettings();
  await setSettings({ prefs: { ...s.prefs, ...patch }, lastPrefChange: null });
  chrome.runtime.sendMessage({ type: 'prefs:updated' }).catch(() => {});
}
