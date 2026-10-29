# docviz

See how documented code **behaves**. Break down any docs page into inline diagrams, visualize
any selection (docs, generated code, a README), and turn a diagram into an interactive
simulation grounded in the library's real source — all on your own Claude Code or Codex login.

![A sequence card inline under a docs section](docs/card.png)

![Explore: a simulation built from the real lodash source](docs/explore.png)

## Setup (2 minutes)

**1. Start the helper** in a terminal where `claude` or `codex` is logged in. Once, clone and
put `docviz` on your PATH (it isn't on npm yet):

```bash
git clone https://github.com/DerekHertz/docviz.git && cd docviz && npm link
```

Then:

```bash
docviz serve
```

Or, inside Claude Code with the plugin installed, run `/docviz`. Either way it prints a pairing code.

**2. Load the extension.** `chrome://extensions` → Developer mode → **Load unpacked** →
the `extension/` folder. From WSL, that's
`\\wsl.localhost\Ubuntu\home\<you>\docviz\extension`.

**3. Pair.** The setup page opens on install. Paste the code, pick your preferences, done.

### Claude Code plugin (optional)

```bash
claude plugin marketplace add DerekHertz/docviz
```

```bash
claude plugin install docviz@docviz
```

Then `/docviz` starts the helper in the background and shows the pairing code.

## Using it

| Do | Get |
|---|---|
| Toolbar icon or `Alt+Shift+D` | Cards under each section that describes behavior + the side panel |
| Select text → right-click or `Alt+Shift+V` | A popover diagram for just that selection |
| **Simpler / More detail** on a card | Regenerates that card *and* nudges your saved depth (shown on the card, with Undo) |
| **⤢** on a card | Expands it to fill the window, with zoom (Esc closes) |
| **🎨 Picture** | Codex paints the card's metaphor (needs the Codex CLI; ~30–60s) |
| **$0.04** on a card | What that card cost, call by call |
| **Type ▾** | Redraw as sequence / state / flow / timeline / architecture |
| **Explore ▸** | An interactive simulation with the doc's real knobs. Takes 1–3 min: it reads the source first. Always labeled *simulated*, with sources and assumptions |

Preferences (depth, style, coverage, pictures, think-first) live in the side panel and settings page.
Setup starts by showing one idea explained four ways, from **Explain like I'm 5** to implementation
detail; the one you pick is where your cards start.

### Claude + Codex together

With both CLIs installed, Claude plans every card (diagram, caption, and a picture idea) and
Codex paints the pictures with its built-in image generator. With only one, that one does the text
and pictures need Codex.

### What it costs

Every card shows its cost; the side panel shows this page, today, and all time, against a daily
budget (default $2, set in settings, 0 = no cap). Once today's spend reaches the budget, docviz
starts no new work. Prices are API-equivalent: on a Claude or ChatGPT subscription you aren't billed
per call, it comes out of your plan's usage. Claude reports its own price; Codex prices are estimated
from token counts (`--codex-rates` sets the rates). Rough numbers: a card $0.02–0.05 on Opus, a
picture ~$0.12.

## How it works

```
Chrome tab                Extension (MV3)              Local helper
content.js  ──sections──▶ background.js ──HTTP──▶      helper/server.js ──▶ claude -p | codex exec
card iframes ◀──specs──── cache + prefs  ◀──JSON──      (your existing CLI login)
```

- The helper listens on `127.0.0.1:47823`, accepts only `chrome-extension://` origins, and
  requires the pairing code. Page text goes to your CLI and nowhere else.
- `claude -p` runs lean (no MCP servers, skills, or user settings) — ~1k tokens of overhead
  instead of ~90k, about 3× faster.
- Cards render inside extension iframes, so page CSS/CSP can't break them. Simulations run in a
  manifest sandbox page: opaque origin, CSP blocks all network.
- Results are cached per URL + content + preferences.

See [SPEC.md](SPEC.md) for the decisions behind all of this.

## Helper options

```
docviz serve [--port 47823] [--host 127.0.0.1] [--provider auto|claude|codex] [--model M] [--new-code]
             [--codex-rates in,cached,out,image]   # USD per 1M tokens, and per picture
docviz code     # print the pairing code
```

## Troubleshooting

- **Red `!` on the toolbar icon** — helper isn't running or isn't reachable.
- **"Pairing code rejected"** — run `docviz code` and paste it into settings.
- **"Can't access this tab"** — the side panel button only works on tabs where you've used the
  toolbar icon or shortcut once (that's the `activeTab` permission at work).
- **Diagram shows as source** — Mermaid couldn't parse it even after one automatic repair.
  Hit **Type ▾** or **Simpler** to regenerate.
