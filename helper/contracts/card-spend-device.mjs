// Runs in a child process under Node's permission model, beside code from the reviewed checkout, for
// helper/contracts/card-spend.mjs. That code can rewrite anything here, so the controller takes each
// message as the target's effect at the boundary, never as a result.
//   background <root>: loads extension/background.js with chrome.* storage and fetch relayed to the controller.
//   page: evaluates the side panel's page-total expression on the states the controller sends.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [role, root] = process.argv.slice(2);
const send = (m) => process.send(m);
const reason = (e) => String(e?.message || e);

if (role === 'page') {
  process.on('message', (m) => {
    try { send({ type: 'totals', values: m.inputs.map(({ cards, state }) => Function('cards', 'state', `return (${m.expr});`)(cards, state)) }); } catch (e) { send({ type: 'failed', detail: reason(e) }); }
  });
} else {
  let next = 0;
  const pending = new Map();
  const ask = (m) => new Promise((ok) => { const id = ++next; pending.set(id, ok); send({ ...m, id }); });
  const storage = (area) => ({
    get: (keys) => ask({ type: 'storage', area, method: 'get', arg: keys ?? null }),
    async set(values) { await ask({ type: 'storage', area, method: 'set', arg: values }); },
    async remove(keys) { await ask({ type: 'storage', area, method: 'remove', arg: keys }); },
  });
  let listener;
  let background;
  const noop = () => ({ addListener() {} });
  globalThis.chrome = {
    storage: { local: storage('local'), session: storage('session') },
    runtime: { onInstalled: noop(), onStartup: noop(), onMessage: { addListener(fn) { listener = fn; } }, async sendMessage() {}, getPlatformInfo() {} },
    action: { onClicked: noop(), setBadgeText() {}, setBadgeBackgroundColor() {} },
    commands: { onCommand: noop() }, contextMenus: { onClicked: noop(), create() {}, removeAll(cb) { cb?.(); } },
    scripting: { async executeScript() {} }, sidePanel: { async open() {}, async setPanelBehavior() {} },
    tabs: { onUpdated: noop(), onRemoved: noop(), async sendMessage() {} },
  };
  globalThis.setInterval = () => 1;
  globalThis.clearInterval = () => {};
  globalThis.fetch = async () => { const r = await ask({ type: 'fetch' }); return { ok: r.ok, status: r.status, json: async () => r.body }; };

  process.on('message', async (m) => {
    if (m.type === 'reply') { const ok = pending.get(m.id); pending.delete(m.id); ok?.(m.value); return; }
    if (m.type === 'draw') {
      try { await background.visualizeSelection({ id: 1, url: 'https://example.test', title: 'test' }, { text: 'fixture' }); send({ type: 'drawn', seq: m.seq, ok: true }); } catch (e) { send({ type: 'drawn', seq: m.seq, ok: false, detail: reason(e) }); }
      return;
    }
    if (m.type === 'send') {
      let sent = false;
      const done = () => { if (!sent) { sent = true; send({ type: 'sent', seq: m.seq, ok: true }); } };
      try { if (listener(m.message, {}, done) !== true) setTimeout(done, 0); } catch (e) { sent = true; send({ type: 'sent', seq: m.seq, ok: false, detail: reason(e) }); }
    }
  });
  try {
    background = await import(pathToFileURL(join(root, 'extension/background.js')).href);
    send({ type: 'ready', visualizeSelection: typeof background.visualizeSelection === 'function', listener: typeof listener === 'function' });
  } catch (e) {
    send({ type: 'failed', detail: reason(e) });
  }
}
