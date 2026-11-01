// docviz's own atlas: the card and its money, moved in from prototype/pr1-pipeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readAtlasDir } from '../helper/atlas.js';
import { cut } from '../helper/pr.js';

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
