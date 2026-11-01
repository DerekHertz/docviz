// docviz's own atlas: the card and its money, moved in from prototype/pr1-pipeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readAtlasDir } from '../helper/atlas.js';
import { cut } from '../helper/pr.js';
import { findTools, runModel } from '../helper/behavior.js';

const tools = findTools();

// The dismiss gap (PR #10's fix) is still in extension/background.js, and the model says so.
test('TLC on the card-money model: SpendShows breaks through a late return, BudgetFirst holds', { skip: tools.why && `needs TLC: ${tools.why}` }, async () => {
  const m = readAtlasDir('.').models.find((x) => x.name === 'card-money');
  const run = await runModel(m, 'head', tools);
  assert.equal(run.error, undefined);
  assert.equal(run.title, 'One card and its money');
  assert.ok(run.holds.includes('BudgetFirst'));
  assert.deepEqual(run.breaks.map((b) => b.rule), ['SpendShows']);
  assert.equal(run.breaks[0].path.at(-1), 'the call comes back to no card: dismissed');
  assert.ok(run.states.includes('dismissed, call still out'));
});

test('docviz’s card-money model: its files exist, each step is an action of the spec and links to code', () => {
  const atlas = readAtlasDir('.');
  const m = atlas.models.find((x) => x.name === 'card-money');
  assert.ok(m, 'card-money model');
  assert.equal(m.error, undefined);
  for (const f of [m.spec, m.config, m.view]) assert.ok(m.files[f], `${f} in ${m.dir}`);
  assert.deepEqual(m.rules, ['SpendShows', 'BudgetFirst']);
  assert.ok(m.steps.length >= 6);
  for (const s of m.steps) {
    assert.match(m.files[m.spec], new RegExp(`^${s.action} ==`, 'm'), `${s.action} defined in the spec`);
    assert.ok(s.label && s.sources.length, s.action);
    for (const src of s.sources) {
      assert.ok(m.code.includes(src.path), `${src.path} is in the model's code`);
      cut(readFileSync(src.path, 'utf8'), src.from, src.to);
    }
  }
});
