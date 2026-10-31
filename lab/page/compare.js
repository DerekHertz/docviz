// L1 blind side by side. Built from DOM nodes with text content only: card text is model output.
const $ = (s) => document.querySelector(s);
const HEAD = { 'content-type': 'application/json', 'x-docviz-lab': '1' };

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

const WHO = { jev: 'Jev’s layout', claude: 'Claude’s own layout' };

function card(p, side) {
  const c = p[side];
  const img = h('img', { src: `/api/compare/image/${p.id}/${side}`, alt: `Card ${side.toUpperCase()} diagram`, loading: 'lazy' });
  const frame = h('div', { class: 'shot cmp-shot' }, h('div', { class: 'frame' }, img));
  img.addEventListener('error', () => frame.replaceChildren(h('div', { class: 'noimg' }, 'This diagram did not render')));
  return h('div', { class: 'panel cmp-card' },
    h('div', { class: 'row' }, h('strong', {}, `Card ${side.toUpperCase()}`), h('span', { class: 'muted' }, c.title),
      p.reveal ? h('span', { class: `chip ${p.reveal[side] === 'jev' ? 'warn' : 'plain'}` }, `${WHO[p.reveal[side]]} · ${c.kind}`) : null),
    frame,
    h('p', {}, c.caption));
}

function pair(p) {
  const note = h('input', { type: 'text', placeholder: 'Why (optional)', class: 'cmp-note' });
  const vote = async (choice) => {
    const r = await fetch('/api/compare/vote', { method: 'POST', headers: HEAD, body: JSON.stringify({ id: p.id, choice, note: note.value }) }).then((x) => x.json());
    Object.assign(p, { vote: r.vote, reveal: r.reveal });
    render();
  };
  const t = p.reveal?.timing;
  return h('section', { class: 'cmp-pair' },
    h('div', { class: 'row' }, h('strong', {}, p.heading), h('a', { href: p.source.url, target: '_blank', rel: 'noopener' }, 'section source')),
    h('div', { class: 'cmp-grid' }, card(p, 'a'), card(p, 'b')),
    p.vote
      ? h('p', { class: 'muted' }, `You chose ${p.vote.choice === 'tie' ? 'a tie' : `Card ${p.vote.choice.toUpperCase()} (${WHO[p.vote.preferred]})`}.`,
        t ? ` Claude alone: ${(t.freeMs / 1000).toFixed(1)} s; Jev pick ${t.jevMs} ms + Claude ${(t.fixedMs / 1000).toFixed(1)} s.` : '')
      : h('div', { class: 'row' }, h('button', { onclick: () => vote('a') }, 'A explains it better'), h('button', { onclick: () => vote('tie') }, 'Tie'),
        h('button', { onclick: () => vote('b') }, 'B explains it better'), note));
}

let data;
function render() {
  const voted = data.cards.filter((p) => p.vote);
  const jevOrTie = voted.filter((p) => p.vote.preferred !== 'claude').length;
  $('#main').replaceChildren(
    h('div', { class: 'panel' },
      h('strong', {}, `${voted.length} of ${data.cards.length} compared`),
      h('span', { class: 'muted' }, voted.length ? ` · Jev’s layout preferred or tied in ${jevOrTie} of ${voted.length}. Bar, committed before the run: ≥ 7 of 10.` : ' · Bar, committed before the run: Jev’s layout preferred or tied in ≥ 7 of 10.')),
    ...data.cards.map(pair));
}

fetch('/api/compare').then((r) => r.json()).then((d) => {
  if (d.error) { $('#main').replaceChildren(h('p', { class: 'chip warn' }, d.error)); return; }
  data = d;
  render();
});
