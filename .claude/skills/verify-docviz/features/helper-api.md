# Helper API

`docviz serve` is the local helper the extension calls. It answers a health check, accepts calls
only with the pairing code the user pasted into the extension, and refuses everything else.

## Sub-features

- `api-health` answers `/v1/health` with `ok: true` and which CLIs it found.
- `api-paired` reports `paired: true` when the right code is sent.
- `api-refuse` answers 401 to a card request with a wrong code.

## How to get to it (user POV)

- Run `docviz serve` (or `/docviz` in Claude Code) and paste the printed code into the extension.

## Driving it with verify.mjs

Preconditions:

- `doctor` reports `ok: true`. Nothing of the user's runs on the port the harness picks.

- **Start and check.** Run `node $H api $RUN_ID`. Exit `0`. `api.json` shows `health.ok: true`,
  `paired.paired: true`, and `wrongTokenStatus: 401`.

## Gotchas

- The harness gives the server its own `XDG_CONFIG_HOME`; without it, `serve` reads and may create
  the user's real pairing code in `~/.config/docviz`.
- A card request with the right code spends money; this recipe sends only a wrong one.
