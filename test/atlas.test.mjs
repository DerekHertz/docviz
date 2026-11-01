// `.atlas/` in a reviewed repo: the user's rules and one TLA+ model per stateful module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { parseRules, cfgRules, atlasFrom, readAtlasDir, readAtlasAt, covers, ATLAS } from '../helper/atlas.js';

const RULES = `# Rules

These are mine; agents never edit this file.

## ShipsPaid

An order ships only after it is paid.

## NoKeptMoney
A refunded or cancelled order keeps none of the customer's money.
It is returned the same day.
`;

const MODEL = {
  spec: 'Order.tla', config: 'Order.cfg', view: 'view.mjs', code: ['src/order.js', 'src/pay/'],
  steps: [{ action: 'Ship', label: 'A paid order ships.', sources: [{ path: 'src/order.js', from: 'export function ship', to: 'export function refund' }] }],
};

const files = () => ({
  '.atlas/rules.md': RULES,
  '.atlas/models/order/model.json': JSON.stringify(MODEL),
  '.atlas/models/order/Order.tla': '---- MODULE Order ----\n====\n',
  '.atlas/models/order/Order.cfg': 'INIT Init\nNEXT Next\nINVARIANT ShipsPaid\n',
  '.atlas/models/order/view.mjs': 'export const state = (v) => v.state;\n',
});

test('rules.md: one rule per ## heading, its text word for word', () => {
  assert.deepEqual(parseRules(RULES), { rules: [
    { name: 'ShipsPaid', text: 'An order ships only after it is paid.' },
    { name: 'NoKeptMoney', text: 'A refunded or cancelled order keeps none of the customer\'s money.\nIt is returned the same day.' },
  ], problems: [] });
  assert.deepEqual(parseRules(''), { rules: [], problems: [] });
});

// The user's sentences are never dropped silently: text docviz can't read as a rule is a problem the comment shows.
test('rules.md: prose with no rule heading is a problem, not an empty list', () => {
  assert.deepEqual(parseRules('just prose, no headings\n'), { rules: [],
    problems: ['rules.md: no rule headings, so none of its text is a rule (write `## Name`, one word, above each sentence)'] });
});

test('rules.md: a heading that is not `## Name` (Name one TLA+ word) is a problem naming its line', () => {
  const md = '# Rules\n\n## Spend Shows\nEvery call shows its cost.\n\n### A\nsub\n\n## Budget-First\nx\n\n## OK_1\nfine\n\n# Later\nmore\n';
  const { rules, problems } = parseRules(md);
  assert.deepEqual(rules, [{ name: 'OK_1', text: 'fine' }]);
  assert.deepEqual(problems, [
    'rules.md: line 3 `## Spend Shows` is not a rule heading (## Name, one word)',
    'rules.md: line 6 `### A` is not a rule heading (## Name, one word)',
    'rules.md: line 9 `## Budget-First` is not a rule heading (## Name, one word)',
    'rules.md: line 15 `# Later` is not a rule heading (## Name, one word)',
  ]);
});

test('rules.md: a rule with no sentence, or a name used twice, is a problem', () => {
  const { rules, problems } = parseRules('## A\n\n## B\nfirst\n## B\nsecond\n');
  assert.deepEqual(rules.map((r) => r.name), ['B']);
  assert.deepEqual(problems, ['rules.md: line 1 `## A` has no sentence under it', 'rules.md: line 5 `## B` repeats a rule name; only the first counts']);
});

test('an atlas carries the problems in its rules.md', () => {
  const f = files();
  f['.atlas/rules.md'] = 'Ships only when paid.\n';
  const atlas = atlasFrom(f);
  assert.deepEqual(atlas.rules, []);
  assert.match(atlas.problems[0], /^rules\.md: no rule headings/);
  assert.deepEqual(atlasFrom(files()).problems, []);
});

test('a TLC config names the rules it checks', () => {
  const cfg = 'CONSTANTS Head = TRUE\nINIT Init\nNEXT Next\nINVARIANT SpendShows\nINVARIANTS A B\n  C\nPROPERTY Live\nCONSTRAINT Small\n\\* INVARIANT Commented\n';
  assert.deepEqual(cfgRules(cfg), ['SpendShows', 'A', 'B', 'C', 'Live']);
});

test('an atlas is its rules and its models, each with its files', () => {
  const atlas = atlasFrom(files());
  assert.equal(atlas.rules.length, 2);
  assert.equal(atlas.models.length, 1);
  const [m] = atlas.models;
  assert.equal(m.name, 'order');
  assert.equal(m.dir, '.atlas/models/order');
  assert.equal(m.spec, 'Order.tla');
  assert.deepEqual(m.code, ['src/order.js', 'src/pay/']);
  assert.equal(m.steps[0].action, 'Ship');
  assert.deepEqual(Object.keys(m.files).sort(), ['Order.cfg', 'Order.tla', 'model.json', 'view.mjs']);
  assert.deepEqual(m.rules, ['ShipsPaid']);
});

test('no .atlas/ is null; no rules.md is rules: null; a broken model.json is an error on that model', () => {
  assert.equal(atlasFrom({ 'src/a.js': 'x' }), null);
  const f = files();
  delete f['.atlas/rules.md'];
  f['.atlas/models/bad/model.json'] = '{ nope';
  const atlas = atlasFrom(f);
  assert.equal(atlas.rules, null);
  const bad = atlas.models.find((m) => m.name === 'bad');
  assert.match(bad.error, /model\.json/);
});

// model.json is the repo's text: its shape is checked here, so nothing later trips on it.
test('a model.json of the wrong shape is an error naming the model folder and the field', () => {
  const bad = (json) => {
    const f = files();
    f['.atlas/models/order/model.json'] = typeof json === 'string' ? json : JSON.stringify(json);
    return atlasFrom(f).models[0];
  };
  const err = (json) => bad(json).error;
  const D = '.atlas/models/order/model.json';
  assert.equal(err('null'), `${D}: must be an object, not null`);
  assert.equal(err('[1]'), `${D}: must be an object, not an array`);
  assert.equal(err('"x"'), `${D}: must be an object, not a string`);
  assert.equal(err({ ...MODEL, spec: 3 }), `${D}: \`spec\` must be a file name (a string)`);
  assert.equal(err({ ...MODEL, config: undefined }), `${D}: \`config\` must be a file name (a string)`);
  assert.equal(err({ ...MODEL, view: 1 }), `${D}: \`view\` must be a file name (a string)`);
  assert.equal(err({ ...MODEL, code: 'src/order.js' }), `${D}: \`code\` must be an array of paths (strings)`);
  assert.equal(err({ ...MODEL, code: ['src/a.js', null] }), `${D}: \`code[1]\` must be a path (a string)`);
  assert.equal(err({ ...MODEL, code: undefined }), `${D}: \`code\` must be an array of paths (strings)`);
  assert.equal(err({ ...MODEL, steps: { Ship: {} } }), `${D}: \`steps\` must be an array of { action, label, sources }`);
  assert.equal(err({ ...MODEL, steps: [null] }), `${D}: \`steps[0]\` must be an object { action, label, sources }`);
  const s0 = MODEL.steps[0];
  assert.equal(err({ ...MODEL, steps: [{ ...s0, action: 7 }] }), `${D}: \`steps[0].action\` must be a string`);
  assert.equal(err({ ...MODEL, steps: [{ ...s0, label: null }] }), `${D}: \`steps[0].label\` must be a string`);
  assert.equal(err({ ...MODEL, steps: [{ ...s0, sources: 'src/order.js' }] }), `${D}: \`steps[0].sources\` must be an array of { path, from, to }`);
  assert.equal(err({ ...MODEL, steps: [{ ...s0, sources: [{ path: 'src/order.js', from: 'x' }] }] }), `${D}: \`steps[0].sources[0].to\` must be a string`);
  assert.equal(err({ ...MODEL, steps: [{ ...s0, sources: [7] }] }), `${D}: \`steps[0].sources[0]\` must be an object { path, from, to }`);
  assert.match(err('{ nope'), /^\.atlas\/models\/order\/model\.json: not JSON \(/);
  // A bad model still has the safe shape covers() reads, keeping its code paths when those are valid.
  const m = bad({ ...MODEL, steps: 'oops' });
  assert.deepEqual([m.code, m.steps, m.rules], [MODEL.code, [], []]);
  assert.ok(covers(m, 'src/order.js'));
  assert.ok(!covers(bad('null'), 'src/order.js'));
  assert.equal(bad({ ...MODEL, view: undefined }).error, undefined);
});

test('a model whose files are missing names its folder', () => {
  const f = files();
  delete f['.atlas/models/order/Order.cfg'];
  assert.equal(atlasFrom(f).models[0].error, '.atlas/models/order: model.json names Order.cfg, which isn’t there');
  delete f['.atlas/models/order/model.json'];
  assert.equal(atlasFrom(f).models[0].error, '.atlas/models/order: no model.json');
});

test('a model covers its code paths, a directory prefix, and its own folder', () => {
  const m = atlasFrom(files()).models[0];
  assert.ok(covers(m, 'src/order.js'));
  assert.ok(covers(m, 'src/pay/card.js'));
  assert.ok(covers(m, '.atlas/models/order/Order.tla'));
  assert.ok(!covers(m, 'src/order.jsx'));
  assert.ok(!covers(m, 'src/report.js'));
});

test('the atlas reads the same from a directory and from git at a ref', () => {
  const repo = mkdtempSync(join(tmpdir(), 'atlas-'));
  // readAtlasAt takes git's raw stdout: file text keeps its trailing newline.
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  git('init', '-q');
  for (const [p, text] of Object.entries(files())) {
    mkdirSync(dirname(join(repo, p)), { recursive: true });
    writeFileSync(join(repo, p), text);
  }
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'atlas');
  const sha = git('rev-parse', 'HEAD').trim();
  writeFileSync(join(repo, ATLAS, 'rules.md'), '## Other\nchanged after the commit\n');
  assert.deepEqual(readAtlasAt(git, sha), atlasFrom(files()));
  assert.equal(readAtlasDir(repo).rules[0].name, 'Other');
  assert.equal(readAtlasAt(git, sha).rules[0].name, 'ShipsPaid');
  assert.equal(readAtlasDir(mkdtempSync(join(tmpdir(), 'no-atlas-'))), null);
  // A ref that isn't a commit: docviz's own words, not git's.
  for (const ref of ['no-such-ref', '--output=x']) {
    assert.throws(() => readAtlasAt(git, ref), (e) => e.message === `can’t read .atlas/ at \`${ref}\`: not a commit in this repo`, ref);
  }
});
