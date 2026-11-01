# PR comment

`docviz pr` reads a PR checkout and the steps an agent picked, and prints one PR comment: a
flowchart of the PR's main flow with changed steps marked, a table linking each step to its lines at
the head commit, a Check column from Jev's step check, and the run's cost.

## Sub-features

- `pr-diagram` prints a `flowchart TD` with one node per step, at most 6 nodes.
- `pr-changed` marks changed steps with `:::changed` and a stroke-only `classDef` (no `fill`).
- `pr-links` links each step to `path#Lstart-Lend` at the head commit on the origin's web URL.
- `pr-check` adds a Check column (✓, ⚠ review, ✗) when `TYPESAFE_API_KEY` is set; says "steps not
  checked" otherwise.
- `pr-cost` puts the total cost in the footer and on stderr, split into diagram and step checks.
- `pr-parse` produces Mermaid that parses with docviz's bundle, or a footer saying it wasn't checked.

## How to get to it (user POV)

- From inside a PR checkout, run `docviz pr <steps.json> --pr <url> [--title T]`.
- The same with `--no-check` to skip Jev.

## Driving it with verify.mjs

Preconditions:

- `doctor` reports `ok: true`; `playwright: true` to render; `jevKey: true` for `pr-check`.

- **Check out the PR.** Run `node $H fixture $RUN_ID pr1-card-money`. It prints the fixture at
  `3d37957`.
- **Run docviz.** Run `node $H pr $RUN_ID`. Exit `0`; `pr-run.json` has a `cost:` line in `stderr`.
- **Read the comment.** Open `comment.md`. It starts with `<!-- docviz-pr-diagrams -->` and
  `## How this PR works`, has one ```` ```mermaid ```` block whose nodes are `budget`, `ledger`,
  `redraw`, `blocked`, `picture` (at most 6), each with `:::changed`, and no `fill` in its
  `classDef`.
- **Check links.** The table has five rows, each linking
  `https://github.com/DerekHertz/docviz/blob/3d37957ec2387a043bef09b9ec9f16c6b5e8f348/extension/background.js#L…`.
  Open one: the lines start at the step's `from` marker.
- **Check column.** With the key: a `Check` column with one of ✓ / ⚠ review / ✗ per row and a footer
  "steps checked by Jev: …". Without: no column and "steps not checked".
- **Render.** Run `node $H mermaid $RUN_ID`. `mermaid.json` reads `"parsed": true`; look at
  `diagram-dark.png`: labels readable on the dark background, changed nodes outlined.

## Gotchas

- `docviz pr` links to the origin remote's web URL: the fixture sets it, so links point at GitHub
  even though the clone is local.
- A step whose `from` marker is missing fails the run before any model call (`marker not found`).
- The diagram's wording changes from run to run; check structure (ids, count, classes), not text.
- A run that fails after a model call still prints `cost:` on stderr; report it.
