// System prompts and JSON schemas — the model-facing half of the contract.
// Schemas are strict (every property required, no extras) so they work with
// both `claude --json-schema` and `codex exec --output-schema`.

export const KINDS = ['sequence', 'state', 'flow', 'timeline', 'architecture'];

const cardProps = {
  sectionId: { type: 'string' },
  kind: { type: 'string', enum: KINDS },
  title: { type: 'string' },
  mermaid: { type: 'string' },
  caption: { type: 'string' },
  question: { type: 'string' },
  interactive: { type: 'boolean' },
};

const cardSchema = {
  type: 'object',
  properties: cardProps,
  required: Object.keys(cardProps),
  additionalProperties: false,
};

export const SCHEMAS = {
  cards: {
    type: 'object',
    properties: { cards: { type: 'array', items: cardSchema } },
    required: ['cards'],
    additionalProperties: false,
  },
  card: cardSchema,
  repair: {
    type: 'object',
    properties: { mermaid: { type: 'string' } },
    required: ['mermaid'],
    additionalProperties: false,
  },
  explore: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      html: { type: 'string' },
      knobs: { type: 'array', items: { type: 'string' } },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          properties: { title: { type: 'string' }, url: { type: 'string' } },
          required: ['title', 'url'],
          additionalProperties: false,
        },
      },
      assumptions: { type: 'array', items: { type: 'string' } },
    },
    required: ['title', 'html', 'knobs', 'sources', 'assumptions'],
    additionalProperties: false,
  },
};

const DEPTH = {
  concept: 'CONCEPT depth: what the thing does and why, the shape of the behavior. Still name the real API surface involved.',
  mechanism: 'MECHANISM depth: how it behaves step by step — the calls, states, ordering, and branches a working engineer needs to predict it.',
  implementation: 'IMPLEMENTATION depth: internals — data structures, edge cases, error paths, concurrency, exact parameter effects.',
};

const STYLE = {
  strict: 'STYLE strict: plain technical diagrams. No emoji, no metaphors.',
  illustrated: 'STYLE illustrated: cartoons and metaphors are welcome — emoji in node labels, a vivid one-line metaphor in the caption — as long as every technical detail still appears.',
};

function prefsBlock(prefs) {
  const p = { depth: 'mechanism', style: 'illustrated', coverage: 'behavior', thinkFirst: false, ...prefs };
  return [
    DEPTH[p.depth] || DEPTH.mechanism,
    STYLE[p.style] || STYLE.illustrated,
    p.thinkFirst
      ? 'THINK FIRST is on: fill "question" with one pointed question about the behavior the reader should try to answer before seeing the diagram (e.g. "What happens if the token expires mid-request?").'
      : 'THINK FIRST is off: set "question" to "".',
  ].join('\n');
}

const MERMAID_RULES = `Mermaid rules (the diagram must parse with Mermaid 11):
- Map kind to syntax: sequence → "sequenceDiagram"; state → "stateDiagram-v2"; flow → "flowchart TD"; timeline → "sequenceDiagram" with notes, or "gantt" when durations matter; architecture → "flowchart LR" with subgraphs.
- In flowcharts, ALWAYS quote labels: A["setTimeout(fn, wait)"] — never leave ( ) [ ] { } < > : ; # unquoted in a label. Never use "end" as a node id.
- In sequence diagrams, keep message text free of semicolons and "#"; declare participants with aliases and NO quotes (participant C as Client) — quotes render literally.
- No HTML except <br/>. No click handlers, no styles that set fonts.
- 4–14 nodes/steps. Prefer one clear diagram over an exhaustive one.
- Edge and message labels: 6 words max, led by the real identifier ("flush()", "wait elapsed"). Explanations go in the caption, not on edges.
- State diagrams: avoid more than ~10 transitions; split concerns rather than drawing every edge.`;

const BASE = `You turn technical documentation into diagrams that show how code BEHAVES.
Fixed rule: use the doc's real identifiers — function names, parameters, options, status codes, config keys, error names. Illustrate freely, never oversimplify.
Card fields: "title" (short), "kind", "mermaid" (source only, no fences), "caption" (one or two sentences: the key insight), "question", "interactive" (true when the behavior depends on tunable parameters or timing that an interactive simulation would make much clearer — e.g. debounce wait, retry backoff, pool size, TTL).`;

export function cardsPrompt({ page, sections, prefs }) {
  const coverage = prefs?.coverage === 'all'
    ? 'Produce a card for every section that has any technical content.'
    : 'Produce a card ONLY for sections that describe behavior — flow, state, ordering, lifecycle, branching, interaction between components. Skip reference tables, intros, installation lists, and prose with nothing that moves.';
  const system = [BASE, prefsBlock(prefs), MERMAID_RULES, coverage,
    'Return {"cards": [...]} with "sectionId" set to the id of the section each card illustrates. At most one card per section. Return an empty list if nothing qualifies.'].join('\n\n');
  const prompt = `Page: ${page.title}\nURL: ${page.url}\n\n` + sections
    .map((s) => `=== SECTION id=${s.id} — ${s.heading} ===\n${s.text}`)
    .join('\n\n');
  return { system, prompt, schema: SCHEMAS.cards };
}

export function cardPrompt({ page, section, prefs, adjust, previous }) {
  const lines = [BASE, prefsBlock(prefs), MERMAID_RULES,
    `Produce exactly one card for the given text, with "sectionId" = "${section.id}". The text may be a doc excerpt or a code snippet — for code, show what it does at runtime.`];
  if (adjust?.direction === 'simpler') lines.push('The reader found the previous card too dense. Make it simpler — fewer nodes, clearer story — but keep the real identifiers.');
  if (adjust?.direction === 'more') lines.push('The reader wants more detail than the previous card: add the edge cases, error paths, and parameters it glossed over.');
  if (adjust?.kind) lines.push(`Use kind "${adjust.kind}" this time.`);
  let prompt = `Page: ${page?.title || ''}\nURL: ${page?.url || ''}\n\n=== ${section.heading || 'Selection'} ===\n${section.text}`;
  if (previous) prompt += `\n\n=== PREVIOUS CARD (${previous.kind}) ===\n${previous.mermaid}`;
  return { system: lines.join('\n\n'), prompt, schema: SCHEMAS.card };
}

export function repairPrompt({ mermaid, error }) {
  return {
    system: `You fix Mermaid 11 syntax errors. Keep the diagram's meaning and labels; change only what is needed to parse.\n\n${MERMAID_RULES}`,
    prompt: `Parser error:\n${error}\n\nDiagram:\n${mermaid}`,
    schema: SCHEMAS.repair,
  };
}

export function explorePrompt({ page, section, card, prefs }) {
  const system = `You build small interactive simulations that show how documented code behaves when its parameters change.

Research first, in this order, and stop once behavior is pinned down:
1. The real source code (GitHub / the library's repo) for the functions involved.
2. The official documentation.
3. Forums / issues / Q&A, only for behavior the first two leave open.
List what you actually used in "sources" (title + URL). Anything you had to guess goes in "assumptions" — be specific ("assumes leading=false since the doc doesn't say").

Then write "html": ONE self-contained HTML document.
- No external resources at all — no CDN scripts, fonts, images, or fetch(). Network is blocked. Inline all CSS/JS; draw with SVG, canvas, or DOM.
- 1–3 controls ("knobs") for real parameters from the doc, labeled with their real names (e.g. wait, maxWait, leading). List their names in "knobs".
- Animate the behavior over time (events arriving, timers firing, state changing) with play/pause/reset. Show a live event log or timeline so the reader can see ordering.
- Fits 640px wide, under 520px tall. Support light and dark via prefers-color-scheme. Use system-ui fonts.
- Use the doc's real identifiers in labels. ${prefs?.style === 'strict' ? 'Keep visuals plain and technical.' : 'Playful/cartoon visuals are welcome as long as the technical behavior is exact.'}
- This is a simulation of the documented behavior, not the real library. Encode the semantics faithfully from your research.

"title": short name for the simulation.`;
  const prompt = `Page: ${page?.title || ''}\nURL: ${page?.url || ''}\n\n=== ${section.heading || 'Selection'} ===\n${section.text}\n\n=== EXISTING DIAGRAM (${card?.kind || ''}) ===\n${card?.mermaid || ''}`;
  return { system, prompt, schema: SCHEMAS.explore };
}
