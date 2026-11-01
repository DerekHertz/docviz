// `docviz pr --lint`: the deterministic rules a PR diagram drawn by the calling agent must pass.
// Pure: steps and card in, error lines out. The Mermaid parse needs a browser, so pr.js adds it.
const KEYWORDS = new Set(['flowchart', 'graph', 'TD', 'classDef', 'class', 'style', 'subgraph', 'end']);
const MAX_NODES = 6;

const withoutStyles = (mermaid) => mermaid.split('\n').filter((l) => !/^\s*(classDef|class|style)\b/.test(l));

// Node ids are the words left once quoted labels, edge labels and :::class suffixes are gone.
function nodeIds(lines) {
  const bare = lines.slice(1).join('\n').replace(/"[^"]*"/g, '').replace(/\|[^|\n]*\|/g, '').replace(/:::\w+/g, '');
  return new Set((bare.match(/[A-Za-z_]\w*/g) || []).filter((w) => !KEYWORDS.has(w)));
}

const labels = (text) => new Map([...text.matchAll(/\b([A-Za-z_]\w*)\s*[[({]+\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
const marked = (text) => new Set([...text.matchAll(/\b([A-Za-z_]\w*)\s*(?:[[({]+\s*"[^"]*"\s*[\])}]+)?\s*:::changed\b/g)].map((m) => m[1]));

/** Error lines for `card` against `steps` ([{ id, label, changed }]); empty when it passes. */
export function lintCard(steps, card) {
  if (!card) return ['steps.json has no card: { caption, mermaid }'];
  if (!card.caption?.trim()) return ['card.caption is empty'];
  if (!card.mermaid?.trim()) return ['card.mermaid is empty'];
  const errors = [];
  const lines = withoutStyles(card.mermaid.trim());
  const head = (lines[0] || '').trim();
  if (head !== 'flowchart TD') errors.push(`the first line must be "flowchart TD", not "${head}"`);

  const ids = nodeIds(lines);
  if (ids.size > MAX_NODES) errors.push(`${ids.size} nodes; at most ${MAX_NODES}`);
  const text = lines.join('\n');
  const drawn = labels(text);
  const changed = marked(text);
  for (const s of steps) {
    if (!ids.has(s.id)) { errors.push(`step ${s.id} has no node`); continue; }
    if (!drawn.has(s.id)) errors.push(`node ${s.id} has no quoted label; step label is "${s.label}"`);
    else if (drawn.get(s.id) !== s.label) errors.push(`node ${s.id} says "${drawn.get(s.id)}"; step label is "${s.label}"`);
    if (s.changed && !changed.has(s.id)) errors.push(`step ${s.id} is changed but has no :::changed`);
    if (!s.changed && changed.has(s.id)) errors.push(`step ${s.id} is not changed but carries :::changed`);
  }
  for (const id of ids) if (!steps.some((s) => s.id === id)) errors.push(`node ${id} is no step; only step labels are checked against the code`);
  for (const l of card.mermaid.split('\n')) if (/^\s*classDef\b.*\bfill\b/.test(l)) errors.push(`classDef sets fill (breaks dark mode): ${l.trim()}`);
  return errors;
}
