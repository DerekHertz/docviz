# Standalone studio validation

Recorded November 6, 2026. This is validation of the local prototype, not approval to merge a new candidate. Live Jev checks and independent merge verification remain pending.

## Executed checks

- Final repository checks: npm run check passed; npm test had 228 passes, 17 skips and no failures across 245 cases. The studio contributes 35 passing cases. Covers exact comparison scopes, capture pairing, source/evidence integrity, cache persistence, immutable historical records, contract/source changes, downstream context, unmapped files, repository/base matching and HTTP/extension boundaries. The new suite includes regressions for delayed Jev responses after a property edit and explicit decisions for reserved object-property names.
- Existing Docviz suite before packaging: 193 passed, 17 skipped, no failures. Historical import caches were isolated. Skips concern unavailable TLC/statechart, rendering tooling and a local private fixture.
- Historical stack PRs #13–15: three regression commands, 43 passing cases, and 12 recorded function captures. Upstream findings are controlled fixtures.
- Docviz #16: 66 passed, 14 skipped, no failures. Actual isolated runPr executions select the decoy checkout at base and requested checkout at candidate, including relative steps/glossary files. Live provider/Jev and trusted-model execution are outside this capture.
- AfterClass #94: actual TypeScript-compiled React static renders at both revisions. Default citation buttons change from three to zero; the explicit shown state renders Sources (1) and Sources (2). Component typecheck and a separately recorded full-project typecheck pass. No Bun suite was run because Bun was unavailable. No real lecture data or live model calls were used.

The documented original-stack preparation and Docviz #16 trial also completed in a separate checkout with a new repository registration. Its baseline ID differs from the original local cache, and the overlay retains five reused descriptions and one changed description. No copied runtime state was needed.

## Browser validation

Computer Use exercised the standalone app at its actual desktop and narrow preview sizes. Checked whole-stack and local layers, review selection, reuse filters with surrounding context, component and connection inspection, pseudocode links to pinned Git blobs, claim expansion, Jev unavailability, raw captures, scenario switching and keyboard checkpoint selection. The user reviewed the new design and found it usable.

![Cached AfterClass review](docs/afterclass-review.png)

## Cache trials

Docviz #16 uses the exact cached tip of the earlier stack. Five descriptions retain source context, one changes, five provide connected context and four changed files are unmapped. AfterClass first receives a source-derived baseline, then PR94 overlays it. Three descriptions are reused, three change, three provide connected context and one changed test file is unmapped. Categories overlap. Map IDs depend on repository registration and content; examples do not pin another machine's ID.

Baseline maps are immutable. Candidate descriptions are proposed updates, separate from fresh claims and evidence. The cached Docviz entry-point anchor was imprecise; the proposed update links directly to runPr and flags its source correspondence for review.

## Open verification

- Jev has no recorded live result. Stack questions/status are inspectable; live checks currently run through workspace properties.
- AfterClass needs live toggle, topic-reset, grouped evidence selection, focus/keyboard, saved-record and uncropped-layout checks. Static rendering proves markup, not interaction or CSS layout.
- The preparing text's usually 20–30 seconds claim has no captured timing measurement.
- Unchanged frame selection and backend citation filtering are source context, not new execution evidence.
- The supplied graphs and manually prepared models do not establish complete repository coverage or automatic modeling of arbitrary repositories.
- The existing verify-docviz skill covers the legacy PR CLI/helper, not this studio UI. Its independent merge verdict remains separate.

Runtime records, checkouts, credentials, CLI transcripts and generated extension bundles are ignored. Existing helper and documentation extension behavior remain available. The studio opens no PRs and merges nothing itself.
