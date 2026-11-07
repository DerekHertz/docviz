# docviz — product specification

## Visual review studio

The standalone studio is the current product direction for reviewing agent-written changes before opening or merging a PR. The earlier documentation-extension specification follows as the existing implementation.

- Start with a holistic system map for a batch or stack. Zoom into each parent-to-candidate layer without losing connected context.
- A capability describes its purpose, inputs, outputs, properties and implementation. Follow visual behavior through concise pseudocode to exact pinned source.
- Keep source interpretations, observed execution, model judgments and human decisions distinct. Recorded-output diagrams show captured fields, with raw evidence available.
- Cache immutable repository models by exact revision and registered repository identity. Reuse descriptions separately from new claims, tests, Jev results or decisions. Changed source/contracts and unmapped files remain visible.
- Agents propose contracts. The human confirms consequential contracts and makes the final review decision. Independent reviewers challenge authoring-agent claims.
- Jev can assess claim/source correspondence and help triage. Missing assessments stay explicit. A source judgment cannot establish runtime behavior or formal verification.
- The local prototype includes manually prepared historical Docviz and AfterClass reviews. Its graph is partial; automatic repository modeling and live stack-claim Jev execution are not implemented.
- Live Jev end-to-end validation and independent merge verification are pending before this new design merges.

See [the studio guide](tools/review-studio/README.md) for setup and [validation](tools/review-studio/STANDALONE-VALIDATION.md) for recorded checks and gaps.

## Documentation extension specification (v0)

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
- **Helper**: Node server on `127.0.0.1:47823`. Detects `claude` / `codex` on PATH;
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
- Two ways to get the diagram (2026-10-31). **Agent path** (the default for an agent): the calling
  agent already has the PR in context, so it writes the diagram. `docviz pr --rules [--glossary F]`
  prints the rules `prCardPrompt` sends (one source, `helper/prompts.js`); the agent adds
  `card: { caption, mermaid }` to `steps.json`; `docviz pr --lint steps.json` checks it, one failure
  per line, exit 1: Mermaid parses (when Playwright is found), first line `flowchart TD`, at most 6
  nodes, a node per step id, each node's label equal to its step's label, `:::changed` exactly on
  changed steps, no `fill` in a `classDef`. `docviz pr` with a card lints it again, stops on a
  failure, and makes no Claude or Codex call, so no nested model loop and no `usage` goes missing:
  the agent's tokens are its own, and the footer says "Diagram by the calling agent" with Jev's
  cost only. Labels equal the step labels so Jev's step check covers what the picture shows. The
  `skills/pr-diagram` skill walks an agent through it. **Fallback path** (a person at a terminal,
  no `card`): docviz asks `claude` or `codex` for the card and repairs it once, as below.
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
- The comment, top to bottom: marker, verdict and its reasons, diagram and step table, Contracts
  (with `--contracts`), Behavior, Modules moved, and last the footer with every model call's cost: the total and its parts
  (diagram, step checks, model checks). Below a cent a figure keeps two significant digits
  (`$0.00004`, `$0.00012`), so a Jev check never reads as `$0.000` and every figure, total or part,
  is within 5% of what was spent.
- Base: one commit for both Behavior and Modules moved (`helper/moved-git.js` `resolveBase`):
  `--base REF`, else the merge base with `origin/main`, else `HEAD~1`; the comment says which. A bad
  `--base` fails before any model call.
- Verdict (`helper/verdict.js`, the MVP; flow in `docs/flows/mvp-verification.md`): the comment
  opens with **Needs you**, **Look when you can** or **Nothing for you** and its reasons, worst
  first. The verdict table is an ordered list of rows; each finding takes the first row it matches.
  A finding no row knows, an unchecked step (no key, `--no-check`, Jev error), code no model covers,
  or a model that didn't run is "look" or worse, never "nothing". A rule that broke at base and
  holds at head is "look" too ("ShipsPaid now holds; it broke before"): the PR changed it.
  Changes to `.atlas/` itself are "look" (2026-10-31): a PR that edits `rules.md` ("Your rules
  changed: added …; removed …; reworded …"; agents never edit it, and docviz can't tell who did);
  a rule whose TLA+ definition changed between base and head, comments and spacing aside ("ShipsPaid's
  definition in the model changed (order)"; the definition includes every operator it calls, so
  weakening it to `TRUE` directly or through a helper is caught by the change itself); any other
  edit to a model's `.tla` or `.cfg` that its chart doesn't show ("order's model changed, though its
  chart and your rules' definitions read the same"), since docviz reads common TLA+ shapes, not all;
  a model, or all of `.atlas/`, removed ("Model order removed"), with the other findings still
  applying. A model invariant that breaks is "needs you" whether or not it is in `rules.md`, and
  with no `rules.md` at all: a break is a break, shown with its path.
- Behavior (`helper/behavior.js`): the reviewed repo's `.atlas/` (`helper/atlas.js`) holds
  `rules.md` (one `## Name` per rule, the user's sentence under it; agents never write it) and
  `models/<name>/` (TLA+ spec, cfg, view, `model.json` linking each action to its lines). Each
  model whose code or folder the PR touched runs through pstack's statechart (TLC) at the base
  (read with `git show`) and at head. The section draws the head chart with new states and steps marked, lists each rule as
  holding or breaking (quoted word for word, with the shortest path), and checks each model step
  against its code with Jev. Running a model imports its `view.mjs`, code from the checkout, so
  models run only with `--trust-atlas`; TLC needs `TLA2TOOLS` and `JAVA`, statechart is found in
  pstack's plugin cache or `DOCVIZ_STATECHART`. TLC is local and free; model-step checks are in the
  footer as "model checks".
- Contracts (`helper/contracts.js`, 2026-11-06; regression: historical PR #1, whose five-step summary
  left out dismissal and read "Look" while its late return lost spend). The summary is the author's
  choice, so it can't decide which promises get checked. `--contracts PROFILE.json` names the
  operator's contract profile, which must sit outside the reviewed checkout. Each contract has a
  definition, its governing text (`path`/`from`/`to`, quoted from head, else base), its code
  anchors, the files it depends on, and optionally a registered harness id. A profile that sets
  `authority`, `confirmed`, `status`, `evidence` or `result`, names a command or path to run, or
  names an unknown harness is refused before any model call. Authority is "operator-selected", not
  an authenticated signature. A contract applies when `git diff base head` touches its anchors' files
  or dependencies. The steps only annotate which anchors no step's lines cover ("omits dismiss").
  `--trust-head` takes HEAD's full SHA (`git rev-parse HEAD`, any case) and docviz compares the
  text with HEAD; git never resolves it. A short SHA, tag, branch or `HEAD` is refused (exit 2)
  before any work: until 2026-11-06 they went through git's ref lookup, and the independent CLI
  matrix showed a tag named like the base's short SHA, pointing at head, trusting head. A full SHA
  of another commit runs nothing (`trust-other-head`). With `--trust-head` equal to HEAD, docviz copies the head's committed files into a temp folder
  and runs its own harness there, in a child process with a scrubbed environment and a 30 s timeout.
  Trusting a head lets its code run; it never makes that code's account of itself evidence. The
  harness's controller loads none of the reviewed code. `background.js` runs in a child process
  (`card-spend-device.mjs`) under Node's permission model (`--permission`: no file writes, no
  reads outside its copy, no child processes or workers) with only an IPC channel back. The
  controller holds chrome.* storage and the helper's replies and computes every frame and the
  outcome. It takes the child's messages only as chrome.storage and fetch calls and its runtime
  listener's replies, never as a value or result; a message it doesn't expect, or a child that
  exits early, is a harness error. No side-panel code runs. The side panel must be one a reviewer
  registered in `helper/contracts/card-spend-panel.mjs` after reading every file it loads: the
  manifest's `side_panel` page, `sidepanel.html`, `sidepanel.js`, `settings.js`,
  `prefs-form.js` and `ui.css`, each matched by sha256 of its committed bytes. The registry is
  docviz's own code; no profile, PR or target supplies a hash. Today one panel is registered,
  docviz's own, unchanged since `3d37957` (the same blobs at PR #1's head). Any other side panel,
  including a comment, an unused function or a renamed parameter in it, is unsupported
  (`surface-missing`) with no totals. After each action the controller sends the background the
  panel's own `panel:get { tabId }` message and computes the page total from the reply with
  docviz's copy of that panel's `refreshCards`. A reply that panel couldn't show (not `ok`, no
  `state` or `cards`, a card without a section, a non-number total) is a harness error. The
  ledger is `chrome.storage.local` `spend.total`, which that panel reads directly. The reply is
  the background's answer, whichever way it arrives: the background can make it say anything it
  could also send the real panel. The harness evaluates no general JS. Until 2026-11-06 the
  harness imported the reviewed code into its own process and printed the result, so code that
  printed `holds` and exited read `supported-in-scope`; the first fix then ran the page expression
  in a child whose reported value that expression could forge over the same channel. Until
  2026-11-07 a recognizer read the first `const page = …;` in `sidepanel.js` and summed raw
  storage. A commented-out or unused copy of the expected line then held for a panel that drops
  unassigned spend, and so did a `panel:get` that never hands the panel that spend. The independent
  final review proved all three. Limits: Node calls its permission model a seat belt, not a
  guarantee against malicious code, and code that escapes it runs as the operator's user; code
  that detects the harness, for example by its Node globals, can make different chrome.storage
  calls here than in Chrome; a Node without `--permission` can't start the reviewed code, so the
  run reads as a harness error; the side panel's code is matched, not run, so how Chrome renders it
  (DOM, CSS, timing of its refreshes) is not observed. The harness's identity (`harnessDigest`)
  covers all three files.
  `card-spend` drives `extension/background.js` through draw → fail after spending → Retry →
  Dismiss → late return, with chrome.* and the helper as controlled fixtures, and records the ledger,
  card and side-panel page total it read after each action in `observed.frames` (the studio animates
  only those; a record without frames has none to show). "Inside the checkout" is by path segment, for
  the named path, its folder's real location and the file it reads, so `..profile.json` and links
  are caught while a sibling `repo-profiles/` is not. Only a record that run
  made counts as executed. A record read from a file is "reported", whatever its fields or digest say.
  Each contract is `violated` (the harness failed at this repo, base, head, definition and
  harness: **Needs you**), `unverified` (no run, no harness, reported-only, unrelated evidence, code
  the harness can't drive, harness error, or governing text not found), `stale` (evidence bound to
  something else), both **Look**, or `supported-in-scope` (held on the one scenario, which is not
  proof) or `not-applicable`, neither of which adds a reason. Harnesses are local and free (footer).
  `--coverage-out FILE` writes the result (`kind: 'contract-coverage'`) that the review studio reads
  through `tools/review-studio/coverage.mjs`. Each obligation records the harness its contract
  selected and that harness's digest (`check`). A stored result is integrity-checked, never
  authenticated: its id and each executed record's id must match their content, and a `violated` or
  `supported-in-scope` row must carry an executed record bound to the result's repository root, base
  and head, the obligation's contract id and definition, and its selected harness, or the file is
  refused. A stack attaches coverage to one comparison, the whole stack (target to tip) or the layer
  it names. A report for another repository, head or base still shows, but every row reads `stale`
  with its recorded status kept for inspection.
- `.atlas/` is the reviewed repo's text, checked where it is read and never dropped silently: a
  `rules.md` heading that isn't `## Name` (one TLA+ word), a rule with no sentence, a repeated
  name, or prose with no rule heading is a "look" reason naming its line; a `model.json` of the
  wrong shape is that model's error, naming its folder and the field, and nothing runs on it; a
  model step whose `from` or `to` marker isn't in its file is unchecked ("look"), naming the step,
  the file and the marker (a missing `to` never widens the cut to the end of the file).

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
- Playwright is a dev dependency, used to render cards to PNG for the lab.
- The no-dependencies rule was dropped on 2026-10-31: dependencies are allowed once the user
  approves each one, and behavior models build on pstack's `statechart`. The extension keeps no
  build step.

## Later

- Mascot that hops onto the page and "paints the picture" (own character — not Anthropic's).
- Pet/status event stream, API-key providers.
- Cost estimate before a breakdown starts (today only after).
