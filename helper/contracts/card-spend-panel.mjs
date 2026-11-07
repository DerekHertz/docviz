// The side panels the card-spend harness knows, for helper/contracts/card-spend.mjs. A reviewer
// registers a side panel here after reading every file it loads. Each entry pins that module graph by
// content, and `refreshCards` below is docviz's own copy of what that panel does with the panel:get
// reply. Any other side panel is unsupported. docviz never guesses which line of it runs, and it
// runs none of its code.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const KNOWN_PANELS = [{
  // Every file unchanged since 3d37957 (PR #1's merge): the same git blobs at PR #1's head 8967e5d and
  // at e3366da. Read in full for this registration on 2026-11-07. The older panel (921e385, PR #1's base)
  // shows no costs and is not registered.
  name: 'docviz side panel since 3d37957',
  files: {
    'extension/sidepanel.html': { blob: '21b4b5efd3b7adf1b817d666f8f4f491f361d410', sha256: 'c0dc28118fe9fb3901d70695271fba9cf64dbe457038f4b7895234f79b1edf3a' },
    'extension/sidepanel.js': { blob: '762a14d9efb5cf8b18931a5ed95dd9ef1d53c553', sha256: '0d7f5edc005ed163458c76cfcafdaf03e3ac31eebe0a7fc4a29f106d17ec9934' },
    'extension/settings.js': { blob: '2762c8fce8d37393b069cdf001045db8c2ff095d', sha256: '16b75d902426b293b6020b333fe60630ceed19cdd110eb22cbe58e11ca3c55ae' },
    'extension/prefs-form.js': { blob: '523fbb7453be1525f3917d957499992f583e1060', sha256: '7cef96d96fe052c527e9a8502204a0d478a29fa3dca0126c5a02ade059383c37' },
    'extension/ui.css': { blob: '26fec44ba4fdfe78940027a07fe97b652454f70d', sha256: '119eeb4c15fee47c8af4579656b3f9b4c727cf277b4e90ce155a2cfe7bb565be' },
  },
  page: 'sidepanel.html',
}];

/** The registered side panel in the copied checkout at `root`, or `{ missing }` saying why there is none. */
export function knownPanel(root) {
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(root, 'extension/manifest.json'), 'utf8')); } catch { return { missing: 'extension/manifest.json is absent or not JSON' }; }
  const page = manifest?.side_panel?.default_path;
  const sha = (p) => (existsSync(join(root, p)) ? createHash('sha256').update(readFileSync(join(root, p))).digest('hex') : null);
  const panel = KNOWN_PANELS.find((k) => k.page === page && Object.entries(k.files).every(([p, f]) => sha(p) === f.sha256));
  if (panel) return { panel };
  return { missing: `the side panel (manifest side_panel ${JSON.stringify(page ?? null)}, its page and the modules it loads) is not one docviz has registered, so docviz can’t tell what page total it shows; docviz runs no side-panel code` };
}

// settings.js `money`, as registered.
const money = (usd, estimated) => {
  const v = usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2);
  return `${estimated ? '~' : ''}$${v}`;
};

/**
 * The registered sidepanel.js `refreshCards`, from `send('panel:get', { tabId })`'s reply to the page
 * total it writes to #sp-page. Every property read and call that can throw on the reply is kept in
 * order; DOM writes are left out. Throws where that panel would throw, so its total would not update.
 * `res` is the background's sendResponse value as plain JSON data.
 */
export function refreshCards(res) {
  // send(): `if (!res?.ok) throw …; return res.value;`
  if (!res?.ok) throw new Error(`panel:get answered ${res === undefined ? 'nothing' : 'not ok'}`);
  const { state, cards } = res.value;
  const st = state.status || {};
  if (st.phase === 'working') void `${st.done}/${st.total} ${cards.length}`;
  else if (st.phase === 'done') void `${cards.length}`;
  const rows = cards.map((c) => [
    c.view === 'explore' ? 'sim' : c.spec?.kind || '…',
    c.spec?.title || c.section.heading,
    c.status === 'loading' ? 'working…' : c.popover ? 'selection' : c.section.heading,
    c.cost ? money(c.cost.usd, c.cost.estimated) : '',
  ]);
  void (cards.length > 0);
  const page = cards.reduce((t, c) => t + (c.cost?.usd || 0), state.unassigned || 0);
  const text = money(page, cards.some((c) => c.cost?.estimated));
  return { page, text, state, cards, rows };
}
