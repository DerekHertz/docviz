
## Hand-offs on GitHub

A review that leaves work to do tags the agent who should do it, on the last line of the review:

- `@claude` — code fixes. `.github/workflows/claude.yml` runs Claude Code on the PR branch with the
  owner's login; it reads this file and `SPEC.md`, fixes, runs `npm run check && npm test`, and pushes.
- `@codex` — only if the ChatGPT Codex connector is installed on this repo; otherwise use `@claude`.

List each finding with the file and line it's about. Tag once per review, after all findings, never per
finding, so one round fixes everything. A visual verdict, a CI or `.den/` change, and the merge stay
with the user: say so instead of tagging an agent.
