# Behavior change and rules

Not built: MVP requirement 2. For each module with a model in the target repo's `.atlas/models/`,
docviz shows the behavior change as a statechart with the change drawn on top, and checks the
user's rules in `.atlas/rules.md` with TLC on base and head.

## Sub-features

- `behavior-delta` draws the head statechart with added, removed and changed states and steps marked.
- `rules-checked` lists each rule as holding or breaking, quoted word for word from `rules.md`.
- `rules-path` gives the shortest path to each broken rule in the reader's words.
- `model-fidelity` checks each model step against its linked code (Jev), when the key is set.

## How to get to it (user POV)

- The behavior part of the comment `docviz pr` prints, for a repo with `.atlas/`.

## Driving it with verify.mjs

Preconditions:

- A fixture repo with `.atlas/rules.md` and one model, and PRs of known truth: one that breaks a
  rule, one that changes behavior with rules holding (to be added with the feature). The card-money
  model in `prototype/pr1-pipeline/model/` is the first candidate.

- **Run docviz.** Run `node $H fixture $RUN_ID <fixture>` and `node $H pr $RUN_ID`. The rule-breaking
  PR's comment names the broken rule and its path; the other lists every rule as holding.

## Gotchas

- Until built, report FAIL with "not built".
- A rule that holds in every fixture may be vacuous: keep at least one fixture that breaks each rule.
