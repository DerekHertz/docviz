// PROTOTYPE: builds page.html, the pipeline walked through on PR #1, from the statechart
// outputs (model/out-*) and the Jev checks (checks.json). Run: node prototype/pr1-pipeline/page.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const here = (p) => new URL(p, import.meta.url);
const read = (p) => readFileSync(here(p), 'utf8');
const checks = JSON.parse(read('checks.json'));
const HEAD = '3d37957ec2387a043bef09b9ec9f16c6b5e8f348';
const BASE = '921e385fc3e8cc196423dd3fccf3ef43a6a0073a';
const repo = 'https://github.com/DerekHertz/docviz/blob';

// statechart leaves bugPath undefined and draws marks in orange; restyle them as the plates do.
const STYLE = [
  'classDef bugPath stroke:#b3261e,stroke-width:2.5px',
  'classDef mayBreak fill:#f7d9d6,stroke:#b3261e,stroke-width:2.5px,color:#8c1d16',
  'classDef breaks fill:#f7d9d6,stroke:#b3261e,stroke-width:2.5px,color:#8c1d16',
  'classDef changed stroke:#2f5d8a,stroke-width:2.5px,stroke-dasharray:5 3',
];
const chart = (dir, extra = []) =>
  read(`model/${dir}/chart.mmd`)
    .replace(/^---[\s\S]*?---\n/, '')
    // The key box beside the chart explains the marks, so the in-chart legend goes.
    .replace(/\n\s*state "Legend" as legend \{[\s\S]*?\n\s*\}/, '')
    .split('\n')
    .filter((l) => !/^\s*classDef /.test(l) && !/^\s*class lg\d/.test(l))
    .concat(STYLE, extra)
    .join('\n');

// "on the page, budget used up" lost its Simpler arrow in PR #1: that state is what changed.
const changedId = read('model/out-head/chart.mmd').match(/(s\d+): on the page, budget used up/)[1];
const base = chart('out-base');
const head = chart('out-head', [`class ${changedId} changed`]);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mark = { pass: '✓', review: '⚠', flag: '✗', unchecked: '·' };
const words = {
  YouBreakDown: 'you break down the page', CardArrives: 'the card comes back', CallFails: 'the call fails after spending',
  TimesOut: 'the call times out', YouPressSimpler: 'you press Simpler', YouRetry: 'you press Retry',
  YouDismiss: 'you dismiss it', LateReturn: 'the call comes back to no card',
};
const link = (cut, sha) => {
  const [, path, a, b] = cut.match(/^(.*):(\d+)-(\d+)$/);
  return `<a href="${repo}/${sha}/${path}#L${a}-L${b}">${esc(path.split('/').pop())}:${a}</a>`;
};
const rows = checks.rows.map((r) => `
  <tr>
    <td class="step">${esc(words[r.id])}</td>
    <td>${esc(r.label)}<div class="cuts">${r.cuts.map((c) => link(c, HEAD)).join(' · ')}</div></td>
    <td class="v ${r.head.verdict}">${mark[r.head.verdict]}<small>${r.head.prob.toFixed(2)} / ${r.head.probContra.toFixed(2)}</small></td>
    <td class="v ${r.base.verdict}">${mark[r.base.verdict]}<small>${r.base.prob.toFixed(2)} / ${r.base.probContra.toFixed(2)}</small></td>
  </tr>`).join('');
const passHead = checks.rows.filter((r) => r.head.verdict === 'pass').length;
const passBase = checks.rows.filter((r) => r.base.verdict === 'pass').length;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PR 1 Pipeline</title>
<style>
  :root { --paper:#f5efe3; --ink:#2b2622; --soft:#6d645a; --red:#b3261e; --blue:#2f5d8a; --card:#fbf7ef; --line:#d8cdb9; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --paper:#1f1c18; --ink:#ece4d6; --soft:#a89d8e; --red:#e2675e; --blue:#7fa7d1; --card:#2a2621; --line:#4a4339; } }
  :root[data-theme="dark"] { --paper:#1f1c18; --ink:#ece4d6; --soft:#a89d8e; --red:#e2675e; --blue:#7fa7d1; --card:#2a2621; --line:#4a4339; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font:17px/1.55 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; }
  main { max-width: 1060px; margin: 0 auto; padding: 40px 16px 80px; }
  .kicker { letter-spacing:.08em; color:var(--soft); font-size:14px; }
  h1 { font-weight:400; font-size: clamp(34px, 6vw, 58px); margin: 4px 0 0; letter-spacing:.01em; }
  h2 { font-weight:400; font-size: 30px; margin: 0; }
  .sub { font-style: italic; color: var(--soft); margin: 2px 0 0; }
  .verdict { margin: 28px 0 8px; padding: 18px 20px; border: 2px solid var(--red); border-radius: 10px; background: var(--card); }
  .verdict b { color: var(--red); }
  .plate { margin-top: 56px; display: grid; grid-template-columns: minmax(0,1fr) 300px; gap: 24px; align-items: start; }
  .plate.wide { grid-template-columns: minmax(0,1fr); }
  @media (max-width: 820px) { .plate { grid-template-columns: minmax(0,1fr); } }
  .chart { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px; overflow-x: auto; }
  .chart svg { width: 100%; max-width: none !important; height: auto; }
  aside { display: grid; gap: 14px; }
  .box { border: 1.5px solid var(--ink); border-radius: 8px; padding: 12px 14px; background: var(--card); font-size: 15px; }
  .box .h { font-size: 13px; letter-spacing:.06em; color: var(--soft); margin-bottom: 4px; }
  .rule { font-style: italic; margin: 6px 0; }
  .stamp { display:inline-block; border: 2px solid var(--red); color: var(--red); border-radius: 6px; padding: 0 8px; font-size: 13px; transform: rotate(-4deg); margin-left: 6px; }
  .stamp.ok { border-color: var(--blue); color: var(--blue); transform: rotate(3deg); }
  .key span { display:inline-block; width: 26px; border-top: 2.5px solid var(--red); vertical-align: middle; margin-right: 8px; }
  .key span.chg { border-top: 2.5px dashed var(--blue); }
  table { width: 100%; border-collapse: collapse; font-size: 15px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-weight: 400; color: var(--soft); font-size: 13px; letter-spacing: .05em; }
  td.step { font-style: italic; white-space: nowrap; }
  td.v { font-size: 18px; text-align: center; white-space: nowrap; }
  td.v small { display:block; font-size: 11px; color: var(--soft); }
  .pass { color: var(--blue); } .flag { color: var(--red); } .review { color: #b07d16; }
  .cuts { font-size: 12px; color: var(--soft); margin-top: 2px; }
  .cuts a { color: var(--soft); }
  .tbl { overflow-x: auto; }
  pre { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; overflow-x: auto; font: 14px/1.6 ui-monospace, Menlo, Consolas, monospace; }
  pre .fired { color: var(--red); } pre .ok { color: var(--blue); } pre .note { color: var(--soft); }
  ol li { margin: 8px 0; }
  .dim { color: var(--soft); font-size: 14px; }
</style></head>
<body><main>
  <div class="kicker">docviz pipeline, prototype · PR #1</div>
  <h1>One card and its money</h1>
  <p class="sub">1,079 lines across 26 files, read as 8 states and the 2 rules you wrote</p>

  <div class="verdict">
    <b>A person needs to see this PR.</b> It fixes one rule (the budget is now checked before every call)
    and leaves the other broken on one path: dismiss a card while it redraws, and the call still spends,
    but the cost lands on no card. That gap is still in <code>main</code> today.
  </div>

  <section class="plate">
    <div><div class="kicker">I · before</div><h2>The base</h2><p class="sub">no ledger, no budget</p>
      <div class="chart"><pre class="mermaid">${esc(base)}</pre></div></div>
    <aside>
      <div class="box"><div class="h">the rules</div>
        <p class="rule">“Never add a call that spends without showing up in the card’s cost breakdown.”<span class="stamp">broken</span></p>
        <p class="rule">“The budget check runs before every call.”<span class="stamp">broken</span></p>
        <div class="dim">From CLAUDE.md and SPEC.md, checked by TLC against the base.</div></div>
      <div class="box"><div class="h">the path TLC found</div>
        not drawn yet → <i>you break down the page</i> → drawing → <i>the card comes back</i> → on the page. Nothing was ever charged.</div>
    </aside>
  </section>

  <section class="plate">
    <div><div class="kicker">II · after</div><h2>PR #1</h2><p class="sub">what changed, drawn on top</p>
      <div class="chart"><pre class="mermaid">${esc(head)}</pre></div></div>
    <aside>
      <div class="box"><div class="h">the rules</div>
        <p class="rule">“The budget check runs before every call.”<span class="stamp ok">now holds</span></p>
        <p class="rule">“Never add a call that spends without showing up in the card’s cost breakdown.”<span class="stamp">broken on 1 path</span></p></div>
      <div class="box key"><div class="h">key</div>
        <div><span></span>the path TLC found</div>
        <div><span class="chg"></span>changed by this PR: <i>budget used up</i> lost its <i>you press Simpler</i> arrow</div></div>
      <div class="box"><div class="h">the path TLC found</div>
        … failed → <i>you press Retry</i> → redrawing → <i>you dismiss it</i> → dismissed, call still out →
        <i>the call comes back to no card</i> → dismissed.
        <div class="dim" style="margin-top:6px">In code: <a href="${repo}/${HEAD}/extension/background.js#L310-L317">generate()</a> reads the dismissed card, <code>cur.cost</code> throws, and the catch returns uncharged. Reachable: ✕ stays clickable while a card loads. Not yet reproduced in a browser.</div></div>
    </aside>
  </section>

  <section class="plate wide">
    <div><div class="kicker">III · does the model match the code?</div><h2>Each step, checked by Jev</h2>
      <p class="sub">the adopted step check, unchanged: every claim shown / anything contradicted. ✓ pass · ⚠ review · ✗ contradicted</p>
      <div class="tbl"><table>
        <tr><th>step</th><th>what the model claims, and its code at PR #1</th><th>PR #1</th><th>base</th></tr>
        ${rows}
      </table></div>
      <p class="dim">Jev spend for all 16 questions: $${checks.usd.toFixed(5)}. ${passHead} of 8 steps pass at PR #1; ${passBase} of 8 pass at the base.</p></div>
  </section>

  <section class="plate wide">
    <div><div class="kicker">IV · the pipeline, as it ran</div><h2>Which branches fired</h2>
<pre>on PR #1 (base 921e385 → head 3d37957):
  modules moved = extension/ (12 files), helper/ (4), test/ (2), CI and docs      <span class="note">[code]</span>
  for the module "card money" (extension/background.js, ledger.js):
    model exists?  no → written for this prototype                               <span class="note">[Claude, by hand here]</span>
    TLC on base:   both rules break                                              <span class="note">[formal, local, free]</span>
    TLC on head:   <span class="ok">budget-first holds</span>; <span class="fired">spend-shows breaks on 1 path</span>
    Jev, model vs head code:  ${passHead} ✓, ${8 - passHead} ⚠, 0 ✗                                   <span class="note">[Jev]</span>
    Jev, model vs base code:  ${passBase} ✓  → every step looks changed, so Claude can't be skipped
  route the human:
    <span class="fired">a rule breaks (TLC)          → show the bug path, block        ← fired</span>
    model contradicts code (Jev) → back to the authoring agent      (no ✗)
    behavior changed             → chart with the change on top     (also true)
    only structure moved         → one line in the log
</pre></div>
  </section>

  <section class="plate wide">
    <div><div class="kicker">V · what the prototype says</div><h2>What it settled, and what it didn't</h2>
    <ol>
      <li><b>The picture stays the same size however big the PR is.</b> 1,079 lines became 8 states and 11 arrows in plain words, and the one thing to look at is in red.</li>
      <li><b>TLC found a real gap that has survived to <code>main</code>.</b> It took seconds and cost nothing, and your two sentences were the only spec it needed.</li>
      <li><b>Jev can't confirm the bug itself</b> (the late-return step scored 0.19). The bug is a throw caught three lines later. TLC finds the path; a person or Claude confirms it in the code.</li>
      <li><b>Jev passes a step only when its whole claim fits in the linked code.</b> Retry (→ generate), Simpler (→ learn) and dismiss-while-running cross functions or depend on timing, and went to review. Each model step should link every function it passes through, and the TLA+ action already lists them.</li>
      <li><b>"Skip Claude when nothing changed" is untested.</b> No step passed at both base and head, because this PR changed nearly everything it touched. It needs a PR that leaves most steps alone.</li>
      <li><b>Left out of the model:</b> pictures, Explore, the breakdown's batches, concurrent cards, the soft cap's overshoot. A redraw always ends at "budget used up" because the budget is only 2 calls.</li>
    </ol></div>
  </section>
</main>
<script src="../../extension/vendor/mermaid.min.js"></script>
<script>
  const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
  mermaid.initialize({ startOnLoad: true, securityLevel: 'strict', theme: 'base',
    themeVariables: { fontFamily: '"Iowan Old Style", Palatino, Georgia, serif', fontSize: '16px',
      primaryColor: dark ? '#2a2621' : '#fbf7ef', primaryBorderColor: dark ? '#ece4d6' : '#2b2622',
      primaryTextColor: dark ? '#ece4d6' : '#2b2622', lineColor: dark ? '#ece4d6' : '#2b2622',
      textColor: dark ? '#ece4d6' : '#2b2622', background: 'transparent',
      edgeLabelBackground: dark ? '#2a2621' : '#fbf7ef' } });
</script>
</body></html>`;
writeFileSync(here('page.html'), html);
console.log('wrote', here('page.html').pathname);
