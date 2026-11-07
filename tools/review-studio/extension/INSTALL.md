# Use visual review inside GitHub

The extension adds a **Visual review** entry below GitHub PR navigation and a review button on explicit branch comparison pages. The bubble explorer runs inside that page. Your local Docviz engine owns repository analysis, evidence, saved decisions, and receipts.

## Install the extension

1. Start the engine by double-clicking `Launch Docviz.command` in the app folder. Keep its Terminal window open.
2. Open `chrome://extensions` in Chrome or Chromium.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the generated `github-extension` folder containing `manifest.json`.
5. Open a GitHub PR, such as `https://github.com/DerekHertz/docviz/pull/10`.
6. Click **Visual review** in the row below the PR navigation.

The extension needs access to `github.com` to add the review surface and to `127.0.0.1` to contact your engine. It has no access to other websites and no remote hosting service. Chrome match patterns cover loopback ports, but the worker contacts only port 47836.

Opening the view fetches the PR's current metadata and Git refs. It does not run project code, invoke a model, post a comment, submit a GitHub review, or merge anything.

## Review before opening a PR

Open a GitHub comparison URL with explicit base and candidate branches, such as `https://github.com/DerekHertz/docviz/compare/main...fix%2Fdismiss-spend`. Click **Visual review** beside the comparison heading. The same component, property, evidence, and decision workflow is available before you create the PR.

This version supports same-repository comparisons with explicit `base...candidate` refs. Cross-fork comparison URLs are not included. The engine resolves the actual commits and keeps new candidates separate from older approvals.

## Follow a visual verification path

Select a component bubble and click **Verify component**. The first design level, **Verify**, connects the changed implementation to a selectable property, its evidence and agent challenges, and your decision.

Each stage opens the relevant source or artifact. An agent description is an interpretation. A command-level pass remains distinct from a property-specific observation. Missing, stale, or unmapped evidence stays visible. Your recorded judgment remains separate from evidence.

The other design levels retain the abstraction, before/after behavior, property definitions, and pinned implementation. Closing Visual review returns to the original GitHub page. It preserves the panel state while you remain on the same PR.

## Review identity and private projects

The engine resolves the actual PR commits. It can reuse an existing local review only when the repository and exact comparison commits match. New candidates require a fresh review. Review receipts are local records until you export them.

Private PR metadata needs valid `GH_TOKEN` or `GITHUB_TOKEN` in the engine environment, and normal Git credentials for fetching the repository. Your GitHub browser login alone does not authenticate those API calls. The extension reports this limitation instead of guessing a PR's head from its branch name.

## Update or troubleshoot

After rebuilding the extension, click its **Reload** button in `chrome://extensions`, then reload the GitHub page. Keep the generated manifest key so its extension ID matches the engine's trusted origin.

If the view reports that it cannot connect, start the engine and click **Retry connection**. If an already-open view says the PR changed, close it and open Visual review again. Unsupported GitHub Enterprise hosts are not included in this version.

To remove it, use **Remove** in `chrome://extensions`. Existing local review records remain in the app's `data` folder.

## Build and verification

Run `npm run build:extension` from the app folder. The build copies the shared UI and replaces its transport module. It does not maintain a second review model or decision store.

Run `npm test` for protocol, origin, immutable snapshot, persistence, evidence, and PR-binding checks. A local browser preview or fixture alone does not establish that Chrome has installed and run the extension. See the app's validation record for the observed runtime checks.
