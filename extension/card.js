// One card, rendered inside an extension iframe. All state lives in the
// service worker; this page re-reads its record whenever it changes.
import { KINDS, money } from './settings.js';

const params = new URLSearchParams(location.search);
const key = params.get('key');
// The expanded copy of a card lives in a page-wide overlay; same record, more room.
const full = params.get('full') === '1';
document.body.classList.toggle('full', full);
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children);
  return n;
};

let rec = null;
let settings = null;
let caps = null;
let zoom = 0; // 0 = fit (expanded view only), else a scale factor
let pictureUrl = { id: '', url: '' };
let revealed = false;
let renderedSig = '';
let repairTried = false;
let renderSeq = 0;

const dark = matchMedia('(prefers-color-scheme: dark)').matches;
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: dark ? 'dark' : 'base',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  themeVariables: dark ? { fontSize: '14px' } : {
    fontSize: '14px',
    primaryColor: '#faece7',
    primaryTextColor: '#1f1e1d',
    primaryBorderColor: '#c96442',
    lineColor: '#6b6a65',
    secondaryColor: '#f1efe8',
    tertiaryColor: '#f6f5f1',
    noteBkgColor: '#fdf6e3',
    noteBorderColor: '#d8c9a3',
  },
});

async function send(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, key, ...payload });
  if (!res?.ok) throw new Error(res?.error || 'docviz is not responding');
  return res.value;
}

// ---------- sizing ----------

function reportHeight() {
  if (full) return;
  const h = $('card').getBoundingClientRect().height + 2;
  parent.postMessage({ docviz: 'resize', key, height: h }, '*');
}
// Chrome throttles rendering in off-screen iframes, so the observer alone can
// miss the first layout; render paths also report explicitly.
new ResizeObserver(reportHeight).observe($('card'));

// ---------- rendering ----------

async function load() {
  const value = await send('card:get');
  rec = value.rec;
  settings = value.settings;
  caps = value.caps;
  render();
}

function render() {
  if (!rec) {
    $('title').textContent = 'This card has expired';
    $('body').replaceChildren();
    $('actions').hidden = true;
    return;
  }
  const spec = rec.spec;
  $('kind').textContent = rec.view === 'explore' ? 'simulation' : spec?.kind || '…';
  $('title').textContent = rec.view === 'explore' && rec.explore ? rec.explore.title : spec?.title || rec.section.heading;
  $('caption').textContent = rec.view === 'explore' ? '' : spec?.caption || '';
  renderNote();
  renderError();
  renderCost();
  renderPicture();

  const loading = rec.status === 'loading';
  $('actions').setAttribute('aria-disabled', String(loading || !spec));
  const toggle = $('toggle-view');
  toggle.textContent = rec.view === 'explore' ? '◂ Diagram' : rec.explore ? 'Simulation ▸' : 'Explore ▸';
  toggle.className = spec?.interactive || rec.view === 'explore' ? 'primary' : '';
  toggle.title = spec?.interactive ? 'This one behaves differently as parameters change — try the simulation' : 'Build an interactive simulation (1–3 min)';

  if (loading) {
    renderedSig = '';
    $('meta').hidden = true;
    $('body').className = 'body';
    $('body').replaceChildren(el('div', { className: 'loading' }, el('div', { className: 'spinner' }), el('span', { textContent: rec.loadingText || 'Working…' })));
    return;
  }
  if (!spec) {
    $('body').replaceChildren();
    return;
  }
  const sig = `${rec.view}|${spec.mermaid}|${rec.explore?.html?.length || 0}`;
  if (sig !== renderedSig) {
    renderedSig = sig;
    if (rec.view === 'explore' && rec.explore) renderExplore(rec.explore);
    else renderDiagram(spec.mermaid);
  }
  renderThink();
  reportHeight();
}

function renderCost() {
  const c = rec.cost;
  const chip = $('cost');
  chip.hidden = !c;
  if (!c) { $('costs').hidden = true; return; }
  chip.textContent = money(c.usd, c.estimated);
  const rows = c.items.map((i) => el('tr', {},
    el('td', { textContent: `${i.what}${i.provider ? ` · ${i.provider}` : ''}${i.tokens ? ` · ${i.tokens.toLocaleString()} tok` : ''}` }),
    el('td', { textContent: money(i.usd, i.estimated) })));
  rows.push(el('tr', { className: 'total' }, el('td', { textContent: 'This card' }), el('td', { textContent: money(c.usd, c.estimated) })));
  $('costs').replaceChildren(el('table', {}, ...rows), el('p', {
    textContent: (c.estimated ? '~ = estimated from Codex token counts. ' : '') +
      'API-equivalent price; on a Claude or ChatGPT subscription this comes out of your plan’s usage instead of a bill.',
  }));
}

async function renderPicture() {
  const box = $('picture');
  const p = rec.picture;
  $('paint').hidden = !caps?.pictures || !rec.spec || rec.view === 'explore' || !!p;
  if (!p || rec.view === 'explore') { box.hidden = true; return; }
  box.hidden = false;
  if (p.status === 'loading') {
    box.replaceChildren(el('div', { className: 'spinner' }), el('span', { textContent: 'Codex is painting a picture… (about a minute)' }));
  } else if (p.status === 'error') {
    const retry = el('button', { textContent: 'Try again' });
    retry.onclick = () => send('card:picture');
    box.replaceChildren(el('span', { textContent: p.error }), retry);
  } else if (pictureUrl.id !== p.imageId) {
    // The helper wants the pairing code, which an <img src> can't send.
    try {
      const res = await fetch(`${settings.helperUrl}/v1/image/${p.imageId}`, { headers: { 'x-docviz-token': settings.token } });
      if (!res.ok) throw new Error();
      URL.revokeObjectURL(pictureUrl.url);
      pictureUrl = { id: p.imageId, url: URL.createObjectURL(await res.blob()) };
    } catch {
      box.replaceChildren(el('span', { textContent: 'Picture unavailable — is the helper running?' }));
      return;
    }
  }
  if (p.status === 'ready' && pictureUrl.id === p.imageId) {
    const img = el('img', { src: pictureUrl.url, alt: rec.spec?.picture || '' });
    img.onload = reportHeight;
    // Pictures carry labels; give them room.
    if (!full) img.onclick = () => parent.postMessage({ docviz: 'expand', key }, '*');
    img.title = full ? '' : 'Click to expand';
    box.replaceChildren(img);
  }
  reportHeight();
}

function renderNote() {
  const c = settings.lastPrefChange;
  const note = $('note');
  if (!c || c.key !== key) { note.hidden = true; return; }
  const undo = el('button', { textContent: 'Undo' });
  undo.onclick = () => send('prefs:undo');
  note.replaceChildren(el('span', { textContent: `Noted — ${c.field} → ${c.to} for future cards.` }), undo);
  note.hidden = false;
}

function renderError() {
  const box = $('error');
  if (!rec.error) { box.hidden = true; return; }
  const btn = el('button', { textContent: rec.spec ? 'OK' : 'Retry' });
  btn.onclick = () => (rec.spec ? (box.hidden = true) : send('card:retry'));
  box.replaceChildren(el('span', { textContent: rec.error }), btn);
  box.hidden = false;
}

function renderThink() {
  const body = $('body');
  body.querySelector('.think')?.remove();
  const ask = settings.prefs.thinkFirst && rec.spec?.question && !revealed && rec.view !== 'explore';
  body.classList.toggle('blurred', !!ask);
  if (!ask) return;
  const reveal = el('button', { className: 'primary', textContent: 'Reveal diagram' });
  reveal.onclick = () => { revealed = true; renderThink(); };
  body.prepend(el('div', { className: 'think' },
    el('span', { className: 'muted', textContent: 'Think first' }),
    el('p', { textContent: rec.spec.question }),
    reveal));
}

async function renderDiagram(src) {
  const seq = ++renderSeq;
  const body = $('body');
  $('meta').hidden = true;
  try {
    await mermaid.parse(src);
    const { svg } = await mermaid.render(`dv-${key}-${seq}`, src);
    if (seq !== renderSeq) return;
    body.innerHTML = svg;
    applyZoom();
  } catch (e) {
    if (seq !== renderSeq) return;
    const message = String(e?.message || e).slice(0, 600);
    if (!repairTried) {
      // One round-trip to the model with the parser error, then give up gracefully.
      repairTried = true;
      body.replaceChildren(el('div', { className: 'loading' }, el('div', { className: 'spinner' }), el('span', { textContent: 'Fixing diagram syntax…' })));
      try {
        const fixed = await send('card:repair', { mermaid: src, error: message });
        await send('card:fix', { mermaid: fixed });
        return;
      } catch {}
    }
    body.replaceChildren(
      el('p', { className: 'muted', textContent: 'The diagram didn’t parse, so here is its source:' }),
      el('pre', { className: 'source', textContent: src }),
    );
  }
  renderThink();
  reportHeight();
}

function renderExplore(ex) {
  const body = $('body');
  const frame = el('iframe', { className: 'sim', src: 'sandbox.html', title: ex.title });
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.addEventListener('load', () => frame.contentWindow.postMessage({ html: ex.html }, '*'), { once: true });
  simFrame = frame;
  body.replaceChildren(
    el('div', { className: 'sim-banner' },
      el('b', { textContent: 'Simulated' }),
      document.createTextNode(' from the docs and sources below — not the real library. Check the assumptions.')),
    frame,
  );

  const meta = $('meta');
  const list = (items, map) => el('ul', {}, ...items.map(map));
  const blocks = [];
  if (ex.knobs?.length) blocks.push(el('div', {}, el('h2', { textContent: 'Knobs' }), list(ex.knobs, (k) => el('li', {}, el('code', { textContent: k })))));
  if (ex.assumptions?.length) blocks.push(el('div', {}, el('h2', { textContent: 'Assumptions' }), list(ex.assumptions, (a) => el('li', { textContent: a }))));
  const sources = (ex.sources || []).filter((s) => /^https?:\/\//.test(s.url));
  blocks.push(el('div', {}, el('h2', { textContent: 'Sources' }), sources.length
    ? list(sources, (s) => el('li', {}, el('a', { href: s.url, target: '_blank', rel: 'noopener', textContent: s.title || s.url })))
    : el('p', { className: 'muted', textContent: 'None cited — treat this simulation with extra suspicion.' })));
  meta.replaceChildren(...blocks);
  meta.hidden = false;
  reportHeight();
}

// The sandbox reports its content height; it has an opaque origin, so match on the window.
let simFrame = null;
addEventListener('message', (e) => {
  if (simFrame && e.source === simFrame.contentWindow && typeof e.data?.docvizHeight === 'number') {
    simFrame.style.height = `${Math.max(220, Math.min(900, e.data.docvizHeight + 4))}px`;
  }
});

function applyZoom() {
  const body = $('body');
  const svg = body.querySelector('svg');
  body.classList.toggle('fit', full && !zoom);
  if (!svg || !full) return;
  if (!zoom) { svg.style.width = ''; return; }
  const natural = svg.viewBox.baseVal?.width || svg.getBoundingClientRect().width;
  svg.style.width = `${Math.round(natural * zoom)}px`;
  svg.style.height = 'auto';
}

// ---------- actions ----------

$('expand').textContent = full ? '⤡' : '⤢';
$('expand').title = full ? 'Close (Esc)' : 'Expand';
$('expand').onclick = () => parent.postMessage({ docviz: full ? 'collapse' : 'expand', key }, '*');
$('dismiss').hidden = full;
if (full) {
  // Picture beside the diagram, so the diagram gets the full height.
  const stage = el('div', { className: 'stage' });
  $('body').before(stage);
  stage.append($('picture'), $('body'));
}
$('zoom').hidden = !full;
if (full) {
  // The overlay iframe has focus, so Escape arrives here rather than on the page.
  addEventListener('keydown', (e) => { if (e.key === 'Escape') parent.postMessage({ docviz: 'collapse', key }, '*'); });
  for (const b of document.querySelectorAll('[data-zoom]')) {
    b.onclick = () => {
      const d = Number(b.dataset.zoom);
      zoom = d === 0 ? 0 : Math.max(0.5, Math.min(4, (zoom || 1) * (d > 0 ? 1.25 : 0.8)));
      applyZoom();
    };
  }
}

$('cost').onclick = () => { $('costs').hidden = !$('costs').hidden; reportHeight(); };
$('paint').onclick = () => send('card:picture');

for (const btn of document.querySelectorAll('[data-direction]')) {
  btn.onclick = () => { repairTried = false; revealed = false; send('card:adjust', { direction: btn.dataset.direction }); };
}

const kindSelect = $('kind-select');
for (const k of KINDS) kindSelect.append(el('option', { value: k, textContent: k }));
kindSelect.onchange = () => {
  const kind = kindSelect.value;
  kindSelect.value = '';
  if (kind) { repairTried = false; send('card:adjust', { kind }); }
};

$('toggle-view').onclick = () => {
  if (rec.view === 'explore') send('card:view', { view: 'diagram' });
  else if (rec.explore) send('card:view', { view: 'explore' });
  else send('card:explore');
};

$('dismiss').onclick = () => send('card:dismiss');

chrome.runtime.onMessage.addListener((msg) => {
  if ((msg.type === 'card:updated' && msg.key === key) || msg.type === 'prefs:updated') load();
});

load();
