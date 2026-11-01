// One-hop context for a step check: the definitions of what a step's code calls, so a label
// that describes a helper's job can be checked against that helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calledNames, definitionsCalled } from '../helper/context.js';
import { stepRequest } from '../helper/checks.js';

const repo = {
  'src/a.js': 'import x from "y";\nexport function run(items) {\n  const total = sumUp(items);\n  return save(total);\n}\n',
  'src/b.js': 'export const sumUp = (list) => list.reduce((n, x) => n + x, 0);\n\nexport async function save(n) {\n  await db.put(n);\n  return n;\n}\n',
  'test/b.test.js': 'function save() { /* a test double */ }\n',
  'tools/g.py': 'import re\n\ndef excerpt(line, at):\n    """Quote around at."""\n    if len(line) < 9:\n        return line\n    return line[at:]\n\n\ndef scan(text):\n    m = re.search("x", text)\n    return excerpt(text, m.start())\n',
};
const read = (p) => repo[p];
const files = Object.keys(repo);

test('calledNames lists the functions the code calls: no keywords, built-ins, common methods, strings or its own name', () => {
  assert.deepEqual(calledNames('function run(items) {\n  if (ok(items)) return sumUp(items).map((x) => fmt(x));\n}', 'run'), ['ok', 'sumUp', 'fmt']);
  assert.deepEqual(calledNames('def scan(text):\n    return excerpt(text, len(text))', 'scan'), ['excerpt']);
  assert.deepEqual(calledNames('async function save(env) {\n  const r = await ai.translate(env);\n  console.error(`translation failed (${r})`); // retry(later)\n  setTimeout(go, 1);\n}', 'save'), ['translate']);
});

test('definitions are found for arrow consts and async functions, with their lines, skipping tests', () => {
  const code = 'export function run(items) {\n  const total = sumUp(items);\n  return save(total);\n}';
  const defs = definitionsCalled(code, { files, read, self: 'run', lang: 'js' });
  assert.deepEqual(defs.map((d) => [d.name, d.path, d.start, d.end]), [['sumUp', 'src/b.js', 1, 1], ['save', 'src/b.js', 3, 6]]);
  assert.match(defs[1].text, /await db\.put\(n\);/);
});

test('Python definitions end where the indentation does', () => {
  const defs = definitionsCalled('def scan(text):\n    return excerpt(text, 1)', { files, read, self: 'scan', lang: 'py' });
  assert.deepEqual(defs.map((d) => [d.name, d.start, d.end]), [['excerpt', 3, 7]]);
});

test('context stays inside its budget, and long definitions are cut with a marker', () => {
  const long = { 'src/big.js': `export function big() {\n${'  step();\n'.repeat(80)}}\n` };
  const defs = definitionsCalled('function run() { big(); }', { files: ['src/big.js'], read: (p) => long[p], self: 'run', lang: 'js', maxLines: 10 });
  assert.equal(defs[0].text.split('\n').length, 11);
  assert.match(defs[0].text, /… \(\d+ more lines\)$/);
  const none = definitionsCalled('function run() { big(); }', { files: ['src/big.js'], read: (p) => long[p], self: 'run', lang: 'js', budget: 20 });
  assert.deepEqual(none, []);
});

test('a step request with context asks about the step and shows the called definitions apart', () => {
  const r = stepRequest('Totals and saves', 'CODE', '// src/b.js:1-1\nexport const sumUp = …');
  assert.match(r.state.context, /sumUp/);
  assert.match(r.questions.supported.instructions, /definitions/);
  const plain = stepRequest('Totals and saves', 'CODE');
  assert.equal(plain.state.context, undefined);
});
