// PROTOTYPE: ask the adopted step check (lab C3) about each step of the head model,
// once against PR #1's code (does the model match?) and once against the base (did the PR change it?).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { checkSteps } from '../../helper/checks.js';

const BASE = '921e385', HEAD = '3d37957', FILE = 'extension/background.js';
const src = (sha) => execFileSync('git', ['show', `${sha}:${FILE}`], { encoding: 'utf8' }).split('\n');

// A function (or handler line) from its first line to its closing brace.
function cut(sha, startsWith) {
  const lines = src(sha);
  const i = lines.findIndex((l) => l.trimStart().startsWith(startsWith));
  if (i < 0) return null;
  let depth = 0, j = i;
  for (; j < lines.length; j++) {
    for (const ch of lines[j]) depth += ch === '{' ? 1 : ch === '}' ? -1 : 0;
    if (depth <= 0 && j > i) break;
    if (depth === 0 && lines[j].includes('}')) break;
  }
  return { path: FILE, start: i + 1, end: j + 1, text: lines.slice(i, j + 1).join('\n') };
}

const CALL = 'async function callHelper(';
const steps = [
  { id: 'YouBreakDown', label: 'Before any helper call starts, it is refused if today’s budget is used up.', fns: [CALL] },
  { id: 'CardArrives', label: 'When the card comes back, the call’s cost is recorded in the ledger and added to the card’s cost.', fns: [CALL, 'async function generate('] },
  { id: 'CallFails', label: 'When the call fails after spending, its cost is still recorded and added to the card as a failed attempt.', fns: [CALL, 'async function generate('] },
  { id: 'TimesOut', label: 'When the helper reports no cost (a timeout), nothing is recorded or charged.', fns: [CALL] },
  { id: 'YouPressSimpler', label: 'Pressing Simpler is refused before the saved depth moves when today’s budget is used up; otherwise the depth moves and the card redraws.', fns: ['async function adjust('] },
  { id: 'YouRetry', label: 'Pressing Retry redraws the card.', fns: ["'card:retry'"] },
  { id: 'YouDismiss', label: 'Dismissing removes the card record, even while one of its calls is still running.', fns: ['async function dismiss('] },
  { id: 'LateReturn', label: 'When a redraw comes back after its card was dismissed, the cost is recorded in the ledger but added to no card.', fns: [CALL, 'async function generate('] },
];

const at = (sha) => steps.map((s) => ({ id: s.id, label: s.label, cuts: s.fns.map((f) => cut(sha, f)).filter(Boolean) }));
const [head, base] = await Promise.all([checkSteps(at(HEAD)), checkSteps(at(BASE))]);
const usd = [...head, ...base].reduce((t, r) => t + (r.usage?.usd || 0), 0);
const rows = steps.map((s, i) => ({ id: s.id, label: s.label, head: head[i], base: base[i], cuts: at(HEAD)[i].cuts.map((c) => `${c.path}:${c.start}-${c.end}`) }));
writeFileSync(new URL('./checks.json', import.meta.url), JSON.stringify({ base: BASE, head: HEAD, usd, rows }, null, 2));
for (const r of rows) console.log(r.id.padEnd(16), 'head', r.head.verdict.padEnd(9), r.head.prob?.toFixed(2), r.head.probContra?.toFixed(2), ' base', r.base.verdict.padEnd(9), r.base.prob?.toFixed(2), r.base.probContra?.toFixed(2), r.head.error || r.base.error || '');
console.log('Jev spend $' + usd.toFixed(5));
