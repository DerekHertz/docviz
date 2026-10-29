// Pure cost logic shared by the service worker and the tests: card cost
// attribution, the daily budget check, the spend ledger and the picture cache key.
import { rollSpend, spendToday, money } from './settings.js';

export async function sha(value) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A card's cost is the sum of every call made for it; a breakdown batch is
// split evenly across the cards it produced.
export function addCost(cost, what, usage, share = 1) {
  const c = cost || { usd: 0, estimated: false, items: [] };
  if (!usage) return c;
  const usd = usage.usd / share;
  return {
    usd: c.usd + usd,
    estimated: c.estimated || usage.estimated,
    items: [...c.items, { what: share > 1 ? `${what} (1/${share} of batch)` : what, usd, estimated: usage.estimated, provider: usage.provider, model: usage.model, tokens: (usage.inputTokens || 0) + (usage.outputTokens || 0) }],
  };
}

// The message to refuse with once today's spend has reached the budget, else null.
// A soft cap: it reads spend that is already recorded, so calls started together
// can overshoot it by what they were already running.
export function budgetRefusal(settings) {
  const spent = spendToday(settings.spend);
  if (settings.budget > 0 && spent >= settings.budget) {
    return `Today’s ${money(settings.budget)} docviz budget is used up (${money(spent)}). Raise it in settings to keep going.`;
  }
  return null;
}

// Same card text → same picture.
export const pictureCacheKey = async (spec, eli5) => `p:${await sha([spec.title, spec.picture, !!eli5])}`;

// Writes are serialized; one failed write must not stop the later ones.
export function createLedger({ load, save }) {
  let chain = Promise.resolve();
  return {
    record(usage) {
      if (!usage) return chain;
      const write = chain.then(async () => save(rollSpend(await load(), usage.usd)));
      chain = write.catch(() => {});
      return write;
    },
    idle: () => chain,
  };
}
