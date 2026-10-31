# docviz verification map

The maintained source for verifying docviz's user-facing behavior. Read this index before driving,
then use the matching feature file. Requirements come from `docs/flows/mvp-verification.md`.

## Baseline preconditions

- `node .claude/skills/verify-docviz/scripts/verify.mjs doctor <run>` reports `ok: true`.
- Each run uses its own run id; scratch lives in `/tmp/docviz-verify-<run>`, proof in
  `~/.local/state/docviz-verify/<run>/`.
- Never drive the user's own `docviz serve` on 47823 or their pairing config.

## Driving conventions

- Start every recipe from a fresh `fixture` checkout.
- Run `docviz pr` only through the harness's `pr` command, so it runs from inside the checkout.
- Treat fixture markers and commands as literal.

## Proof and skip reporting

- CLI proof is the command, stdout (`comment.md`), stderr, exit code and wall time (`pr-run.json`).
- Visual proof is `diagram-dark.png`, looked at, not only produced.
- Report the cost line of every run.
- A feature marked not built reports FAIL with "not built", never a pass through another path.

## Features

- [PR comment](./pr-comment.md): the comment `docviz pr` prints today (diagram, code links, Check
  column, cost). Built.
- [Modules moved](./modules-moved.md): which modules a PR moved. Not built (MVP requirement 1).
- [Behavior change and rules](./behavior-and-rules.md): statechart delta and the user's rules
  checked by TLC. Not built (MVP requirement 2).
- [Verdict](./verdict.md): needs you / look when you can / nothing for you, with reasons. Not built
  (MVP requirements 3–4).
- [Helper API](./helper-api.md): the extension's backend pairs and refuses wrong codes. Built.
