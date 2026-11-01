# Modules moved

Not built: MVP requirement 1. On a PR, docviz names the modules the PR moved, from the import map
at the base commit against the head commit, and shows them in the comment.

## Sub-features

- `moved-list` lists each module whose files changed, with added, removed and renamed ones told apart.
- `moved-edges` lists import edges added or removed between modules.
- `moved-structure-only` says when a PR moved structure but no modelled behavior.

## How to get to it (user POV)

- The "modules moved" part of the comment `docviz pr` prints.

## Driving it with verify.mjs

Preconditions:

- A fixture whose base and head differ by a known set of modules (to be added with the feature).

- **Run docviz.** Run `node $H fixture $RUN_ID <fixture>` and `node $H pr $RUN_ID`. The comment
  lists exactly the fixture's moved modules and edges.

## Gotchas

- Until built, report FAIL with "not built"; do not count the step table as this feature.
