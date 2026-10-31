# Verdict

Not built: MVP requirements 3 and 4. The comment opens with one verdict and its reasons: needs you
(a rule breaks or a step is contradicted), look when you can (behavior changed, or anything
unknown), or nothing for you (structure only, every step confirmed).

## Sub-features

- `verdict-needs` for a broken rule or a contradicted step, with the path or the step.
- `verdict-look` for a behavior change with rules holding, or any unknown (an unchecked step, a
  module with no model, a Jev ⚠).
- `verdict-nothing` only for structure-only PRs with every step confirmed.
- `verdict-repeat` gives the same verdict when rerun on the same commit.

## How to get to it (user POV)

- The first line of the comment `docviz pr` prints.

## Driving it with verify.mjs

Preconditions:

- The planted fixtures from `docs/flows/mvp-verification.md` (6–8, known truth) and the replayed
  real PRs with the user's labels (to be added with the feature).

- **Each planted case.** Run `fixture`, then `pr`. The verdict equals the case's planted truth.
- **Each real case.** The verdict equals the user's label.
- **Repeat.** Run `pr` twice on one fixture. Both verdicts match.

## Gotchas

- Until built, report FAIL with "not built".
- Unknown must never come out as "nothing for you"; a planted case with one unchecked step proves it.
