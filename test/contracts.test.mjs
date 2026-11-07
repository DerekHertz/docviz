// helper/contracts.js: what counts as evidence for a contract, and what never does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { contractFindings, digest, harnessDigest, isExecuted, judge, loadProfile, parseProfile, runHarness } from '../helper/contracts.js';
import { verdict } from '../helper/verdict.js';

const [contract] = parseProfile(readFileSync('test/fixtures/contracts/card-spend.json', 'utf8'));

function repoWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docviz-contracts-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q'); g('config', 'user.email', 't@example.test'); g('config', 'user.name', 't');
  for (const [p, text] of Object.entries(files)) { mkdirSync(join(dir, dirname(p)), { recursive: true }); writeFileSync(join(dir, p), text); }
  g('add', '-A'); g('commit', '-qm', 'x');
  const head = g('rev-parse', 'HEAD').trim();
  return { gitRaw: (...a) => g(...a), gitBuffer: (...a) => execFileSync('git', a, { cwd: dir }), binding: { repositoryRoot: head, base: 'b'.repeat(40), head } };
}
// Every top-level extension file, so the side panel's page, modules and manifest entry are the committed ones.
const extension = () => ({ 'package.json': '{ "type": "module" }\n',
  ...Object.fromEntries(readdirSync('extension', { withFileTypes: true }).filter((d) => d.isFile()).map((d) => [`extension/${d.name}`, readFileSync(join('extension', d.name), 'utf8')])) });

const target = repoWith(extension());
const executed = runHarness(contract, target);
const facts = (over = {}) => ({
  binding: target.binding, changedPaths: ['extension/background.js'],
  anchors: [{ id: 'dismiss', path: 'extension/background.js', start: 10, end: 20 }], governing: [{ path: 'CLAUDE.md', resolved: true }],
  cuts: [], evidence: executed, currentHarness: harnessDigest('card-spend'), ...over,
});
const status = (o) => [o.status, o.reason];

test('the runner’s own record of this code is executed evidence of the late-return gap', () => {
  assert.ok(isExecuted(executed));
  assert.equal(executed.outcome, 'fails', executed.detail);
  assert.deepEqual(status(judge(contract, facts())), ['violated', 'executed-fails']);
});

test('a copied or forged record is reported, never a pass or a violation, even with a recomputed digest', () => {
  for (const outcome of ['holds', 'fails']) {
    const { id, ...payload } = JSON.parse(JSON.stringify(executed));
    const forged = { ...payload, outcome, id: digest({ ...payload, outcome }) };
    const o = judge(contract, facts({ evidence: forged }));
    assert.deepEqual(status(o), ['unverified', 'reported-only'], outcome);
    assert.equal(o.evidence.provenance, 'reported');
  }
});

test('evidence bound to another repository, head, base, definition or harness is stale', () => {
  const b = target.binding;
  assert.deepEqual(status(judge(contract, facts({ binding: { ...b, repositoryRoot: 'c'.repeat(40) } }))), ['stale', 'other-repository']);
  assert.deepEqual(status(judge(contract, facts({ binding: { ...b, head: 'd'.repeat(40) } }))), ['stale', 'other-head']);
  assert.deepEqual(status(judge(contract, facts({ binding: { ...b, base: 'e'.repeat(40) } }))), ['stale', 'other-base']);
  assert.deepEqual(status(judge({ ...contract, expectation: 'The ledger records it' }, facts())), ['stale', 'definition-changed']);
  assert.deepEqual(status(judge(contract, facts({ currentHarness: 'f'.repeat(64) }))), ['stale', 'harness-changed']);
});

test('each obligation records the harness its contract selected, so a stored record can be checked against it', () => {
  assert.deepEqual(judge(contract, facts()).check, { harness: 'card-spend', digest: harnessDigest('card-spend') });
  const { check: _, ...unchecked } = contract;
  assert.equal(judge(unchecked, facts({ evidence: null, currentHarness: null })).check, null);
});

test('evidence for another contract checks nothing here', () => {
  const other = { ...contract, id: 'something-else' };
  assert.deepEqual(status(judge(other, facts())), ['unverified', 'unrelated-evidence']);
});

test('no evidence, no harness, or no base is uncertainty, never a violation', () => {
  assert.deepEqual(status(judge(contract, facts({ evidence: null }))), ['unverified', 'not-trusted']);
  assert.deepEqual(status(judge(contract, facts({ evidence: null, noRun: 'trust-other-head' }))), ['unverified', 'trust-other-head']);
  const { check, ...unchecked } = contract;
  assert.deepEqual(status(judge(unchecked, facts({ evidence: null }))), ['unverified', 'no-harness']);
  const noBase = judge(contract, facts({ evidence: null, binding: { ...target.binding, base: null } }));
  assert.deepEqual([...status(noBase), noBase.applicability.applies], ['unverified', 'not-trusted', null]);
});

test('code the harness can’t drive, or a harness that breaks, is uncertainty', () => {
  const files = extension();
  delete files['extension/sidepanel.js'];
  const bare = repoWith(files);
  const inapplicable = runHarness(contract, bare);
  assert.equal(inapplicable.outcome, 'inapplicable');
  assert.deepEqual(status(judge(contract, facts({ binding: bare.binding, evidence: inapplicable }))), ['unverified', 'surface-missing']);
  const broken = repoWith({ ...extension(), 'extension/background.js': 'throw new Error("boom")\n' });
  const error = runHarness(contract, broken);
  assert.equal(error.outcome, 'error');
  assert.deepEqual(status(judge(contract, facts({ binding: broken.binding, evidence: error }))), ['unverified', 'harness-error']);
});

// The reviewed code runs with execution trust, but what it says about itself is not evidence.
const withPrefix = (prefix) => { const files = extension(); files['extension/background.js'] = prefix + files['extension/background.js']; return repoWith(files); };

test('reviewed code that prints a passing result and exits while it loads is a harness error, never a pass', () => {
  const repo = withPrefix(`process.stdout.write(JSON.stringify({ outcome: 'holds', observed: {}, path: [], scope: 'self-reported', detail: 'self-reported by the reviewed code' }));\nprocess.exit(0);\n`);
  const forged = runHarness(contract, repo);
  assert.equal(forged.outcome, 'error', forged.detail);
  assert.doesNotMatch(forged.detail, /self-reported/);
  assert.deepEqual(status(judge(contract, facts({ binding: repo.binding, evidence: forged }))), ['unverified', 'harness-error']);
});

test('reviewed code that rewrites the harness’s report from inside its own process can’t change what docviz observed', () => {
  const rewrite = `const write = process.stdout.write.bind(process.stdout);\nprocess.stdout.write = (s, ...a) => write(String(s).replace('"outcome":"fails"', '"outcome":"holds"'), ...a);\n`;
  const r = runHarness(contract, withPrefix(rewrite));
  assert.equal(r.outcome, 'fails', r.detail);
  assert.equal(r.observed.unattributed, 1);
});

test('reviewed code that patches the globals a harness would compute with can’t change the observed totals', () => {
  const patch = `Array.prototype.reduce = function () { return 2; };\nJSON.stringify = ((s) => (v, ...a) => s(v && typeof v === 'object' && 'outcome' in v ? { ...v, outcome: 'holds' } : v, ...a))(JSON.stringify);\n`;
  const r = runHarness(contract, withPrefix(patch));
  assert.equal(r.outcome, 'fails', r.detail);
  assert.deepEqual([r.observed.chargedBeforeDismiss, r.observed.pageTotalAfter, r.observed.unattributed], [1, 0, 1]);
});

const withPage = (expr) => { const files = extension(); files['extension/sidepanel.js'] = files['extension/sidepanel.js'].replace(/const page = .*;/, `const page = ${expr};`); return repoWith(files); };

test('a side panel page total that reports its own values over the harness channel is not a form docviz computes, so nothing holds', () => {
  // Root's proof at 33d7a2d: this expression evaluates to 0 but sent totals that read holds. The second never
  // lets the genuine totals follow, so the forged ones are all the controller could read.
  for (const expr of [`(process.send({type:'totals',values:[0,1,1,0,1]}),0)`, `(process.send({type:'totals',values:[0,1,1,0,1]}),(() => { for (;;); })())`]) {
    const r = runHarness(contract, withPage(expr));
    assert.equal(r.outcome, 'inapplicable', `${expr}: ${r.outcome} ${r.detail}`);
    assert.match(r.detail, /page total/);
  }
});

test('a page total with anything beyond the supported sum is uncertainty, never evaluated', () => {
  for (const expr of [
    `cards.reduce((t, c) => t + (c.cost?.usd || 0), state.unassigned || 0) + (globalThis.x = 0)`,
    `cards.reduce((t, c) => t + (c.cost?.usd || 0), state.unassigned || 1)`,
    `cards.reduce((t, c) => c + (t.cost?.usd || 0), state.unassigned || 0)`,
    `state.paid`,
  ]) assert.equal(runHarness(contract, withPage(expr)).outcome, 'inapplicable', expr);
});

test('scope: only the known side panel is supported, so even a benign rewrite of its page total is uncertainty with no totals', () => {
  // Until 2026-11-07 these read `fails` through a source recognizer. A recognizer can't tell which line runs
  // (see the decoy tests), so any side panel other than the inspected one is surface-missing now.
  for (const expr of [`cards.reduce( (sum,card)=>sum + ( card.cost?.usd||0 ),state.unassigned||0 )`, `cards.reduce((t, c) => t + (c.cost?.usd || 0), 0)`]) {
    const r = runHarness(contract, withPage(expr));
    assert.equal(r.outcome, 'inapplicable', `${expr}: ${r.outcome} ${r.detail}`);
    assert.equal(r.observed.frames, undefined, `${expr}: no page totals for a side panel docviz doesn't know`);
  }
});

// The independent final review's decoys (2026-11-07): the late return is charged to the page, but the side panel
// shown in Chrome leaves unassigned spend out, or never receives it.
const fixLateReturn = (src) => {
  const fixed = src
    .replace('    const cur = await getCard(key);\n    // A new diagram', '    const cur = await getCard(key);\n    if (!cur) return unassign(rec.tabId, usage);\n    // A new diagram')
    .replace('    const cur = await getCard(key);\n    if (!cur) return;', '    const cur = await getCard(key);\n    if (!cur) return unassign(rec.tabId, e.usage);')
    .replace('async function dismiss(key) {', 'async function unassign(tabId, usage) {\n  if (!usage) return;\n  const state = await getTab(tabId);\n  state.unassigned = (state.unassigned || 0) + usage.usd;\n  await putTab(tabId, state);\n}\n\nasync function dismiss(key) {');
  assert.equal((fixed.match(/unassign\(/g) || []).length, 3, 'the late-return fix applies to this background.js');
  return fixed;
};
const swap = (files, path, from, to) => {
  assert.ok(files[path]?.includes(from), `${path} has ${from.slice(0, 60)}`);
  files[path] = files[path].replace(from, to);
};
/** A target with the late return fixed in background.js, then `edit` applied to its files. */
const fixedWith = (edit = () => {}) => { const files = extension(); files['extension/background.js'] = fixLateReturn(files['extension/background.js']); edit(files); return repoWith(files); };
const REAL_PAGE = 'const page = cards.reduce((t, c) => t + (c.cost?.usd || 0), state.unassigned || 0);';
const NO_UNASSIGNED = 'const page = cards.reduce((t, c) => t + (c.cost?.usd || 0), 0);';
const totals = (r) => r.observed.frames?.map((f) => f.pageTotal);
const PANEL_GET = '    return { state, cards };\n  },\n  \'panel:breakdown\'';

test('control: the fixed late return, read through the known side panel, holds; the genuine gap fails', () => {
  const fixed = runHarness(contract, fixedWith());
  assert.deepEqual([fixed.outcome, totals(fixed), fixed.observed.unattributed], ['holds', [0, 1, 1, 0, 1], 0], fixed.detail);
  assert.deepEqual([executed.outcome, totals(executed), executed.observed.unattributed], ['fails', [0, 1, 1, 0, 0], 1]);
});

test('pending attribution timers are uncertainty, not a proved accounting violation', () => {
  for (const wait of [
    'await new Promise((r) => setTimeout(r, 200));',
    'await (await import("node:timers/promises")).setTimeout(200);',
  ]) {
    const delayed = fixedWith((f) => swap(f, 'extension/background.js', 'async function unassign(tabId, usage) {', `async function unassign(tabId, usage) { ${wait}`));
    const r = runHarness(contract, delayed);
    assert.equal(r.outcome, 'error', `${wait}: ${r.outcome} ${r.detail}`);
    assert.match(r.detail, /pending.*timer/i);
    assert.equal(r.observed.frames, undefined, 'an incomplete scenario must not animate as a completed counterexample');
    assert.deepEqual(status(judge(contract, facts({ binding: delayed.binding, evidence: r }))), ['unverified', 'harness-error']);
  }
});

test('cancelled and completed timers do not hide the genuine gap or a completed fix', () => {
  const cancelled = runHarness(contract, withPrefix('const cancelled = setTimeout(() => {}, 60_000); clearTimeout(cancelled);\n'));
  assert.equal(cancelled.outcome, 'fails', cancelled.detail);
  const finished = runHarness(contract, fixedWith((f) => swap(f, 'extension/background.js', 'async function unassign(tabId, usage) {', 'async function unassign(tabId, usage) { await new Promise((r) => setTimeout(r, 5));')));
  assert.equal(finished.outcome, 'holds', finished.detail);
});

test('a commented-out or unused copy of the known page total doesn’t make another side panel supported', () => {
  const decoys = {
    comment: (f) => { swap(f, 'extension/sidepanel.js', REAL_PAGE, NO_UNASSIGNED); swap(f, 'extension/sidepanel.js', "  $('empty').hidden = cards.length > 0;\n", `  $('empty').hidden = cards.length > 0;\n  // was: ${REAL_PAGE}\n`); },
    'dead function': (f) => { swap(f, 'extension/sidepanel.js', REAL_PAGE, NO_UNASSIGNED); f['extension/sidepanel.js'] = `function legacyTotal(cards, state) {\n  ${REAL_PAGE}\n  return page;\n}\n${f['extension/sidepanel.js']}`; },
  };
  for (const [name, edit] of Object.entries(decoys)) {
    const r = runHarness(contract, fixedWith(edit));
    assert.equal(r.outcome, 'inapplicable', `${name}: ${r.outcome} ${r.detail}`);
    assert.match(r.detail, /side panel/, name);
    assert.equal(r.observed.frames, undefined, `${name}: no page totals`);
  }
});

test('the page total is what the known side panel computes from panel:get’s reply, not from raw storage', () => {
  const r = runHarness(contract, fixedWith((f) => swap(f, 'extension/background.js', PANEL_GET, "    return { state: { keys: state.keys, status: state.status }, cards };\n  },\n  'panel:breakdown'")));
  assert.deepEqual([r.outcome, totals(r), r.observed.unattributed], ['fails', [0, 1, 1, 0, 0], 1], r.detail);
  assert.equal(r.observed.frames.at(-1).unassigned, 0, 'the frame records what the side panel received');
});

test('a side panel whose page, modules or manifest entry differ from the known one is uncertainty, with no totals', () => {
  const edits = {
    'a module changes Array.prototype.reduce': (f) => { f['extension/prefs-form.js'] = `const __reduce = Array.prototype.reduce;\nArray.prototype.reduce = function (fn) { return __reduce.call(this, fn, 0); };\n${f['extension/prefs-form.js']}`; },
    'settings.js changes': (f) => swap(f, 'extension/settings.js', "return `${estimated ? '~' : ''}$${v}`;", "return '$0.00';"),
    'the page loads another script': (f) => swap(f, 'extension/sidepanel.html', '<script type="module" src="sidepanel.js"></script>', '<script src="extra.js"></script>\n  <script type="module" src="sidepanel.js"></script>'),
    'the manifest names another page': (f) => swap(f, 'extension/manifest.json', '"default_path": "sidepanel.html"', '"default_path": "other.html"'),
    'the stylesheet is missing': (f) => { delete f['extension/ui.css']; },
  };
  for (const [name, edit] of Object.entries(edits)) {
    const r = runHarness(contract, fixedWith(edit));
    assert.equal(r.outcome, 'inapplicable', `${name}: ${r.outcome} ${r.detail}`);
    assert.equal(r.observed.frames, undefined, `${name}: no page totals`);
  }
});

test('a panel:get reply the known side panel can’t read is a harness error, never a total', () => {
  const replies = {
    'no value': '    return undefined;\n',
    'no cards': '    return { state };\n',
    'no state': '    return { cards };\n',
    'cards not a list': '    return { state, cards: Object.fromEntries(cards.map((c) => [c.key, c])) };\n',
    'a card without a section': '    return { state, cards: cards.map((c) => ({ ...c, section: undefined, popover: false })) };\n',
    'unassigned as text': '    return { state: { ...state, unassigned: String(state.unassigned || 0) }, cards };\n',
    'a cost the panel can’t print': '    return { state, cards: cards.map((c) => ({ ...c, cost: c.cost && { ...c.cost, usd: String(c.cost.usd) } })) };\n',
    'an error reply': "    throw new Error('panel unavailable');\n",
  };
  for (const [name, body] of Object.entries(replies)) {
    const r = runHarness(contract, fixedWith((f) => swap(f, 'extension/background.js', PANEL_GET, `${body}  },\n  'panel:breakdown'`)));
    assert.equal(r.outcome, 'error', `${name}: ${r.outcome} ${r.detail}`);
    assert.match(r.detail, /side panel/, name);
  }
});

test('each paid call must move the page total by its usage when it lands, so a panel showing a constant can’t hold', () => {
  // The background's reply is what Chrome's panel would show, so it can say anything. At b13e80a this
  // genuine gap, behind a panel:get that always shows $1 unassigned and no cards, read `holds`.
  const constant = extension();
  swap(constant, 'extension/background.js', PANEL_GET, "    return { state: { keys: [], status: state.status, unassigned: 1 }, cards: [] };\n  },\n  'panel:breakdown'");
  const r = runHarness(contract, repoWith(constant));
  assert.deepEqual([r.outcome, totals(r), r.observed.unattributed], ['fails', [1, 1, 1, 1, 1], 2], r.detail);
  // A page that rises by more than a call's usage shows spend that was never paid: no judgement either way.
  const over = runHarness(contract, fixedWith((f) => swap(f, 'extension/background.js', PANEL_GET, "    return { state: { ...state, unassigned: (state.unassigned || 0) * 3 }, cards };\n  },\n  'panel:breakdown'")));
  assert.equal(over.outcome, 'error', `${over.outcome} ${over.detail}`);
  assert.match(over.detail, /more than/);
});

test('an honest design that keeps a dismissed card’s spend on the page holds; it is not lost', () => {
  // Under the earlier arithmetic (reported − shown before Dismiss − page after) this read `fails`.
  const keep = fixedWith((f) => swap(f, 'extension/background.js', "  state.keys = state.keys.filter((k) => k !== key);\n", "  state.keys = state.keys.filter((k) => k !== key);\n  state.unassigned = (state.unassigned || 0) + (rec.cost?.usd || 0);\n"));
  const r = runHarness(contract, keep);
  assert.deepEqual([r.outcome, totals(r), r.observed.unattributed], ['holds', [0, 1, 1, 1, 2], 0], r.detail);
});

test('reviewed code that answers panel:get over the harness channel itself is a harness error', () => {
  const forge = `process.on('message', (m) => { if (m?.message?.type === 'panel:get') process.send({ type: 'sent', seq: m.seq, ok: true, response: { ok: true, value: { state: { keys: [], unassigned: 2 }, cards: [] } } }); });\n`;
  const r = runHarness(contract, withPrefix(forge));
  assert.equal(r.outcome, 'error', r.detail);
});

test('the known side panel is this repository’s committed one, by content hash and git blob, and part of the harness identity', async () => {
  const { KNOWN_PANELS } = await import('../helper/contracts/card-spend-panel.mjs');
  const { HARNESSES } = await import('../helper/contracts.js');
  assert.ok(HARNESSES['card-spend'].parts.some((p) => p.endsWith('card-spend-panel.mjs')));
  const blobOf = (b) => createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
  const here = KNOWN_PANELS.find((k) => Object.entries(k.files).every(([p, f]) => {
    const b = readFileSync(p);
    return createHash('sha256').update(b).digest('hex') === f.sha256 && blobOf(b) === f.blob;
  }));
  assert.ok(here, 'extension/ at this head is a registered side panel');
  assert.deepEqual(Object.keys(here.files).sort(), ['extension/prefs-form.js', 'extension/settings.js', 'extension/sidepanel.html', 'extension/sidepanel.js', 'extension/ui.css']);
});

test('reviewed background code that sends a result-shaped message or exits mid-scenario is a harness error', () => {
  for (const prefix of [
    `process.send({ outcome: 'holds' });\n`,
    `process.send({ type: 'totals', values: [0, 1, 1, 0, 1] });\n`,
    `const realFetch = globalThis.fetch;\nglobalThis.fetch = (...a) => { setTimeout(() => process.exit(0), 0); return realFetch(...a); };\n`,
  ]) {
    const r = runHarness(contract, withPrefix(prefix));
    assert.equal(r.outcome, 'error', `${prefix}: ${r.detail}`);
  }
});

test('the summary only annotates: citing or dropping steps never changes the status', () => {
  const anchors = [{ id: 'generate', path: 'extension/background.js', start: 1, end: 5 }, { id: 'dismiss', path: 'extension/background.js', start: 10, end: 20 }];
  const cited = judge(contract, facts({ anchors, cuts: [{ path: 'extension/background.js', start: 1, end: 4 }] }));
  const none = judge(contract, facts({ anchors, cuts: [] }));
  assert.deepEqual([cited.summary.cited, cited.summary.omitted], [['generate'], ['dismiss']]);
  assert.deepEqual([none.summary.cited, none.summary.omitted], [[], ['generate', 'dismiss']]);
  assert.equal(cited.status, none.status);
});

test('verdict: a violated contract is Needs you; unverified or stale is Look; held or untouched adds nothing', () => {
  const level = (o) => verdict(contractFindings({ obligations: [o] })).level;
  assert.equal(level(judge(contract, facts())), 'needs');
  assert.equal(level(judge(contract, facts({ evidence: null }))), 'look');
  assert.equal(level(judge(contract, facts({ binding: { ...target.binding, head: 'd'.repeat(40) } }))), 'look');
  assert.equal(level(judge(contract, facts({ changedPaths: ['README.md'] }))), 'nothing');
});

test('a profile can’t grant authority, results, or a command', () => {
  const p = JSON.parse(readFileSync(resolve('test/fixtures/contracts/card-spend.json'), 'utf8'));
  for (const patch of [{ authority: 'human-confirmed' }, { status: 'supported-in-scope' }, { evidence: [] }, { check: { harness: 'card-spend', path: '/bin/sh' } }]) {
    assert.throws(() => parseProfile(JSON.stringify({ ...p, contracts: [{ ...p.contracts[0], ...patch }] })), /contract profile/, JSON.stringify(patch));
  }
});

test('a profile anywhere inside the reviewed checkout is refused, whatever its name or link; outside siblings load', () => {
  const box = mkdtempSync(join(tmpdir(), 'docviz-boundary-'));
  const root = join(box, 'repo');
  const text = readFileSync('test/fixtures/contracts/card-spend.json', 'utf8');
  const put = (p) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); return p; };
  mkdirSync(root);
  const inside = /inside the reviewed checkout/;
  assert.throws(() => loadProfile(put(join(root, 'profile.json')), root), inside, 'plain file inside');
  assert.throws(() => loadProfile(put(join(root, '..profile.json')), root), inside, 'a name starting with .. is still inside');
  assert.throws(() => loadProfile(put(join(root, '..contracts', 'p.json')), root), inside, 'a folder starting with .. is still inside');
  symlinkSync(join(root, 'profile.json'), join(box, 'outside-link.json'));
  assert.throws(() => loadProfile(join(box, 'outside-link.json'), root), inside, 'an outside link to an inside file');
  const outside = put(join(box, 'repo-profiles', 'p.json'));
  symlinkSync(outside, join(root, 'inside-link.json'));
  assert.throws(() => loadProfile(join(root, 'inside-link.json'), root), inside, 'an inside link the author controls, even to an outside file');
  symlinkSync(root, join(box, 'repo-alias'));
  assert.throws(() => loadProfile(join(box, 'repo-alias', 'profile.json'), root), inside, 'the checkout reached through a linked path');
  assert.throws(() => loadProfile(join(root, 'profile.json'), join(box, 'repo-alias')), inside, 'a linked root');
  assert.equal(loadProfile(outside, root).contracts[0].id, 'card-spend-accounting', 'a sibling folder whose name starts with the checkout’s name is outside');
  assert.equal(loadProfile(put(join(box, '..profile.json')), root).contracts[0].id, 'card-spend-accounting', 'a ..-named file beside the checkout is outside');
});

test('the harness records the ledger, card and page total it observed at each action', () => {
  const frames = executed.observed.frames;
  assert.ok(Array.isArray(frames), 'observed.frames is recorded');
  assert.deepEqual(frames.map((f) => f.id), ['before-first-reply', 'after-failed-draw', 'after-retry-request', 'after-dismiss', 'after-late-return']);
  assert.deepEqual(frames.map((f) => f.ledgerPaid), [0, 1, 1, 1, 2]);
  assert.deepEqual(frames.map((f) => f.card.present), [true, true, true, false, false]);
  assert.deepEqual(frames.map((f) => f.card.cost), [null, 1, 1, null, null]);
  assert.deepEqual(frames.map((f) => f.pageTotal), [0, 1, 1, 0, 0]);
  assert.equal(frames[1].card.status, 'error');
  for (const f of frames) assert.ok(typeof f.action === 'string' && f.action, `${f.id} names its action`);
  const last = frames.at(-1);
  assert.deepEqual([executed.observed.ledgerPaid, executed.observed.pageTotalAfter], [last.ledgerPaid, last.pageTotal], 'final fields agree with the last frame');
});

test('recording frames changed the harness identity, so records from the earlier harness read stale', () => {
  const earlier = '7b798249a12a5959c932e0f2f09b70bdc5f66362eb59e237626657d96d899031'; // card-spend.mjs before frames
  assert.notEqual(earlier, harnessDigest('card-spend'));
  assert.equal(executed.harness.digest, harnessDigest('card-spend'));
  assert.deepEqual(status(judge(contract, facts({ currentHarness: earlier }))), ['stale', 'harness-changed']);
});
