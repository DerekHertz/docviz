# docviz — spec (v0)

Annotate any docs page — or any selected text/code — with technical visuals, powered by the
user's own Claude Code or Codex login. Audience: SWEs.

Settled in a design-grilling session on 2026-10-27.

## Shape

```
Chrome tab                Extension (MV3)              Local helper (docviz serve)
content.js  ──sections──▶ background.js ──HTTP──▶      server.js ──▶ claude -p | codex exec
card iframes ◀──specs──── cache + prefs  ◀──JSON──      (your existing CLI login)
```

- **Extension**: plain JS, no build step, loaded unpacked.
- **Helper**: zero-dependency Node server on `127.0.0.1:47823`. Detects `claude` / `codex` on PATH;
  Claude wins when both exist (overridable). Paired once with a code the helper prints; that code is
  the shared secret (`x-docviz-token`). Requests from non-extension origins are refused.
- **One contract**: sections in → card specs out. Providers are swappable behind it (API keys are a
  future provider, out of scope).

## Triggers

| Trigger | Result |
|---|---|
| Toolbar button / `Alt+Shift+D` / page right-click | **Break down this page**: cards inline under each section heading, side panel opens with the list |
| Selection right-click / `Alt+Shift+V` | **Visualize selection**: floating popover |
| Highlight chip | Opt-in setting; requests `<all_urls>` only when enabled |

Page access is `activeTab` by default — installs with no host-permission warning.

## Cards

- **Mermaid first** — kinds: `sequence`, `state`, `flow`, `timeline`, `architecture`; the model picks.
- Buttons: **Simpler**, **More detail**, **Type ▾**, **Explore**, dismiss.
- Failed render → one repair round-trip with the parser error → else show raw source.
- Cached by URL + content hash + prefs.

## Explore (interactive)

- On demand per card. Model researches first — **source code → official docs → forums** — then
  writes a self-contained HTML/JS simulation with 1–3 knobs from the doc.
- Rendered in an extension **sandbox page** (opaque origin, CSP `default-src 'none'`: no network,
  no page access).
- Always labeled **"Simulated from the docs"** with **sources** and **assumptions**.
- Claude: `--tools WebSearch,WebFetch`. Codex: `--search`.

## Preferences

Setup on first run; editable in settings and the side panel.

| Pref | Options | Default |
|---|---|---|
| Depth | eli5 / concept / mechanism / implementation | mechanism |
| Style | strict diagrams / illustrated (cartoons, metaphors welcome) | illustrated |
| Coverage | only where something behaves / every section | behavior |
| Think first | question first, diagram blurred until revealed | off |
| Pictures | on demand / every card / never (Codex) | on demand |
| Daily budget | USD, 0 = no cap | $2 |

Setup's preference step is a calibration: `debounce` explained at each depth (static text, no model
call); the one the user picks sets depth. ELI5 builds the diagram on one everyday analogy and tags
each real identifier once beside it.

Fixed rule regardless of prefs: **real identifiers always appear** — illustrate freely, never
oversimplify.

Learning: **Simpler / More detail** move the saved depth one step and the card says so with
**Undo** — never silent.

## Roles: Claude plans, Codex paints

With both CLIs, the planner (Claude by default) writes each card including a `picture`
brief; `/v1/illustrate` always goes to Codex's built-in `image_gen`, with the brief, caption and
Mermaid source. Pictures are explanatory figures, not decoration: each object maps to a real
identifier, order is shown with numbered steps, and up to 6 labels name real identifiers. (v0's
wordless "friendly metaphor" pictures were pretty and taught nothing.) Pictures are opt-in per card by
default because they cost ~3x a card.

## Cost

Every helper response carries `usage` (`usd`, `estimated`, tokens). The extension charges it to the
card (a breakdown batch is split evenly over its cards) and to a ledger (today / all time). The
budget check runs before every call. Claude's price comes from the CLI; Codex's is estimated from
tokens and `--codex-rates`, shown with `~`.

- The budget is a soft cap: the check reads spend already recorded, so calls started together (a
  breakdown's batches, a picture beside them) can overshoot it by what they were already running.
  There is no reservation.
- A call that fails after the CLI spent (error result, unparseable output, no picture) still returns
  its `usage` in the error body; the extension records it and charges the card as a "failed …" row.
  A timeout kills the CLI before it reports, so that spend can't be recovered and isn't shown.
- A breakdown batch that yields no usable cards has no card to charge. It counts in the side panel's
  "this page" total and in the toast, not in any card's breakdown.
- Simpler / More detail check the budget first, so a blocked click doesn't move the saved depth.
- Pictures repaint on a changed diagram only in `auto`; `off` hides 🎨. A cached picture whose PNG is
  gone is dropped from the cache so 🎨 paints again.

## Also in v0

- Side panel: helper status, cards on this page (click to scroll), prefs, last pref change.
- Claude Code plugin: `/docviz` starts the helper in the background.

## PR mode (`docviz pr`)

Moved in from reposwipe's `pr-diagrams` skill on 2026-10-29. A CLI command, not a helper route:
the caller (usually an agent) picks the PR's main flow as 4–8 steps with their code, and docviz
returns one PR comment.

- One `flowchart TD`, at most 6 nodes, a node per step; changed steps carry `:::changed` with a
  stroke-only `classDef` (a fill breaks GitHub's dark theme). Prefs are fixed: concept, strict.
- Labels are plain words, overriding the identifier rule: the "Where in the code" table under the
  diagram is where the real identifiers live, as links to the lines at `HEAD`.
- `--glossary` adds the project's own terms to the prompt.
- Cost: there is no extension or ledger here, so the comment's footer and stderr carry the total of
  every call (card + repair), with `~` for Codex. A failed run still prints what it spent.
- Mermaid is checked only when Playwright is found (docviz takes no dependency on it); the footer
  says "not syntax-checked" otherwise.

## Later

- Mascot that hops onto the page and "paints the picture" (own character — not Anthropic's).
- Pet/status event stream, API-key providers.
- Cost estimate before a breakdown starts (today only after).
