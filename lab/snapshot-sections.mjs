#!/usr/bin/env node
// Freezes real doc sections for lab L1 (card layout): each section's heading and text at a
// pinned commit of its public docs repo, fetched with `gh`. Run once; the fixture is committed
// with each section's source, commit and license.   node lab/snapshot-sections.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LAB = new URL('.', import.meta.url).pathname;
const MAX_CHARS = 4000;
const LICENSE = { 'nodejs/node': 'MIT', 'mdn/content': 'CC-BY-SA-2.5', 'reactjs/react.dev': 'CC-BY-4.0', 'kubernetes/website': 'CC-BY-4.0' };

const src = JSON.parse(readFileSync(join(LAB, 'fixtures', 'l1-sections.src.json'), 'utf8'));
const files = new Map();
const raw = (repo, path, sha) => {
  const key = `${repo}/${path}@${sha}`;
  if (!files.has(key)) files.set(key, execFileSync('gh', ['api', `repos/${repo}/contents/${path}?ref=${sha}`, '-H', 'Accept: application/vnd.github.raw'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
  return files.get(key);
};
// Heading text without its anchor ({#id}, {/*id*/}).
const clean = (h) => h.replace(/\{#[^}]*\}|\{\/\*[^}]*\*\/\}/g, '').trim();

const out = src.map((s, i) => {
  const text = raw(s.repo, s.path, s.sha);
  const parts = text.split(/\n(?=#{2,4} )/);
  const at = parts.findIndex((p) => clean(p.split('\n')[0].replace(/^#+ /, '')) === s.heading);
  if (at < 0) throw new Error(`${s.repo}/${s.path}: heading not found: ${s.heading}`);
  const level = parts[at].match(/^#+/)[0].length;
  // The section and its subsections, until the next heading at its level or above.
  let body = parts[at];
  for (let j = at + 1; j < parts.length && parts[j].match(/^#+/)[0].length > level; j++) body += `\n${parts[j]}`;
  body = body.split('\n').slice(1).join('\n').replace(/\{\/\*[^}]*\*\/\}/g, '').trim();
  const cut = body.length > MAX_CHARS ? `${body.slice(0, MAX_CHARS)}\n… (section continues)` : body;
  return {
    id: `s${String(i + 1).padStart(2, '0')}`, heading: s.heading, text: cut,
    source: { repo: s.repo, path: s.path, sha: s.sha, url: `https://github.com/${s.repo}/blob/${s.sha}/${s.path}`, license: LICENSE[s.repo] },
  };
});
writeFileSync(join(LAB, 'fixtures', 'l1-sections.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`${out.length} sections → lab/fixtures/l1-sections.json`);
