---
description: Start the docviz helper for the Chrome extension and show its pairing code
allowed-tools: Bash
---

Start the docviz helper so the docviz Chrome extension can reach this machine's Claude Code login.

1. Check whether it is already running: `curl -s http://127.0.0.1:47823/v1/health`. If that returns `"ok":true`, skip to step 3.
2. Otherwise start it with the Bash tool using `run_in_background: true`:
   `node "${CLAUDE_PLUGIN_ROOT}/helper/cli.js" serve $ARGUMENTS`
   Then wait for the health check above to succeed (retry a few times, about a second apart).
3. Get the pairing code with `node "${CLAUDE_PLUGIN_ROOT}/helper/cli.js" code`.

Reply in two or three lines: that the helper is running on `http://127.0.0.1:47823`, the pairing code (formatted as code), and that the user pastes it once into the extension's settings page. If neither `claude` nor `codex` is on PATH, say so instead.
