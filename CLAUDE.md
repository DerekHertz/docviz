# docviz

Chrome extension (`extension/`, MV3, plain JS, no build step) + Node helper
(`helper/`) that runs the user's own `claude` / `codex` CLI. Decisions live in [SPEC.md](SPEC.md);
read it before changing behavior.

## Rules

- Dependencies are allowed once the user approves each one. Behavior models build on pstack's
  `statechart` (TLA+ checked by TLC, drawn as Mermaid). The extension stays plain JS with no build
  step; `extension/vendor/mermaid.min.js` is its one vendored file.
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

## Agents (pstack)

Work here follows pstack's `poteto-mode` triggers and playbooks, mapped to Claude Code with pstack's
adapter (`docs/harness/claude-code.md` in the pstack plugin). The user's `derek-mode` adds their rules.

- Code tickets run poteto-mode's Feature or Bug fix playbook: `how`, then `architect` when the change
  crosses a function boundary, failing tests first, the change, `verify-docviz`, small ordered
  commits, `interrogate` if the design is contested, then a PR.
- A PR merges per poteto-mode's Shipping playbook: only with a `PASS` from `verify-docviz` run by an
  agent that didn't write the change. Green CI is not a verdict. The flow and its rules are in
  [docs/flows/mvp-verification.md](docs/flows/mvp-verification.md).
- Tickets live in `.scratch/<series>/issues/` in the main checkout (gitignored).
- The risk path is `.claude/`, `CLAUDE.md`, `.den/`, `.github/`, `.atlas/rules.md`, dependency and
  lockfile changes, and secrets handling. The user approves new dependencies, accounts and keys,
  changes on the risk path and to CI, and gives every visual verdict.

## Hand-offs on GitHub

A review that leaves work to do tags the agent who should do it, on the last line of the review:

- `@claude` — code fixes. `.github/workflows/claude.yml` runs Claude Code on the PR branch with the
  owner's login; it reads this file and `SPEC.md`, fixes, runs `npm run check && npm test`, and pushes.
- `@codex` — only if the ChatGPT Codex connector is installed on this repo; otherwise use `@claude`.

List each finding with the file and line it's about. Tag once per review, after all findings, never per
finding, so one round fixes everything. A visual verdict and a CI or risk-path change stay with the
user, and the merge waits for a `verify-docviz` PASS: say so instead of tagging an agent.
