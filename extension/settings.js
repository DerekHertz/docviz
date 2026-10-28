// Settings shared by the service worker and every extension page.

export const DEFAULTS = {
  helperUrl: 'http://127.0.0.1:47823',
  token: '',
  provider: 'auto',
  model: '',
  prefs: { depth: 'mechanism', style: 'illustrated', coverage: 'behavior', thinkFirst: false },
  onboarded: false,
  chip: false,
  lastPrefChange: null,
};

export const DEPTHS = ['concept', 'mechanism', 'implementation'];
export const KINDS = ['sequence', 'state', 'flow', 'timeline', 'architecture'];

export async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored, prefs: { ...DEFAULTS.prefs, ...stored.prefs } };
}

export async function setSettings(patch) {
  await chrome.storage.local.set(patch);
}
