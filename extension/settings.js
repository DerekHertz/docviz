// Settings shared by the service worker and every extension page.

export const DEFAULTS = {
  helperUrl: 'http://127.0.0.1:47823',
  token: '',
  provider: 'auto',
  model: '',
  prefs: { depth: 'mechanism', style: 'illustrated', coverage: 'behavior', thinkFirst: false, pictures: 'demand' },
  // Daily spend cap in USD (0 = no cap). Checked before every helper call.
  budget: 2,
  // { day: 'YYYY-MM-DD', today, total, calls } — API-equivalent dollars.
  spend: null,
  onboarded: false,
  chip: false,
  lastPrefChange: null,
};

export const DEPTHS = ['eli5', 'concept', 'mechanism', 'implementation'];
export const KINDS = ['sequence', 'state', 'flow', 'timeline', 'architecture'];

export async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored, prefs: { ...DEFAULTS.prefs, ...stored.prefs } };
}

export async function setSettings(patch) {
  await chrome.storage.local.set(patch);
}

const today = () => new Date().toLocaleDateString('en-CA');

export function spendToday(spend) {
  return spend?.day === today() ? spend.today : 0;
}

export function rollSpend(spend, usd) {
  const s = spend?.day === today() ? spend : { day: today(), today: 0, total: spend?.total || 0, calls: spend?.calls || 0 };
  return { ...s, today: s.today + usd, total: s.total + usd, calls: s.calls + 1 };
}

export function money(usd, estimated) {
  const v = usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2);
  return `${estimated ? '~' : ''}$${v}`;
}
