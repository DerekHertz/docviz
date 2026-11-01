// A repo with one model whose "TLC" is a fake statechart: the spec carries the report and chart
// the fake writes, so base and head can differ without Java. Shared by the behavior and pr tests.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const FAKE = `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2), out = a[a.indexOf('--out') + 1];
const spec = fs.readFileSync(a[0], 'utf8');
const fake = JSON.parse(spec.match(/FAKE: (.*)/)[1]);
if (fake.exit === 2) { console.error('TLC: parse error in ' + path.basename(a[0])); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'report.md'), fake.report);
if (fake.chart) fs.writeFileSync(path.join(out, 'chart.mmd'), fake.chart);
process.exit(fake.exit);
`;

export function fakeStatechart() {
  const bin = mkdtempSync(join(tmpdir(), 'fake-sc-'));
  writeFileSync(join(bin, 'statechart'), FAKE);
  chmodSync(join(bin, 'statechart'), 0o755);
  writeFileSync(join(bin, 'package.json'), '{"type":"commonjs"}');
  return join(bin, 'statechart');
}

export const fakeSpec = (fake) => `---- MODULE Door ----\n\\* FAKE: ${JSON.stringify(fake)}\n====\n`;
export const fakeChart = (extra = '') => `stateDiagram-v2\n  s0: shut\n  s1: open\n  [*] --> s0\n  s0 --> s1: you open it\n  s1 --> s0: you shut it\n${extra}`;

/** The base commit: rules.md with one rule, a door model covering src/door.js, and src/other.js no model covers. */
export function fakeRepo() {
  const statechart = fakeStatechart();
  const repo = mkdtempSync(join(tmpdir(), 'beh-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  const put = (p, text) => { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), text); };
  git('init', '-q');
  put('.atlas/rules.md', '## Shut\nThe door shuts.\n');
  put('.atlas/models/door/model.json', JSON.stringify({ spec: 'Door.tla', config: 'Door.cfg', view: 'view.mjs', code: ['src/door.js'],
    steps: [{ action: 'Open', label: 'You open the door.', sources: [{ path: 'src/door.js', from: 'function open', to: 'function shut' }] }] }));
  put('.atlas/models/door/Door.cfg', 'INIT Init\nNEXT Next\nINVARIANT Shut\n');
  put('.atlas/models/door/view.mjs', 'export const state = (v) => v.door;\n');
  put('.atlas/models/door/Door.tla', fakeSpec({ exit: 0, report: '# Door\n\n## Rules that hold\nShut, NoDeadlock\n', chart: fakeChart() }));
  put('src/door.js', 'function open() {}\nfunction shut() {}\n');
  put('src/other.js', 'x\n');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  return { repo, git, put, spec: fakeSpec, chart: fakeChart, base, statechart, tools: { statechart, env: process.env } };
}
