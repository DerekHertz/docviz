---
name: verify-docviz
description: "Drive docviz the way its user does and capture proof: run `docviz pr` on a real PR checkout and check the comment it prints, render its Mermaid, and exercise the helper's HTTP API. Use to verify a docviz change before it merges, to produce a PASS or FAIL verdict on a docviz PR, or when asked to prove docviz's behavior rather than run its unit tests."
---

# Verify docviz

docviz's MVP user is a builder whose agents open PRs; the surface they touch is `docviz pr`, a CLI
that reads a PR checkout and a `steps.json` and prints a PR comment. The helper's HTTP API
(`docviz serve`) backs the extension and is secondary. The extension's UI and the atlas page are not
driven here yet. The requirements behind every feature file are in `docs/flows/mvp-verification.md`.

A verdict that lets a PR merge must come from an agent that did not write the change. Drive the PR's
head checkout of docviz, not your own working copy of it.

All commands run from the docviz checkout under test, with a run id of your choosing:

```bash
H=.claude/skills/verify-docviz/scripts/verify.mjs
RUN_ID=$(date +%Y%m%d-%H%M%S)
```

## Launch

Nothing stays running for `docviz pr`: each drive starts from a disposable clone of a fixture's repo
at its commit.

```bash
node $H fixture $RUN_ID pr1-card-money
```

Ready when it prints `fixture pr1-card-money at 3d37957 in /tmp/docviz-verify-<run>`. Fixtures live
in `fixtures/<name>.json`: the source repo (`.` is this checkout), the commit, the origin URL the
comment links to, the PR URL and title, and the steps with their `from`/`to` markers.

## Doctor

Read-only; run it first and whenever anything looks off:

```bash
node $H doctor $RUN_ID
```

It requires Node 22+, `git`, and `claude` or `codex` on PATH (`ok: true`). It also reports the
checkout's head and whether it is dirty, whether Playwright and the vendored Mermaid bundle are
present (needed to render), and whether `TYPESAFE_API_KEY` is set (needed for the Check column).

## Drive

- `node $H pr $RUN_ID` runs `docviz pr` from inside the fixture checkout, exactly as a user does,
  with Jev's step checks when the key is set; add `--no-check` to skip them. It records the comment,
  stderr (warnings and the `cost:` line), the exit code and the wall time.
- `node $H mermaid $RUN_ID` parses the comment's Mermaid with docviz's own bundle under
  `securityLevel: 'strict'` and renders it on GitHub's dark background.
- `node $H api $RUN_ID` starts `docviz serve` on a free port with its own `XDG_CONFIG_HOME`, so the
  user's pairing code is never read or changed; checks `/v1/health` with and without the code and
  that a wrong code gets 401; then stops the server it started.

`docviz pr` makes real model calls on the user's subscription (and Jev calls with the key): each run
costs money. The `cost:` line in `pr-run.json` is the amount; report it.

## Evidence

Everything lands in `~/.local/state/docviz-verify/<run-id>/` (or `$DOCVIZ_VERIFY_OUT/<run-id>/`):
`doctor.json`, `fixture.json`, `comment.md`, `pr-run.json`, `mermaid.json`, `diagram-dark.png`,
`api.json`.

Proof standards:

- Drive the CLI as the user does, from inside the reviewed checkout; never call `runPr` or other
  internals directly.
- Read the comment, not only the exit code: check each requirement the feature file lists against
  `comment.md` and the rendered PNG, and look at the PNG yourself.
- A step's code link must open the lines the step names at the fixture's commit; spot-check one.
- No mocks: the provider and Jev calls are real. A run without the Jev key verifies everything but
  the Check column, and says so.

## Cleanup

```bash
node $H cleanup $RUN_ID
```

It removes the run's scratch folder (the clone, its config, a server it started, by pid) and keeps
the evidence folder. Never kill processes by name.

## Feature map

`features/README.md` indexes one file per user-facing feature. Features the MVP has not built yet
are listed with their journeys and fail until docviz implements them; never weaken a journey to make
it pass. Keep the map current with `/pstack:maintain-verification-skill`.
