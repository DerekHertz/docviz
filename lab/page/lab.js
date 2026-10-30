// docviz lab page. Everything is built as DOM nodes with text content, never HTML strings:
// case data and evaluator answers are shown, not trusted.
const $ = (sel) => document.querySelector(sel);
const HEAD = { 'content-type': 'application/json', 'x-docviz-lab': '1' };

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const usd = (x) => `$${(x || 0).toFixed(x && x < 0.01 ? 5 : 4)}`;

const state = {
  list: [], id: null, exp: null, results: {}, asking: new Set(),
  t: 0.5, filter: 'all', mutation: '', running: false, overrides: {},
};

async function getJson(path, init) {
  const res = await fetch(path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

// ---------- experiments list ----------

async function loadList() {
  state.list = await getJson('/api/experiments');
  const nav = $('#experiments');
  nav.replaceChildren(h('div', { class: 'muted' }, 'Experiments'), ...state.list.map((e) => h('button', {
    class: e.id === state.id ? 'on' : '',
    'data-id': e.id,
    onclick: () => openExperiment(e.id),
  },
  h('span', { class: 'code' }, `${e.code} · ${e.evaluator}${e.variant ? ` · ${e.variant}` : ''}`),
  h('span', {}, e.title),
  h('span', { class: 'row' }, statusChip(e.verdict, e.decision)))));
  const spent = state.list.reduce((s, e) => s + (e.lastRun?.usd || 0), 0);
  $('#spend').textContent = `last runs: ${usd(spent)}`;
  if (!state.id && state.list[0]) openExperiment(state.list[0].id);
}

function statusChip(verdict, decision) {
  const chips = [];
  if (!verdict) chips.push(h('span', { class: 'chip plain' }, 'not run'));
  else chips.push(h('span', { class: `chip ${verdict.pass ? 'good' : 'bad'}` }, verdict.pass ? 'passes bar' : 'misses bar'));
  if (decision?.verdict) chips.push(h('span', { class: `chip ${decision.verdict === 'adopt' ? 'good' : decision.verdict === 'reject' ? 'bad' : 'warn'}` }, VERDICTS[decision.verdict]));
  return chips;
}

const VERDICTS = { adopt: 'adopted', reject: 'rejected', retry: 'needs a better question' };

// ---------- one experiment ----------

async function openExperiment(id) {
  state.id = id;
  state.exp = await getJson(`/api/experiments/${id}`);
  state.results = Object.fromEntries((state.exp.run?.results || []).map((r) => [r.id, r]));
  state.overrides = { ...(state.exp.decision?.overrides || {}) };
  state.t = state.exp.verdict?.threshold ?? 0.5;
  state.asking.clear();
  for (const b of $('#experiments').querySelectorAll('button')) b.classList.toggle('on', b.dataset.id === id);
  renderMain();
}

function bar() { return { ...state.exp.meta.bar, ...(state.exp.decision?.bar || {}) }; }

const threeWay = () => state.exp?.meta.mode === 'three-way';

// Mirrors decide() in lab/metrics.js: an answer → pass / flag / review.
function verdictOf(r) {
  const rule = state.exp.meta.decide;
  const b = bar();
  if (!r || r.error) return null;
  if (rule.kind === 'bands') {
    if (r.prob == null) return null;
    return r.prob >= b.passAt ? 'pass' : r.prob <= b.flagAt ? 'flag' : 'review';
  }
  if (rule.kind === 'two') {
    if (r.prob == null || r.probContra == null) return null;
    return r.probContra >= b.contradictedAt ? 'flag' : r.prob >= b.supportedAt ? 'pass' : 'review';
  }
  if (!r.choice) return null;
  if (b.minConfidence && (r.confidence ?? 0) < b.minConfidence) return 'review';
  return rule.map[r.choice] || 'review';
}

const THREE = {
  good: { pass: 'ok', flag: 'alarm', review: 'reviewGood' },
  bad: { pass: 'missed', flag: 'caught', review: 'reviewBad' },
  unclear: { pass: 'overconfident', flag: 'heldFlag', review: 'held' },
};

function outcome(c, r, t = state.t) {
  if (state.asking.has(c.id)) return 'asking';
  if (!r) return 'pending';
  if (r.error) return r.kind === 'render' ? 'unrendered' : 'error';
  if (threeWay()) return THREE[c.truth]?.[verdictOf(r)] || 'error';
  const flagged = r.flag >= t;
  if (c.bad) return flagged ? 'caught' : 'missed';
  return flagged ? 'alarm' : 'ok';
}

const OUTCOME = {
  caught: ['good', 'caught'], ok: ['good', 'correctly passed'], missed: ['bad', 'missed'],
  alarm: ['bad', 'false alarm'], reviewGood: ['warn', 'sent to review'], reviewBad: ['good', 'sent to review'],
  held: ['good', 'said can’t tell'], heldFlag: ['warn', 'flagged (can’t tell)'], overconfident: ['bad', 'passed, but can’t tell'],
  error: ['warn', 'Jev error'], unrendered: ['warn', 'card didn’t render'], pending: ['plain', 'not run'], asking: ['plain', 'Jev is looking…'],
};

function renderMain() {
  const { meta } = state.exp;
  const main = $('#main');
  main.replaceChildren(
    h('h1', {}, `${meta.code} · ${meta.title}`),
    h('p', { class: 'lede muted' }, meta.summary),
    testedPanel(),
    controlsPanel(),
    scorePanel(),
    decisionPanel(),
    filtersRow(),
    h('div', { class: 'grid', id: 'grid' }),
  );
  renderGrid();
}

// Everything the experiment varies and holds fixed, in one place, before any result.
function testedPanel() {
  const { meta, kinds } = state.exp;
  const t = meta.tested || {};
  const row = (k, ...v) => h('div', { class: 'trow' }, h('div', { class: 'tk' }, k), h('div', {}, ...v));
  return h('div', { class: 'panel tested' },
    h('strong', {}, 'What’s being tested'),
    row('Evaluator', h('code', {}, meta.evaluator === 'jev' ? 'jev-1.14.0' : meta.evaluator), ' · one request per case'),
    row('Jev is given', (t.given || []).map((g) => h('span', { class: 'chip plain' }, g))),
    row('Jev is asked', h('q', {}, t.asked || ''), h('span', { class: 'muted' }, ' — with a written definition of each answer')),
    row('Left to code', h('ul', { class: 'tight' }, (t.leftToCode || []).map((x) => h('li', {}, x)))),
    row('Decision', t.decision || 'Jev’s answer is a probability. Above the threshold the case is flagged; the threshold is tuned on half the cases and scored on the other half.'),
    row('In docviz', t.real || ''),
    h('table', { class: 'kinds' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Case'), h('th', {}, 'Truth'), h('th', {}, 'How it’s made'), h('th', {}, 'n'))),
      h('tbody', {}, (kinds || []).map((k) => h('tr', {},
        h('td', {}, k.note),
        h('td', {}, h('span', { class: `chip ${{ good: 'good', bad: 'bad', unclear: 'warn' }[k.truth]}` }, { good: 'good', bad: k.injection ? 'broken · injection' : 'broken', unclear: 'can’t tell' }[k.truth])),
        h('td', { class: 'muted' }, k.how),
        h('td', {}, String(k.n)))))));
}

function controlsPanel() {
  const b = bar();
  const field = (key, label, step) => h('label', {}, label, h('input', {
    type: 'number', step, min: 0, value: b[key], 'data-key': key,
  }));
  const run = (only) => runExperiment(only);
  const misses = () => state.exp.cases.filter((c) => ['missed', 'alarm', 'overconfident', 'error', 'unrendered'].includes(outcome(c, state.results[c.id]))).map((c) => c.id);
  return h('div', { class: 'panel' },
    h('div', { class: 'row bar-inputs', id: 'bar' },
      h('strong', {}, 'Pass bar'),
      threeWay()
        ? [field('letThrough', 'broken let through ≤', 0.05), field('wronglyFlagged', 'good flagged ≤', 0.05),
          field('clearReview', 'clear → review ≤', 0.05), field('unclearPassed', 'can’t-tell passed ≤', 0.05),
          { bands: [field('passAt', 'pass at yes ≥', 0.05), field('flagAt', 'flag at yes ≤', 0.05)],
            two: [field('supportedAt', 'shown at ≥', 0.05), field('contradictedAt', 'contradicted at ≥', 0.05)],
            choice: field('minConfidence', 'min confidence', 0.05) }[state.exp.meta.decide.kind]]
        : [field('catch', 'catch ≥', 0.05), field('falseAlarm', 'false alarms ≤', 0.05)],
      field('costPerCard', 'cost/card ≤ $', 0.0005), field('changed', 'decisions changed ≤', 0.01),
      h('button', { onclick: saveBar }, 'Save bar')),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'primary', id: 'run', disabled: state.running, onclick: () => run() }, `Run all ${state.exp.cases.length} cases`),
      h('button', { disabled: state.running, onclick: () => { const ids = [...misses(), ...state.exp.cases.filter((c) => !state.results[c.id]).map((c) => c.id)]; if (ids.length) run(ids); } }, 'Run unanswered, misses and errors'),
      h('span', { class: 'muted', id: 'runStatus' }, state.exp.run ? `last run ${new Date(state.exp.run.at).toLocaleString()} · ${usd(state.exp.run.usd)}` : 'never run')));
}

function liveRates(t) {
  let caught = 0; let bad = 0; let alarms = 0; let good = 0; let done = 0; let spent = 0;
  for (const c of state.exp.cases) {
    const r = state.results[c.id];
    if (!r || r.flag == null) continue;
    done++; spent += r.usage?.usd || 0;
    if (c.bad) { bad++; if (r.flag >= t) caught++; } else { good++; if (r.flag >= t) alarms++; }
  }
  return { catch: bad ? caught / bad : null, falseAlarm: good ? alarms / good : null, caught, bad, alarms, good, done, spent };
}

function stat(k, v, ok, sub) {
  return h('div', { class: `stat ${ok == null ? '' : ok ? 'ok' : 'miss'}` }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), sub && h('div', { class: 'k' }, sub));
}

function scorePanel() {
  const v = state.exp.verdict;
  const b = bar();
  const live = liveRates(state.t);
  const panel = h('div', { class: 'panel', id: 'score' });
  if (v && !state.running && v.mode === 'three-way') {
    const c = v.counts;
    panel.append(
      h('div', { class: 'row' }, h('span', { class: 'verdict' }, v.pass ? 'Passes the bar' : 'Misses the bar'),
        h('span', { class: 'muted' }, `${c.good} good, ${c.bad} broken, ${c.unclear} can’t-tell${c.heldOut ? ` + ${c.heldOut} held out` : ''} (injections scored separately)`)),
      v.misses.length ? h('ul', { class: 'misses' }, v.misses.map((m) => h('li', {}, m))) : null,
      h('div', { class: 'score' },
        stat('broken let through', pct(v.letThrough), v.letThrough <= b.letThrough, 'passed with no review'),
        stat('good wrongly flagged', pct(v.wronglyFlagged), v.wronglyFlagged <= b.wronglyFlagged),
        stat('clear cases sent to review', pct(v.clearReview), v.clearReview <= b.clearReview, 'a person or stronger model looks'),
        v.heldOut
          ? stat('can’t-tell passed · held out', pct(v.heldOut.unclearPassed), v.heldOut.unclearPassed <= b.unclearPassed, `judged on ${c.heldOut} cases never used for tuning; tuning set ${pct(v.unclearPassed)}`)
          : stat('can’t-tell cases passed', pct(v.unclearPassed), v.unclearPassed <= b.unclearPassed, 'forced into “fits”'),
        stat('can’t-tell cases held back', pct((v.heldOut || v).unclearHeld), null, `+ ${pct((v.heldOut || v).unclearFlagged)} flagged${v.heldOut ? ' · held out' : ''}`),
        stat('right when it decided', pct(v.decidedAccuracy), null, `${c.right}/${c.decided} clear cases`),
        stat('injection passed', `${v.leaked.length}`, v.leaked.length === 0),
        stat('Jev cost per card', usd(v.costPerCard), v.costPerCard <= b.costPerCard, `${usd(v.usd)} total`),
        stat('decisions changed since last run', v.changed == null ? 'first run' : pct(v.changed), v.changed == null ? null : v.changed <= b.changed, v.drift == null ? '' : `largest probability move ${v.drift.toFixed(2)}`)));
  } else if (v && !state.running) {
    panel.append(
      h('div', { class: 'row' },
        h('span', { class: `verdict` }, v.pass ? 'Passes the bar' : 'Misses the bar'),
        h('span', { class: 'muted' }, `threshold ${v.threshold.toFixed(2)}, tuned on half the cases and scored on the other half`)),
      v.misses.length ? h('ul', { class: 'misses' }, v.misses.map((m) => h('li', {}, m))) : null,
      h('div', { class: 'score' },
        stat('catch rate (scored half)', v.scored.bad ? pct(v.scored.catch) : '—', v.scored.bad ? v.scored.catch >= b.catch : null, `${v.scored.caught}/${v.scored.bad} broken cases`),
        stat('false alarms (scored half)', v.scored.good ? pct(v.scored.falseAlarm) : '—', v.scored.good ? v.scored.falseAlarm <= b.falseAlarm : null, `${v.scored.alarms}/${v.scored.good} good cases`),
        stat('injection got through', `${v.leaked.length}`, v.leaked.length === 0),
        stat('Jev cost per card', usd(v.costPerCard), v.costPerCard <= b.costPerCard, `${usd(v.usd)} total`),
        stat('decisions changed since last run', v.changed == null ? 'first run' : pct(v.changed), v.changed == null ? null : v.changed <= b.changed, v.drift == null ? '' : `largest probability move ${v.drift.toFixed(2)}`)));
  } else {
    panel.append(h('div', { class: 'row' },
      h('span', { class: 'verdict' }, state.running ? 'Running…' : 'Not run yet'),
      h('span', { class: 'muted' }, `${live.done}/${state.exp.cases.length} answered · ${usd(live.spent)}`)));
  }
  if (live.done) panel.append(calibrationView());
  if (threeWay()) { panel.prepend(compareView()); return panel; }
  if (live.done) panel.append(bandsView());
  panel.append(h('div', { class: 'slider' },
    h('span', {}, 'What-if threshold'),
    h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: state.t, oninput: (e) => { state.t = Number(e.target.value); updateWhatIf(); renderGrid(); } }),
    h('code', { id: 'tval' }, state.t.toFixed(2)),
    h('span', { class: 'muted', id: 'whatif' }, whatIfText(live))));
  return panel;
}

// Every way of asking the same question (same group), side by side.
function compareView() {
  const group = state.list.filter((e) => e.group && e.group === state.exp.meta.group);
  if (group.length < 2) return '';
  const cell = (e, key) => (e.verdict ? pct(e.verdict[key]) : '—');
  return h('table', { class: 'kinds compare' },
    h('thead', {}, h('tr', {}, ['Variant', 'let through', 'good flagged', 'clear → review', 'can’t-tell passed', 'held out: passed', 'right when decided', 'cost/card', 'bar'].map((x) => h('th', {}, x)))),
    h('tbody', {}, group.map((e) => h('tr', { class: e.id === state.id ? 'here' : '' },
      h('td', {}, h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); openExperiment(e.id); } }, e.variant || e.id)),
      ['letThrough', 'wronglyFlagged', 'clearReview', 'unclearPassed'].map((k) => h('td', {}, cell(e, k))),
      h('td', {}, e.verdict?.heldOut ? pct(e.verdict.heldOut.unclearPassed) : '—'),
      h('td', {}, cell(e, 'decidedAccuracy')),
      h('td', {}, e.verdict ? usd(e.verdict.costPerCard) : '—'),
      h('td', {}, e.verdict ? h('span', { class: `chip ${e.verdict.pass ? 'good' : 'bad'}` }, e.verdict.pass ? 'passes' : 'misses') : 'not run')))));
}

function answered() {
  return state.exp.cases.filter((c) => state.results[c.id]?.flag != null && !c.injection && c.bad != null).map((c) => ({ bad: c.bad, flag: state.results[c.id].flag }));
}

// "When Jev was ~X% sure the case was broken, it actually was Y% of the time."
function calibrationView() {
  const n = 5;
  const bins = Array.from({ length: n }, (_, i) => ({ i, n: 0, said: 0, actual: 0 }));
  for (const c of answered()) { const b = bins[Math.min(n - 1, Math.floor(c.flag * n))]; b.n++; b.said += c.flag; b.actual += c.bad ? 1 : 0; }
  return h('div', { class: 'calib' },
    h('div', { class: 'k' }, 'Calibration: when Jev’s answer meant “broken” with this probability, how often was it really broken?'),
    bins.map((b) => h('div', { class: 'crow' },
      h('span', { class: 'muted' }, `${b.i * 20}–${b.i * 20 + 20}%`),
      h('div', { class: 'cbar' },
        b.n ? h('div', { class: 'said', style: { width: `${(b.said / b.n) * 100}%` }, title: `Jev said ${pct(b.said / b.n)}` }) : null,
        b.n ? h('div', { class: 'actual', style: { width: `${(b.actual / b.n) * 100}%` }, title: `actually ${pct(b.actual / b.n)}` }) : null),
      h('span', {}, b.n ? `said ${pct(b.said / b.n)} · actually ${pct(b.actual / b.n)} · ${b.n} cases` : 'no cases'))));
}

// The guide's pattern: act on confident answers, send the middle to a stronger model or a person.
function bandsView() {
  const lo = state.lo ?? 0.2;
  const hi = state.hi ?? 0.8;
  let decided = 0; let right = 0; let review = 0;
  const all = answered();
  for (const c of all) {
    if (c.flag > lo && c.flag < hi) { review++; continue; }
    decided++; if ((c.flag >= hi) === c.bad) right++;
  }
  const num = (key, v) => h('input', { type: 'number', min: 0, max: 1, step: 0.05, value: v, onchange: (e) => { state[key] = Number(e.target.value); $('#score').replaceWith(scorePanel()); } });
  return h('div', { class: 'row bands' },
    h('strong', {}, 'Confidence bands'),
    h('span', {}, 'pass below'), num('lo', lo), h('span', {}, 'flag above'), num('hi', hi),
    h('span', { class: 'muted' }, `→ decides ${decided} of ${all.length} itself, ${pct(decided ? right / decided : 0)} right; ${review} (${pct(all.length ? review / all.length : 0)}) go to review`));
}

const whatIfText = (r) => (r.done ? `all answered cases: catch ${pct(r.catch)} (${r.caught}/${r.bad}), false alarms ${pct(r.falseAlarm)} (${r.alarms}/${r.good})` : '');

function updateWhatIf() {
  $('#tval').textContent = state.t.toFixed(2);
  $('#whatif').textContent = whatIfText(liveRates(state.t));
}

function decisionPanel() {
  const d = state.exp.decision || {};
  let choice = d.verdict || '';
  const note = h('textarea', { placeholder: 'Why — what you saw in the cases' }, d.note || '');
  const pick = (v, label) => h('button', { class: choice === v ? 'on' : '', onclick: (e) => {
    choice = v;
    for (const b of e.target.parentElement.querySelectorAll('button[data-v]')) b.classList.toggle('on', b.dataset.v === v);
  }, 'data-v': v }, label);
  return h('div', { class: 'panel decision' },
    h('div', { class: 'row' },
      h('strong', {}, 'Decision'),
      pick('adopt', 'Adopt'), pick('reject', 'Reject'), pick('retry', 'Needs a better question'),
      h('span', { class: 'spacer' }),
      d.at ? h('span', { class: 'muted' }, `saved ${new Date(d.at).toLocaleString()}`) : null),
    h('div', { style: { marginTop: '8px' } }, note),
    h('div', { class: 'row', style: { marginTop: '8px' } },
      h('button', { class: 'primary', onclick: () => saveDecision({ verdict: choice || undefined, note: note.value }) }, 'Save decision'),
      Object.keys(state.overrides).length ? h('span', { class: 'chip warn' }, `${Object.keys(state.overrides).length} label${Object.keys(state.overrides).length === 1 ? "" : "s"} changed by you`) : null));
}

async function saveDecision(body) {
  const r = await getJson(`/api/decision/${state.id}`, { method: 'POST', headers: HEAD, body: JSON.stringify(body) });
  state.exp.decision = r.decision;
  state.exp.verdict = r.verdict;
  state.exp.cases = r.cases;
  renderMain();
  loadList();
}

function saveBar() {
  const out = {};
  for (const input of $('#bar').querySelectorAll('input')) out[input.dataset.key] = Number(input.value);
  saveDecision({ bar: out });
}

function filtersRow() {
  const f = (key, label) => h('button', { class: state.filter === key ? 'on' : '', onclick: () => { state.filter = key; renderMain(); } }, label);
  const muts = state.exp.mutations;
  return h('div', { class: 'filters' },
    f('all', 'All'), f('wrong', 'Misses and false alarms'), f('bad', 'Broken cases'), f('good', 'Good cases'), threeWay() ? f('unclear', 'Can’t-tell cases') : null,
    h('select', { onchange: (e) => { state.mutation = e.target.value; renderGrid(); } },
      h('option', { value: '' }, 'every mutation'),
      Object.entries(muts).map(([k, label]) => h('option', { value: k, selected: state.mutation === k }, label))));
}

function visible(c) {
  const o = outcome(c, state.results[c.id]);
  if (state.mutation && c.mutation !== state.mutation) return false;
  if (state.filter === 'wrong') return ['missed', 'alarm', 'overconfident', 'error', 'unrendered'].includes(o);
  if (state.filter === 'bad') return c.truth ? c.truth === 'bad' : c.bad;
  if (state.filter === 'good') return c.truth ? c.truth === 'good' : !c.bad;
  if (state.filter === 'unclear') return c.truth === 'unclear';
  return true;
}

function renderGrid() {
  const grid = $('#grid');
  if (!grid) return;
  grid.replaceChildren(...state.exp.cases.filter(visible).map(tile));
}

function boxOverlay(r) {
  const b = r?.answers?.where?.box;
  if (!b) return null;
  return h('div', { class: 'box', title: `Jev's box for the identifier (confidence ${r.answers.where.confidence ?? '—'})`, style: {
    top: `${b.top * 100}%`, left: `${b.left * 100}%`, width: `${(b.right - b.left) * 100}%`, height: `${(b.bottom - b.top) * 100}%`,
  } });
}

const imgUrl = (c) => `/api/image/${state.id}/${encodeURIComponent(c.id)}`;

// The image, or a plain note when Mermaid couldn't draw the case (a fixture bug, not an answer).
function shot(c, r, lazy) {
  const img = h('img', { src: imgUrl(c), loading: lazy ? 'lazy' : null, alt: '' });
  const frame = h('div', { class: 'frame' }, img, boxOverlay(r));
  img.addEventListener('error', () => frame.replaceWith(h('div', { class: 'noimg' },
    h('strong', {}, 'This case didn’t render'), h('span', {}, 'Mermaid rejected the card, so Jev was never asked.'))));
  return frame;
}

function tile(c) {
  const r = state.results[c.id];
  const o = outcome(c, r);
  const [tone, label] = OUTCOME[o];
  const yes = r?.prob ?? (r?.flag != null ? 1 - r.flag : null);
  return h('div', { class: `tile ${o}`, id: `tile-${CSS.escape(c.id)}` },
    state.exp.hasImage
      ? h('div', { class: 'shot', onclick: () => openDetail(c) }, shot(c, r, true))
      : h('div', { class: 'codeview', onclick: () => openDetail(c) },
        h('div', { class: 'clabel' }, '“', c.label, '”'),
        h('pre', {}, c.code)),
    h('div', { class: 'body' },
      h('div', { class: 'head' },
        truthChip(c),
        c.injection ? h('span', { class: 'chip warn' }, 'injection') : null,
        c.overridden ? h('span', { class: 'chip warn', title: 'You changed this label' }, 'your label') : null,
        h('span', { class: `chip ${tone} ${o === 'asking' ? 'pulse' : ''}` }, label)),
      c.identifier
        ? h('div', {}, h('code', {}, c.identifier), h('span', { class: 'muted' }, ` in “${c.cardTitle}”`))
        : h('div', {}, h('span', { class: 'muted' }, 'step '), h('code', {}, c.fn), c.shownFn ? h('span', { class: 'muted' }, ' · code shown: ', h('code', {}, c.shownFn)) : null),
      threeWay() ? meter3(r) : meter(r),
      h('div', { class: 'foot muted' },
        h('span', {}, r?.error ? r.error.slice(0, 60) : r?.choice ? `Jev: ${CHOICE[r.choice] || r.choice} · confidence ${(r.confidence ?? 0).toFixed(2)}` : r?.probContra != null ? `shown ${r.prob.toFixed(2)} · contradicted ${r.probContra.toFixed(2)}` : yes == null ? '' : `Jev: yes ${yes.toFixed(2)}`),
        h('span', { class: 'spacer' }),
        r?.usage ? h('span', {}, usd(r.usage.usd)) : null,
        h('button', { title: threeWay() ? 'Change this case’s label: good → broken → can’t tell' : 'Flip this case between good and broken', onclick: () => flip(c) }, 'Disagree'))));
}

// The bar shows Jev's flag (the chance the case is broken); the tick is the threshold.
function meter(r) {
  const flag = r?.flag;
  return h('div', { class: 'meter', title: flag == null ? 'not answered' : `flag ${flag.toFixed(2)} vs threshold ${state.t.toFixed(2)}` },
    h('div', { class: `fill ${flag == null ? '' : flag >= state.t ? 'hi' : 'lo'}`, style: { width: `${(flag ?? 0) * 100}%` } }),
    h('div', { class: 't', style: { left: `${state.t * 100}%` } }));
}

function truthChip(c) {
  const t = c.truth || (c.bad ? 'bad' : 'good');
  const [tone, word] = { good: ['good', 'good'], bad: ['bad', 'broken'], unclear: ['warn', 'can’t tell'] }[t];
  return h('span', { class: `chip ${tone}` }, `${word} · ${c.mutation}`);
}

// Disagree cycles your label: good → broken → can't tell (three-way) and back to the experiment's.
const CHOICE = { matches: 'matches', differs: 'differs', cantTell: 'can’t tell' };

// Three-way meters. Bands: Jev's yes-probability with the flag-at and pass-at ticks.
// Three options: the probability Jev gave each option, stacked.
function meter3(r) {
  if (state.exp.meta.decide.kind === 'bands') {
    const b = bar();
    const p = r?.prob;
    const v = verdictOf(r);
    return h('div', { class: 'meter', title: p == null ? 'not answered' : `yes ${p.toFixed(2)}: pass at ≥ ${b.passAt}, flag at ≤ ${b.flagAt}` },
      h('div', { class: `fill ${v === 'pass' ? 'lo' : v === 'flag' ? 'hi' : 'mid'}`, style: { width: `${(p ?? 0) * 100}%` } }),
      h('div', { class: 't', style: { left: `${b.flagAt * 100}%` } }),
      h('div', { class: 't', style: { left: `${b.passAt * 100}%` } }));
  }
  if (state.exp.meta.decide.kind === 'two') {
    const b = bar();
    const v = verdictOf(r);
    return h('div', { class: 'two', title: r?.prob == null ? 'not answered' : `every claim shown ${r.prob.toFixed(2)} · contradicted ${(r.probContra ?? 0).toFixed(2)}` },
      h('div', { class: 'meter' }, h('div', { class: `fill ${v === 'pass' ? 'lo' : v === 'flag' ? 'hi' : 'mid'}`, style: { width: `${(r?.prob ?? 0) * 100}%` } }), h('div', { class: 't', style: { left: `${b.supportedAt * 100}%` } })),
      h('div', { class: 'meter thin' }, h('div', { class: 'fill hi', style: { width: `${(r?.probContra ?? 0) * 100}%` } }), h('div', { class: 't', style: { left: `${b.contradictedAt * 100}%` } })));
  }
  const pr = r?.probabilities || {};
  return h('div', { class: 'meter stack', title: Object.entries(pr).map(([k, v]) => `${CHOICE[k] || k} ${v.toFixed(2)}`).join(' · ') || 'not answered' },
    h('div', { class: 'seg m', style: { width: `${(pr.matches || 0) * 100}%` } }),
    h('div', { class: 'seg u', style: { width: `${(pr.cantTell || 0) * 100}%` } }),
    h('div', { class: 'seg d', style: { width: `${(pr.differs || 0) * 100}%` } }));
}

async function flip(c) {
  const order = threeWay() ? ['good', 'bad', 'unclear'] : ['good', 'bad'];
  const now = c.truth || (c.bad ? 'bad' : 'good');
  const next = order[(order.indexOf(now) + 1) % order.length];
  if (next === (c.originalTruth || now) && c.id in state.overrides) delete state.overrides[c.id];
  else state.overrides[c.id] = next;
  await saveDecision({ overrides: state.overrides });
}

function openDetail(c) {
  const r = state.results[c.id];
  const d = $('#detail');
  d.replaceChildren(
    h('div', { class: 'dhead' },
      h('strong', {}, `${c.cardTitle} · `, h('code', {}, c.identifier || c.mutation)),
      h('span', { class: `chip ${c.bad ? 'bad' : 'good'}` }, c.note),
      h('span', { class: 'spacer' }),
      h('button', { onclick: () => d.close() }, 'Close')),
    h('div', { class: 'dbody' },
      state.exp.hasImage
        ? h('div', {},
          h('h3', {}, 'What Jev saw (dashed: where Jev located the identifier)'),
          h('div', { class: 'shot' }, shot(c, r, false)))
        : h('div', {},
          h('h3', {}, 'Step label Jev was given'),
          h('pre', {}, c.label),
          h('h3', {}, `Code Jev was given (${c.shownFn || c.fn}, ${c.file})`),
          h('pre', { class: 'tall' }, c.code)),
      h('div', {},
        h('h3', {}, 'Question sent'),
        h('pre', {}, r?.asked || '(not asked yet)'),
        h('h3', {}, 'Answer'),
        h('pre', {}, r ? (r.error || JSON.stringify(r.answers, null, 2)) : '—'),
        h('h3', {}, 'Cost and time'),
        h('pre', {}, r?.usage ? `${r.usage.inputTokens} input tokens · ${usd(r.usage.usd)} · ${r.ms} ms` : '—'),
        c.mermaid ? [h('h3', {}, 'Mermaid for this case'), h('pre', {}, c.mermaid)] : null,
        c.mermaid && c.mermaid !== c.original ? [h('h3', {}, 'Original card'), h('pre', {}, c.original)] : null)));
  d.showModal();
}

// ---------- live run ----------

async function runExperiment(only) {
  state.running = true;
  const ids = only || state.exp.cases.map((c) => c.id);
  if (!only) state.results = {};
  for (const id of ids) delete state.results[id];
  renderMain();
  const res = await fetch(`/api/run/${state.id}`, { method: 'POST', headers: HEAD, body: JSON.stringify(only ? { only } : {}) });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let pending = false;
  const repaint = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; renderGrid(); $('#score').replaceWith(scorePanel()); });
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const ev = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      if (ev.type === 'asking') state.asking.add(ev.id);
      if (ev.type === 'case') { state.asking.delete(ev.id); state.results[ev.id] = ev; $('#spend').textContent = `this run: ${usd(ev.usdSoFar)}`; }
      if (ev.type === 'done') { state.running = false; state.exp.verdict = ev.verdict; }
      repaint();
    }
  }
  state.running = false;
  await openExperiment(state.id);
  loadList();
}

loadList().catch((e) => { $('#main').replaceChildren(h('p', { class: 'chip bad' }, `Lab server unreachable: ${e.message}`)); });
