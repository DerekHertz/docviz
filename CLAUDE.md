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
node --check helper/*.js extension/*.js
```

```bash
node helper/cli.js serve --port 47829
```

Then POST to `/v1/card`, `/v1/cards`, `/v1/illustrate` with `x-docviz-token: $(node helper/cli.js code)`.
Extension changes need a reload at `chrome://extensions`; agents can't do that themselves, so ask.
Claude-in-Chrome can't review cards: inserting a docviz iframe detaches its debugger and the frame
is dropped. Have the user open the page in a normal tab and look at it read-only instead.
