# Live review architecture

The server owns each review document. Its snapshot identity includes the repository, selected refs, requested target commit, comparison-base commit, candidate commit, and comparison mode. The browser submits versioned domain actions and receives a compiled document.

## Modules

| Module | Responsibility |
| --- | --- |
| `git.mjs` | Resolve commits, read immutable source and diffs, group files, and detect supported relative imports. |
| `review.mjs` | Validate proposals, define review policy, compute document digests, and build receipts and handoffs. |
| `workspace.mjs` | Persist the registry, documents, producer artifacts, evidence, history, and receipts through one serialized writer. |
| `agents.mjs` | Invoke existing Claude and Codex CLIs and optional Jev judgments. Retain producer identity and reported usage. |
| `server.mjs` | Serve the loopback UI, validate HTTP actions, fetch PR refs, and persist asynchronous job status. |
| `ui/` | Render the component map, design levels, source inspection, property evidence, findings, and review controls. |

## Authority and evidence

A Git snapshot is immutable. Agent proposals, human decisions, execution evidence, and review receipts have separate authority. No fixture verdicts enter live reviews.

Directory groupings are provisional. Static imports indicate possible relevance. Agent-proposed semantic connections carry a reason and source anchors. A source explanation or model judgment cannot become an executed assertion.

A producer package stays pending until the human applies or dismisses it. Property definitions require explicit human confirmation for behavioral review. Source review can proceed with acknowledged gaps. Every applied finding needs a human disposition and rationale.

The document digest binds the intent, component model, relationships, properties, evidence IDs, findings, contribution state, and human decisions. New source commits, changed definitions, or additional evidence invalidate an earlier receipt. Editing a property makes evidence for its previous definition historical.

## Execution and persistence

Source review reads Git objects without checking out branches or executing project code. Verification commands run only through an explicit action. They use either a detached app-owned copy of the candidate or a matching clean working checkout. Commands in the same execution folder cannot overlap.

Each execution artifact retains its arguments, output, exit status, folder, source fingerprints, and explicit property observation records. Failed or stale commands and contradictory judgments create findings. A command exit code remains command-level evidence.

The workspace serializes writes and uses atomic file replacement. Human actions carry an expected document version. Producer artifacts, previous document versions, execution artifacts, and receipts remain separate JSON files. The CLI sends writes through the running server to preserve the single writer.

The app binds to `127.0.0.1`, validates Host and Origin, and requires a per-process token on mutations. It has no package dependencies. Local receipts are review records, not authenticated signatures. Publishing a PR and running integration CI remain outside this service.
