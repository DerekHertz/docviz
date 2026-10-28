# docviz

Chrome extension (`extension/`, MV3, plain JS, no build step) + zero-dependency Node helper
(`helper/`) that runs the user's own `claude` / `codex` CLI. Decisions live in [SPEC.md](SPEC.md);
read it before changing behavior.

## Rules

- No dependencies and no build step, in either half. `extension/vendor/mermaid.min.js` is the one vendored file.
- Every helper call must return `usage`, and the extension must charge it to the card and the
  spend ledger. Never add a call that spends without showing up in the card's cost breakdown.
- Codex dollars are estimates (`estimated: true`, shown with `~`). Claude dollars come from the CLI.
- Real identifiers always appear in cards, at every depth including ELI5.
- Model output is untrusted: Mermaid renders with `securityLevel: 'strict'`, simulations only in the
  sandbox page (CSP blocks all network).
- Preference changes made on the user's behalf are visible with Undo, never silent.

## Checking a change

```bash
npm run check && npm test
```

CI runs the same on every PR; `main` is protected and requires the `test` check.

```bash
node helper/cli.js serve --port 47829
```

Then POST to `/v1/card`, `/v1/cards`, `/v1/illustrate` with `x-docviz-token: $(node helper/cli.js code)`.
Extension changes need a reload at `chrome://extensions`; agents can't do that themselves, so ask.
Claude-in-Chrome can't review cards: inserting a docviz iframe detaches its debugger and the frame
is dropped. Have the user open the page in a normal tab and look at it read-only instead.

## Agents (den kit)

This project is built by the den's roles, loaded with `claude --plugin-dir <den>/.claude` as `den:<role>`. Every agent follows the `den:team-protocol` skill.

- Code tickets run a relay: `developer` writes the failing tests first, then `code-reviewer` and `qa` (verify) review the same commit; one fix round carries both reviews. Then `den risk-check`: a clean exit skips `security`, a hit dispatches it. Push, PR and merge on green CI follow.
- The board is `.scratch/` in the main checkout (`den board`, `den status`); tests run with `den test <files>`.

Everything in `den:team-protocol` applies here; swap the den's commands for the `den` command on PATH:

| In the den | In another project |
|---|---|
| `npm run board -- <cmd> ...` | `den board <cmd> ...` |
| `npm run test:path -- <files>` | `den test <files>` (the project's own test command, from `.den/project.json`) |
| `npm run risk-check` | `den risk-check` |
| `node scripts/usage.mjs --provider claude` | `den usage --provider claude` |

- The risk path is `.claude/`, `CLAUDE.md`, `.den/`, `.github/`, dependency and lockfile changes, secrets handling, and every file in `.den/project.json`'s `guardrailPaths`.
- Den-only tools (`node scripts/jg.mjs`, `node scripts/test-guard.mjs`, `npm run pr-map`, `npm run -s session-check`, `npm run verify:ui`, `den:update`) don't exist there: skip them and say so in your handoff. Den docs (`docs/agents/*`, the den's ADRs) are not in that repo; the rules they back are the ones in `den:team-protocol` and your role.
- Roles load as `den:<role>`; you still sign the board as the bare role (`--as qa`, `claim <ref> qa`).
- The user approves new dependencies, accounts and keys, changes to `.claude/`, `CLAUDE.md`, `.den/` and CI, and gives every visual verdict.
