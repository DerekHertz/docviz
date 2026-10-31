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
- Mermaid is checked only when Playwright is found next to docviz (docviz takes no dependency on
  it); the footer says "not syntax-checked" otherwise.
- The reviewed checkout is untrusted: Playwright is never resolved from its `node_modules`, and
  docviz's git calls there switch off `core.fsmonitor` and `core.hooksPath`.
- Step checks (lab C3, `helper/checks.js`): with `TYPESAFE_API_KEY` set, Jev checks each step's
  label against its linked lines while the diagram is drawn, and the table gains a Check column:
  ✓ every claim shown, ⚠ review (a claim the lines don't show), ✗ contradicted. A failed check
  marks only that step unchecked. Jev's cost is in the footer, broken out from the diagram's.
  `--no-check` skips it; without a key the footer says "steps not checked".
  First real run (this repo, 2026-10-30): 4 of 5 steps went to review: snippet cuts with labels that
  claimed more than the snippet. Retested in the lab on 19 real steps from five projects (JS, TS,
  TSX, Python, whole functions): 14 of 19 true steps pass, none flagged, 1 of 38 broken let
  through, 1 of 9 held-out can't-tell passed. Adding the definitions a step calls (one hop,
  `helper/context.js`) didn't help overall and let a wrong link pass on its helper's code, so it is
  not used.

## Lab (`docviz lab`)

Added 2026-10-30. A local page (`lab/`, port 47830) for trying a new evaluator on known-good and
known-broken cases before anything ships with it. Jev is the first; the plan is
[docs/jev-eval-plan.md](docs/jev-eval-plan.md). It runs from a repo checkout (`docviz lab` or
`npm run lab`); the published helper leaves it out.

Direction: the lab is how docviz decides which checks to trust on large diffs, PRs and generated
code. An adopted check runs where docviz explains code (`docviz pr`, cards) and its result is shown
there; the lab keeps rerunning it as models and prompts change.

- An experiment is a module in `lab/experiments/` exporting `meta` (pass bar, and `tested`: what
  the evaluator is given, asked, and what is left to code), `cases()` and `evaluate()`. Bad cases
  are made by breaking good ones on purpose, so the truth is known. The page shows all of it, with
  a table of case kinds, before any result.
- Jev is asked only what code can't answer. Exact strings (spelling, names existing, line numbers)
  stay in code. Every Jev question carries criteria: what counts as yes and as no.
- Results show calibration (when Jev says 80%, is it right 80% of the time?) and confidence bands:
  confident answers act, the middle goes to review (a stronger model or a person).
- Three-way experiments: truth is good / broken / can't tell (the evaluator honestly can't decide
  from what it's shown), and an answer becomes pass / flag / review. A yes/no question can't say
  "unknown" (Jev expresses doubt only by answering near 0.5), so a check is tested both ways on
  the same cases: yes/no with bands, and three named options including "can't tell". Scored on
  broken let through, good flagged, clear cases sent to review, and can't-tell cases passed
  anyway. A broken case sent to review counts as caught: a person sees it.
- Repeatability is judged on decisions, not probabilities: the share of cases whose decision
  changed since the previous run (Jev's probabilities move by a few hundredths between runs).
- Adopted so far (2026-10-30), both not yet wired into docviz:
  - **B2 identifier readable** (rendered card PNG, yes/no, threshold tuned per run).
  - **C3 step matches its code**, two questions per step: "is every claim in the label shown by
    these lines?" (pass at ≥ 0.6) and "do they contradict it?" (flag at ≥ 0.5); neither is review.
    A label may only claim what its linked lines show. The one-question and three-option
    versions passed 44% / 56% of can't-tell labels and were rejected.
- The page shows every case as the evaluator saw it, streams each decision as it lands, and scores
  the run: threshold tuned on half the cases, rates on the other half; any injection case that gets
  through fails the run. The user can flip a label, change the bar, and record adopt / reject /
  needs a better question in `lab/decisions.json`. Only an adopted check moves into the product.
- Spend: every call's cost is in the run and on the page. Jev cost is exact (input tokens ×
  $0.042/Mtok; output free). The key comes from `TYPESAFE_API_KEY`.
- Playwright is a dev dependency, used to render cards to PNG for the lab. The extension and
  the published helper still take no dependencies.

## Later

- Mascot that hops onto the page and "paints the picture" (own character — not Anthropic's).
- Pet/status event stream, API-key providers.
- Cost estimate before a breakdown starts (today only after).
