// The plugin's bin/docviz: Claude Code adds bin/ to PATH, so the launcher must find
// helper/cli.js from its own folder, from any working directory, through a symlink.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const BIN = resolve('bin');
const env = { PATH: `${BIN}:${dirname(process.execPath)}:/usr/bin:/bin` };

function run(cmd, cwd) {
  return spawnSync(cmd, ['--help'], { cwd, env, encoding: 'utf8' });
}

test('bin/docviz is executable and runs the helper by name from PATH', () => {
  accessSync(join(BIN, 'docviz'), constants.X_OK);
  const out = run('docviz', tmpdir());
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /^docviz/);
});

test('bin/docviz works through a symlink in a folder with a space', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'docviz-bin-')), 'my tools');
  mkdirSync(dir);
  symlinkSync(join(BIN, 'docviz'), join(dir, 'docviz'));
  const out = run(join(dir, 'docviz'), dir);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /^docviz/);
});

test('the plugin manifest does not override bin/ and npm keeps its own bin', () => {
  const plugin = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'));
  assert.equal(plugin.bin, undefined);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.bin.docviz, 'helper/cli.js');
});
