#!/usr/bin/env node
// L1 side by side: for 10 sections, Claude writes one card choosing the layout itself (today) and
// one with Jev's pick fixed (cardPrompt's adjust.kind). Measures time and cost of both, renders both
// diagrams, and assigns them to A/B at random so the user compares blind in the lab (/compare).
//   node lab/l1-sidebyside.mjs [jev-run-experiment-id]   (default l1-jev114)
// Selection is a rule, not a choice: card-worthy sections (by label) where Jev gives a card, first
// every one whose Jev kind differs from Claude's baseline kind, then by hash order, up to 10.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomInt } from 'node:crypto';
import { join } from 'node:path';
import { complete } from '../helper/providers.js';
import { cardPrompt, repairPrompt } from '../helper/prompts.js';
import { cases } from './l1.js';

const LAB = new URL('.', import.meta.url).pathname;
const RUNS = join(LAB, 'runs');
const jevId = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'l1-jev114';
const latest = (id) => {
  const dir = join(RUNS, id);
  const f = readdirSync(dir).filter((n) => n.endsWith('.json')).sort().at(-1);
  return JSON.parse(readFileSync(join(dir, f), 'utf8'));
};
const jev = Object.fromEntries(latest(jevId).results.map((r) => [r.id, r]));
const base = Object.fromEntries(latest('l1-claude').results.map((r) => [r.id, r]));
const hash = (s) => createHash('sha256').update(s).digest('hex');

const eligible = cases().filter((c) => c.label && c.label.form !== 'none' && jev[c.id]?.pick?.form && jev[c.id].pick.form !== 'none');
const byHash = (a, b) => (hash(a.id) < hash(b.id) ? -1 : 1);
const differs = eligible.filter((c) => base[c.id]?.pick?.kind && base[c.id].pick.kind !== jev[c.id].pick.kind).sort(byHash);
const rest = eligible.filter((c) => !differs.includes(c)).sort(byHash);
const chosen = [...differs, ...rest].slice(0, 10);
console.log(`${differs.length} sections where Jev's kind differs from Claude's; comparing ${chosen.map((c) => c.id).join(' ')}`);

const page = (c) => ({ title: c.source.repo, url: c.source.url });
const section = (c) => ({ id: c.id, heading: c.heading, text: c.text });
const timed = async (job) => {
  const t = Date.now();
  const { output, usage } = await complete('claude', { ...job, timeoutMs: 240_000 });
  return { card: output, ms: Date.now() - t, usd: usage.usd };
};

// A diagram that doesn't parse gets the product's repair call; its time and cost go to the side
// that made it (free → freeMs, Jev → fixedMs).
async function repairAll(pairs) {
  const { render, closeRenderer } = await import('./render.js');
  for (const p of pairs) {
    for (const side of ['a', 'b']) {
      const card = p[side].card;
      const ok = await render(card.mermaid, {}).then(() => true, (e) => (e.kind === 'render' ? e.message : Promise.reject(e)));
      if (ok === true) continue;
      const t = Date.now();
      const { output, usage } = await complete('claude', { ...repairPrompt({ mermaid: card.mermaid, error: ok }), timeoutMs: 120_000 });
      const fixed = await render(output.mermaid, {}).then(() => true, () => false);
      card.repaired = { before: card.mermaid, parses: fixed };
      card.mermaid = output.mermaid;
      const key = p[side].who === 'jev' ? 'fixed' : 'free';
      p.timing[`${key}Ms`] += Date.now() - t;
      p.timing.savedMs = p.timing.freeMs - (p.timing.jevMs + p.timing.fixedMs);
      p.cost[`${key}Usd`] += usage.usd;
      console.log(`${p.id}${side} (${p[side].who}): repaired, ${fixed ? 'parses now' : 'still does not parse'}`);
    }
  }
  await closeRenderer();
}

if (process.argv.includes('--repair-only')) {
  const file = join(RUNS, 'l1-sidebyside.json');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  await repairAll(saved.cards);
  writeFileSync(file, `${JSON.stringify(saved, null, 1)}\n`);
  process.exit(0);
}

const out = [];
for (const c of chosen) {
  const pick = jev[c.id].pick;
  const [free, fixed] = await Promise.all([
    timed(cardPrompt({ page: page(c), section: section(c) })),
    timed(cardPrompt({ page: page(c), section: section(c), adjust: { kind: pick.kind } })),
  ]);
  const jevMs = jev[c.id].decisionMs ?? jev[c.id].ms;
  const aIsJev = randomInt(2) === 1;
  out.push({
    id: c.id, heading: c.heading, source: c.source, label: c.label, jevPick: pick, claudeKind: free.card.kind,
    timing: { freeMs: free.ms, jevMs, fixedMs: fixed.ms, savedMs: free.ms - (jevMs + fixed.ms) },
    cost: { freeUsd: free.usd, fixedUsd: fixed.usd, jevUsd: jev[c.id].usage?.usd || 0 },
    a: aIsJev ? { who: 'jev', card: fixed.card } : { who: 'claude', card: free.card },
    b: aIsJev ? { who: 'claude', card: free.card } : { who: 'jev', card: fixed.card },
  });
  console.log(`${c.id}: free ${free.ms} ms (${free.card.kind}) · Jev ${jevMs} ms + fixed ${fixed.ms} ms (${pick.kind})`);
}
await repairAll(out);
mkdirSync(RUNS, { recursive: true });
writeFileSync(join(RUNS, 'l1-sidebyside.json'), `${JSON.stringify({ at: new Date().toISOString(), jev: jevId, cards: out }, null, 1)}\n`);
const sum = (k) => out.reduce((s, x) => s + x.timing[k], 0);
console.log(`total free ${sum('freeMs')} ms vs Jev + fixed ${sum('jevMs') + sum('fixedMs')} ms; saved ${sum('savedMs')} ms over ${out.length} cards`);
