---
name: pr-diagram
description: "Draw one diagram of a pull request's main flow and post it as a PR comment with docviz. Use when asked to explain, diagram or document a PR, or after opening a PR whose change a reader should understand without reading the code. You write the diagram; docviz lints it, links each step to its code and has Jev check each label."
---

# Diagram a PR with docviz

You draw the diagram. docviz makes no model call except Jev's step check, so the labels are yours
and are checked against the code they link. Run from the PR's checkout, on its head commit, with the
PR pushed. `docviz` is on PATH when the docviz plugin is installed; otherwise use `node <docviz>/helper/cli.js`.

## Steps

1. Read the rules: `docviz pr --rules` (add `--glossary FILE` if the project has one). Write
   under them, not from memory.
2. Pick 4 to 6 steps of the PR's main flow: what a user or caller sees happen, in order. More than 6
   means merge adjacent steps; the diagram holds at most 6 nodes and one node per step.
3. Write `steps.json`:

   ```json
   { "steps": [
     { "id": "pick", "label": "Pick forums", "changed": true,
       "sources": [{ "path": "src/pick.js", "from": "function pick(", "to": "function rank(" }] }
   ] }
   ```

   - `id`: a plain word, used as the Mermaid node id.
   - `label`: at most 5 plain words. It claims only what its lines show: no "why", no callers, no
     settings the lines do not contain.
   - `changed`: true when this PR adds or changes the step.
   - `sources`: the lines for the step. `from` is a string that starts the excerpt (included), `to`
     a string that ends it (excluded; `""` means the end of the file). Cut tight: Jev reads only these lines.
4. Add `"card": { "caption": "...", "mermaid": "flowchart TD\n ..." }` to the same file. Every node's
   label is its step's label, word for word: `pick["Pick forums"]`. Mark changed steps `:::changed`
   and end with `classDef changed stroke:#d29922,stroke-width:3px`. The caption is two short sentences:
   what changes for the user, then what keeps it safe or cheap.
5. Lint: `docviz pr --lint steps.json`. Each failure is on its own line. Fix the card (or the label,
   or the node) from the lines and lint again. Stop after 2 fixes. If errors remain, tell the user which
   and post nothing.
6. Build the comment: `docviz pr steps.json --pr <PR URL> > comment.md`. With `TYPESAFE_API_KEY` set,
   Jev checks each label against its lines. If a step comes back `⚠ review` or `✗`, the label
   claims more than its lines show: narrow the label or widen the lines, then rebuild. Do not
   rewrite the table by hand.
7. Post it: `gh pr comment <number> --body-file comment.md`. The comment starts with
   `<!-- docviz-pr-diagrams -->`; to update an earlier one, edit it (`gh pr comment --edit-last`)
   instead of adding a second.

## Do not

- Do not call `claude` or `codex` to write the diagram. That is the nested call this skill replaces.
- Do not add a node that is no step, or draw an edge the PR's code does not have. The picture is
  checked only through the step labels.
- Do not set `fill` or `color` in `classDef`. The lint rejects it, and it breaks GitHub's dark theme.
- Do not post when the lint fails or the diagram does not parse.
