// Mermaid → PNG with docviz's own Mermaid build, sized for Jev (280–1568 px a side).
// The lab uses Playwright (a dev dependency); the extension and helper never load this file.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const BUNDLE = join(ROOT, 'extension', 'vendor', 'mermaid.min.js');
const CACHE = join(ROOT, 'lab', '.cache');

let page;
async function tab() {
  if (page) return page;
  const browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1600, height: 1600 } });
  await page.addScriptTag({ path: BUNDLE });
  return page;
}

// Renders run one at a time on the shared tab.
let queue = Promise.resolve();

// `cover` draws an opaque box over that text after rendering: the name stays in the source but
// can't be seen, the way an overlapping shape hides a label.
export function render(mermaidSrc, { theme = 'default', fontSize, cover } = {}) {
  const key = createHash('sha256').update(JSON.stringify([mermaidSrc, theme, fontSize, cover || null])).digest('hex').slice(0, 20);
  const file = join(CACHE, `${key}.png`);
  if (existsSync(file)) return Promise.resolve(readFileSync(file));
  const job = queue.then(async () => {
    const p = await tab();
    await p.evaluate(async ({ src, theme, fontSize, cover }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, themeVariables: fontSize ? { fontSize } : {} });
      const { svg } = await mermaid.render(`d${Date.now()}`, src);
      const bg = theme === 'dark' ? '#1e1e1e' : '#ffffff';
      document.body.style.margin = '0';
      document.body.innerHTML = `<div id="w" style="display:inline-block;padding:16px;background:${bg};box-sizing:border-box">${svg}</div>`;
      const el = document.querySelector('#w svg');
      const box = el.getBoundingClientRect();
      const scale = Math.min(1.5, 1500 / Math.max(box.width, box.height));
      el.style.maxWidth = 'none';
      el.style.width = `${box.width * scale}px`;
      el.style.height = `${box.height * scale}px`;
      const w = document.getElementById('w');
      w.style.minWidth = w.style.minHeight = '290px';
      if (cover) {
        w.style.position = 'relative';
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walk.nextNode()) && !node.data.includes(cover));
        if (!node) throw new Error(`cover: "${cover}" not found in the rendered card`);
        const range = document.createRange();
        range.setStart(node, node.data.indexOf(cover));
        range.setEnd(node, node.data.indexOf(cover) + cover.length);
        const r = range.getBoundingClientRect();
        const o = w.getBoundingClientRect();
        const box = document.createElement('div');
        Object.assign(box.style, { position: 'absolute', left: `${r.left - o.left - 4}px`, top: `${r.top - o.top - 3}px`, width: `${r.width + 8}px`, height: `${r.height + 6}px`, background: '#e9c46a', border: '1px solid #b08a2e', borderRadius: '3px' });
        w.append(box);
      }
    }, { src: mermaidSrc, theme, fontSize, cover }).catch((e) => {
      // A case Mermaid can't draw is a fixture bug, not an evaluator answer: say so plainly.
      const why = e.message.replace(/^page\.evaluate: (Error: )?/, '').split('\n').slice(0, 4).join('\n');
      throw Object.assign(new Error(`Mermaid could not draw this case: ${why}`), { kind: 'render' });
    });
    const png = await p.locator('#w').screenshot();
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, png);
    return png;
  });
  queue = job.catch(() => {});
  return job;
}

export async function closeRenderer() {
  if (page) await page.context().browser().close();
  page = null;
}
