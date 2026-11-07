import test from 'node:test';
import assert from 'node:assert/strict';
import {coverageLifecycle,lifecycleLayout} from '../ui/behavior-model.mjs';
import {createBehaviorView} from '../ui/behavior.js';

const base='a'.repeat(40),head='b'.repeat(40),coverageId='d'.repeat(64);
const bg=(from,to)=>({commit:head,path:'extension/background.js',from,to});
const step=(id,label,from,to)=>({id,label,sources:[bg(from,to)]});
// Same shape as helper/contracts/card-spend.mjs observed.frames.
const state=(id,action,ledgerPaid,card,pageTotal)=>({id,action,ledgerPaid,ledgerCalls:ledgerPaid,card,tabCards:card.present?1:0,unassigned:0,pageTotal});
function frames(){return[
 state('before-first-reply','draw one card; the helper call is out',0,{present:true,status:'loading',cost:null},0),
 state('after-failed-draw','the call fails after spending $1',1,{present:true,status:'error',cost:1},1),
 state('after-retry-request','Retry; a second call is out',1,{present:true,status:'error',cost:1},1),
 state('after-dismiss','Dismiss while the call is out',1,{present:false,status:null,cost:null},0),
 state('after-late-return','the late call returns with $1 of usage',2,{present:false,status:null,cost:null},0)
];}
function row(over={},withFrames=true){return{contractId:'card-spend-accounting',title:'Every reported helper charge stays attributed to a card on its page',status:'violated',reason:'executed-fails',tone:'bad',label:'Violated at this head',detail:'Executed counterexample at this head.',applies:true,touched:['extension/background.js','extension/sidepanel.js'],omittedBySummary:true,omitted:['dismiss'],authority:'Operator-selected (not a signature)',governing:['SPEC.md:40-48@bbbbbbb'],evidence:{provenance:'executed-by-docviz',outcome:'fails',scope:'Pinned background.js handlers; chrome.* and the helper are controlled stubs.',observed:{ledgerPaid:2,chargedBeforeDismiss:1,pageTotalAfter:0,unattributed:1,...(withFrames?{frames:frames()}:{})},path:['draw','fail','retry','dismiss','late return'],head,harness:'card-spend'},...over};}
function world({rows=[row()],coverageHead=head,lifecycles=true}={}){
 return{id:'pr1',target:base,tip:head,kind:'pr-checkpoints',
  layers:[{id:'pr',title:'PR 1',parent:base,head,changedNodes:['background']}],
  nodes:[{id:'background',title:'Card lifecycle',inputs:['card actions'],outputs:['card records'],sources:[bg(279,301),bg(416,425)]},{id:'sidepanel',title:'Side panel',inputs:['card records'],outputs:['page total'],sources:[]}],
  edges:[{id:'records',from:'background',to:'sidepanel',label:'card records'}],
  scenarios:[],captures:[],
  authorSummary:{kind:'author-summary',steps:[step('budget','A helper call is refused once the budget is used up',61,90),step('ledger','Each call is recorded in the ledger',92,100),step('redraw','A redrawn card adds the call cost',304,321),step('blocked','A Simpler click over budget is refused',333,342),step('picture','A picture is painted once',373,415)],edges:[{from:'blocked',to:'budget'},{from:'budget',to:'ledger'},{from:'ledger',to:'redraw'},{from:'redraw',to:'picture',label:'auto pictures'}]},
  lifecycles:lifecycles?[{id:'card-spend',title:'One card from draw to late return',contractId:'card-spend-accounting',scenarioId:'card-spend-dismiss',outcome:'late',
   states:[{id:'none',label:'not drawn'},{id:'drawing',label:'drawing'},{id:'failed',label:'failed'},{id:'retrying',label:'retry · call out'},{id:'dismissed',label:'dismissed · call out'},{id:'late',label:'usage, no card'}],
   events:[{id:'draw',frame:'before-first-reply',from:'none',to:'drawing',label:'visualizeSelection',boundary:'chrome',sources:[bg(279,301),bg(304,320)]},{id:'fail',frame:'after-failed-draw',from:'drawing',to:'failed',label:'helper fails · usage',boundary:'helper',sources:[bg(61,90)]},{id:'retry',frame:'after-retry-request',from:'failed',to:'retrying',label:'card:retry',sources:[bg(447,447),bg(304,320)]},{id:'dismiss',frame:'after-dismiss',from:'retrying',to:'dismissed',label:'card:dismiss',sources:[bg(465,465),bg(416,425)]},{id:'late',frame:'after-late-return',from:'dismissed',to:'late',label:'helper returns usage',boundary:'helper',sources:[bg(61,90)]}],
   rail:[{id:'ledger',label:'Ledger total',field:'ledgerPaid'},{id:'card',label:'Card record',field:'card'},{id:'page',label:'Page total',field:'pageTotal',from:'card'}]}]:undefined,
  coverage:rows?[{id:coverageId,head:coverageHead,base,counts:{},needsReview:true,rows}]:undefined};
}

test('omitted handlers come from summary source spans, and uncited steps stay in the gutter',()=>{
 const lc=coverageLifecycle(world());
 const by=id=>lc.events.find(e=>e.id===id);
 assert.deepEqual(by('dismiss').citedBy,[]);assert.equal(by('dismiss').omitted,true);
 assert.deepEqual(by('draw').citedBy,['redraw']);assert.equal(by('draw').omitted,false);
 assert.deepEqual(by('fail').citedBy,['budget']);
 assert.deepEqual(lc.summary.gutter,['ledger','blocked','picture']);
 assert.deepEqual(lc.summary.steps.map(s=>s.id),['budget','ledger','redraw','blocked','picture']);
});

test('only a docviz-executed failure at this head marks a violation; everything else is uncertainty',()=>{
 const mark=r=>coverageLifecycle(world({rows:[r]})).mark.kind;
 assert.equal(mark(row()),'violation');
 assert.equal(mark(row({evidence:{...row().evidence,provenance:'reported'}})),'missing');
 assert.equal(mark(row({evidence:{...row().evidence,head:'f'.repeat(40)}})),'missing');
 assert.equal(mark(row({evidence:null})),'missing');
 assert.equal(mark(row({status:'unverified',tone:'pending',evidence:null})),'missing');
 assert.equal(mark(row({status:'stale',tone:'pending'})),'stale');
 assert.equal(mark(row({status:'not-applicable',applies:false,evidence:null})),'not-applicable');
 assert.equal(mark(row({status:'unverified',applies:null,evidence:null})),'unknown');
 const scoped=coverageLifecycle(world({rows:[row({status:'supported-in-scope',evidence:{...row().evidence,outcome:'holds'}})]})).mark;
 assert.equal(scoped.kind,'scoped');assert.doesNotMatch(scoped.label,/pass|verified|proven/i);
 assert.equal(coverageLifecycle(world({rows:[row({contractId:'another-contract'})]})).mark.kind,'no-result');
 assert.equal(coverageLifecycle(world({rows:null})).mark.kind,'no-result');
});

test('a coverage result for another head demotes every mark to unknown',()=>{
 const lc=coverageLifecycle(world({coverageHead:'f'.repeat(40)}));
 assert.equal(lc.stale,true);assert.equal(lc.mark.kind,'unknown');assert.match(lc.banner,/fffffff/);
});

test('the data rail shows recorded frame values only, and the page total is fed by cards, not the ledger',()=>{
 let lc=coverageLifecycle(world(),{step:4});
 const value=(lc,id)=>lc.rail.find(r=>r.id===id).value;
 assert.equal(value(lc,'ledger'),2);assert.equal(value(lc,'card').present,false);assert.equal(value(lc,'page'),0);
 assert.equal(lc.state,'late');assert.equal(lc.atOutcome,true);
 lc=coverageLifecycle(world(),{step:1});
 assert.equal(value(lc,'ledger'),1);assert.deepEqual(value(lc,'card'),{present:true,status:'error',cost:1});assert.equal(value(lc,'page'),1);assert.equal(lc.state,'failed');
 assert.deepEqual([...lc.reached],['draw','fail']);
 assert.deepEqual(lc.railEdges,[{from:'card',to:'page'}]);
 const edited=world();edited.coverage[0].rows[0].evidence.observed.frames[4].ledgerPaid=7;
 assert.equal(value(coverageLifecycle(edited,{step:4}),'ledger'),7);
});

test('without recorded per-action states nothing plays and no earlier value is inferred from the final result',()=>{
 const lc=coverageLifecycle(world({rows:[row({},false)]}),{step:4});
 assert.equal(lc.mark.kind,'violation');
 assert.equal(lc.frames.length,0);assert.equal(lc.canPlay,false);assert.equal(lc.state,null);
 assert.ok(lc.rail.every(r=>r.value===undefined&&r.history.length===0));
 const reported=coverageLifecycle(world({rows:[row({evidence:{...row().evidence,provenance:'reported'}})]}));
 assert.equal(reported.frames.length,0,'frames from imported evidence are not playback');
 assert.equal(coverageLifecycle(world({coverageHead:'f'.repeat(40)})).frames.length,0,'frames from another head are not playback');
 const partial=world();partial.coverage[0].rows[0].evidence.observed.frames=[frames()[4]];
 const only=coverageLifecycle(partial);
 assert.equal(only.state,'late');assert.deepEqual([...only.reached],['late']);assert.equal(only.canPlay,false);
 assert.equal(coverageLifecycle(world({lifecycles:false})),null);
});

test('lifecycle layout keeps state boxes and event labels apart',()=>{
 const lc=coverageLifecycle(world()),layout=lifecycleLayout(lc);
 const boxes=[...layout.states.values(),...layout.labels.values()];
 for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,`overlap ${JSON.stringify(a)} ${JSON.stringify(b)}`);}
 for(const e of lc.events){assert.ok(layout.states.get(e.from).x<layout.states.get(e.to).x,'events run left to right');}
 assert.ok(layout.width>=layout.states.size*120);
});

function mountView(stack){
 const dialog={open:false,innerHTML:'',showModal(){this.open=true;},close(){this.open=false;}};
 const code={isConnected:true,innerHTML:'',textContent:''},content={isConnected:true,innerHTML:'',textContent:''};
 const host={innerHTML:'',getBoundingClientRect(){return{width:1200};},querySelector(s){return s==='#behavior-dialog'?dialog:s==='#behavior-code'?code:s==='.behavior-detail-content'?content:null;}};
 const requests=[];
 const view=createBehaviorView({api:async path=>{requests.push(path);return{path:'extension/background.js',commit:head,blob:'9'.repeat(40),text:Array.from({length:500},(_,i)=>'line '+(i+1)).join('\n')};},onProperty(){},onAgents(){},onReview(){},onFiles(){}});
 view.mount(host,stack,{repository:{name:'docviz'},properties:[],evidence:[],findings:[]});
 const click=dataset=>host.onclick({target:{closest(){return{dataset};}}});
 return{host,dialog,code,content,requests,view,click};
}

test('the coverage panel draws the author summary and the contract lifecycle together with named events',()=>{
 const f=mountView(world());
 assert.match(f.host.innerHTML,/CONTRACT COVERAGE/);
 assert.match(f.host.innerHTML,/Historical summary-only review/);assert.match(f.host.innerHTML,/Independent contract check/);
 for(const label of['A helper call is refused once the budget is used up','A picture is painted once','visualizeSelection','card:retry','card:dismiss','helper returns usage','auto pictures'])assert.ok(f.host.innerHTML.includes(label),label);
 assert.match(f.host.innerHTML,/data-event="dismiss"[^>]*class="[^"]*omitted/);
 assert.match(f.host.innerHTML,/controlled stub/i);assert.match(f.host.innerHTML,/no browser or provider ran/i);
 assert.match(f.host.innerHTML,/card-spend-accounting/);
 assert.doesNotMatch(f.host.innerHTML,/data-rail-edge="ledger-page"/);
 f.view.dispose();
});

test('stepping to the recorded outcome shows ledger retention apart from the lost card attribution',async()=>{
 const f=mountView(world());
 await f.click({behaviorAction:'lifecycle-step',index:'4'});
 const box=(html,id)=>html.match(new RegExp(`data-rail="${id}"[^>]*><small>[^<]*</small><strong>([^<]*)</strong>`))?.[1];
 assert.equal(box(f.host.innerHTML,'ledger'),'$2');assert.equal(box(f.host.innerHTML,'card'),'∅');assert.equal(box(f.host.innerHTML,'page'),'$0');
 assert.match(f.host.innerHTML,/data-state="late"[^>]*class="[^"]*current/);
 await f.click({behaviorAction:'lifecycle-step',index:'1'});
 assert.equal(box(f.host.innerHTML,'ledger'),'$1');assert.equal(box(f.host.innerHTML,'page'),'$1');
 const edited=world();edited.coverage[0].rows[0].evidence.observed.frames[4].ledgerPaid=7;
 const g=mountView(edited);await g.click({behaviorAction:'lifecycle-step',index:'4'});
 assert.equal(box(g.host.innerHTML,'ledger'),'$7');
 const h=mountView(world({rows:[row({},false)]}));
 assert.equal(box(h.host.innerHTML,'ledger'),'not recorded');assert.match(h.host.innerHTML,/every state stays unobserved/);
 assert.doesNotMatch(h.host.innerHTML,/lifecycle-play/);
 f.view.dispose();g.view.dispose();h.view.dispose();
});

test('clicking the omitted path opens the contract, its applicability, source and executed evidence',async()=>{
 const f=mountView(world());
 await f.click({behaviorAction:'obligation',id:'dismiss'});
 const html=f.dialog.innerHTML;
 for(const text of['card-spend-accounting','Operator-selected (not a signature)','SPEC.md:40-48@bbbbbbb','extension/sidepanel.js','GIVEN','EXPECTED','OBSERVED','ledgerPaid','executed-by-docviz','controlled stubs','Executed counterexample'])assert.ok(html.includes(text),text);
 assert.match(html,/No summary step cites/);
 await f.click({behaviorAction:'detail-tab',tab:'code'});
 assert.ok(f.requests.includes(`/api/stacks/pr1/source?commit=${head}&path=extension%2Fbackground.js`));
 await f.click({behaviorAction:'detail-tab',tab:'raw'});
 assert.ok(f.requests.includes(`/api/stacks/pr1/evidence/${coverageId}`));
 f.view.dispose();
});

test('missing coverage opens as uncertainty with no observed assertion',async()=>{
 const f=mountView(world({rows:[row({status:'unverified',tone:'pending',label:'Unverified',reason:'not-trusted',detail:'The pinned head was not trusted, so no harness ran.',evidence:null})]}));
 assert.doesNotMatch(f.host.innerHTML,/lifecycle-mark violation/);
 await f.click({behaviorAction:'obligation',id:'dismiss'});
 assert.match(f.dialog.innerHTML,/No executed evidence/);
 assert.doesNotMatch(f.dialog.innerHTML,/Executed counterexample|ledgerPaid/);
 f.view.dispose();
});

test('a stack with no lifecycle keeps the existing behavior view without a coverage panel',()=>{
 const f=mountView(world({lifecycles:false,rows:null}));
 assert.doesNotMatch(f.host.innerHTML,/CONTRACT COVERAGE/);
 assert.match(f.host.innerHTML,/SYSTEM BEHAVIOR/);
 f.view.dispose();
});
