import test from 'node:test';
import assert from 'node:assert/strict';
import {coverageLifecycle,lifecycleLayout} from '../ui/behavior-model.mjs';
import {createBehaviorView} from '../ui/behavior.js';

const base='a'.repeat(40),head='b'.repeat(40),captureId='c'.repeat(64);
const bg=(from,to)=>({commit:head,path:'extension/background.js',from,to});
const step=(id,label,from,to)=>({id,label,sources:[bg(from,to)]});
const out=(state,ledgerTotal,card,pageTotal)=>({state,ledgerTotal,card,pageTotal});
function frames(){return[
 {id:'given',title:'Controlled starting state',observed:false,output:out('none',0,null,0)},
 {id:'draw',title:'visualizeSelection called',observed:true,output:out('drawing',0,{status:'loading',costUsd:0},0)},
 {id:'fail',title:'Helper stub fails after spending',observed:true,output:out('failed',1,{status:'error',costUsd:1},1)},
 {id:'retry',title:'card:retry handler, call out',observed:true,output:out('retrying',1,{status:'error',costUsd:1},1)},
 {id:'dismiss',title:'card:dismiss handler',observed:true,output:out('dismissed',1,null,0)},
 {id:'late',title:'Helper stub returns usage',observed:true,output:out('late',2,null,0)}
];}
function row(over={}){return{contractId:'card-spend-accounting',title:'Every reported helper charge stays attributed to a card on its page',status:'violated',tone:'bad',label:'Violated',detail:'Executed counterexample at this head.',applies:true,touched:['extension/background.js','extension/sidepanel.js'],omittedBySummary:true,omitted:['dismiss'],authority:'Operator-selected (not a signature)',governing:['SPEC.md:40-48@bbbbbbb'],evidence:{provenance:'executed-by-docviz',outcome:'fails',scope:'Pinned background.js handlers; chrome.* and the helper are controlled stubs.',observed:{ledgerPaid:2,chargedBeforeDismiss:1,pageTotalAfter:0,unattributed:1},path:['draw','fail','retry','dismiss','late return'],head,harness:{id:'card-spend',digest:'e'.repeat(64)}},...over};}
function world({rows=[row()],coverageHead=head,capture=true,lifecycles=true}={}){
 return{id:'pr1',target:base,tip:head,kind:'pr-checkpoints',
  layers:[{id:'pr',title:'PR 1',parent:base,head,changedNodes:['background']}],
  nodes:[{id:'background',title:'Card lifecycle',inputs:['card actions'],outputs:['card records'],sources:[bg(279,301),bg(416,425)]},{id:'sidepanel',title:'Side panel',inputs:['card records'],outputs:['page total'],sources:[]}],
  edges:[{id:'records',from:'background',to:'sidepanel',label:'card records'}],
  scenarios:[],
  captures:capture?[{id:captureId,kind:'executed-functions',commit:head,scenarioId:'card-spend-dismiss',harnessDigest:'h1',environment:'Pinned exports in Node; chrome.* and helper are controlled stubs.',frames:frames()}]:[],
  authorSummary:{kind:'author-summary',steps:[step('budget','A helper call is refused once the budget is used up',61,90),step('ledger','Each call is recorded in the ledger',92,100),step('redraw','A redrawn card adds the call cost',304,321),step('blocked','A Simpler click over budget is refused',333,342),step('picture','A picture is painted once',373,415)],edges:[{from:'blocked',to:'budget'},{from:'budget',to:'ledger'},{from:'ledger',to:'redraw'},{from:'redraw',to:'picture',label:'auto pictures'}]},
  lifecycles:lifecycles?[{id:'card-spend',title:'One card from draw to late return',contractId:'card-spend-accounting',scenarioId:'card-spend-dismiss',outcome:'late',
   states:[{id:'none',label:'not drawn'},{id:'drawing',label:'drawing'},{id:'failed',label:'failed'},{id:'retrying',label:'retry · call out'},{id:'dismissed',label:'dismissed · call out'},{id:'late',label:'usage, no card'}],
   events:[{id:'draw',from:'none',to:'drawing',label:'visualizeSelection',boundary:'chrome',sources:[bg(279,301),bg(304,320)]},{id:'fail',from:'drawing',to:'failed',label:'helper fails · usage',boundary:'helper',sources:[bg(61,90)]},{id:'retry',from:'failed',to:'retrying',label:'card:retry',sources:[bg(447,447),bg(304,320)]},{id:'dismiss',from:'retrying',to:'dismissed',label:'card:dismiss',sources:[bg(465,465),bg(416,425)]},{id:'late',from:'dismissed',to:'late',label:'helper returns usage',boundary:'helper',sources:[bg(61,90)]}],
   rail:[{id:'ledger',label:'Ledger total',field:'ledgerTotal'},{id:'card',label:'Card record',field:'card'},{id:'page',label:'Page total',field:'pageTotal',from:'card'}]}]:undefined,
  coverage:rows?[{id:'d'.repeat(64),head:coverageHead,base,counts:{},needsReview:true,rows}]:undefined};
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
 let lc=coverageLifecycle(world(),{step:5});
 const value=(lc,id)=>lc.rail.find(r=>r.id===id).value;
 assert.equal(value(lc,'ledger'),2);assert.equal(value(lc,'card'),null);assert.equal(value(lc,'page'),0);
 assert.equal(lc.state,'late');assert.equal(lc.atOutcome,true);
 lc=coverageLifecycle(world(),{step:2});
 assert.equal(value(lc,'ledger'),1);assert.deepEqual(value(lc,'card'),{status:'error',costUsd:1});assert.equal(value(lc,'page'),1);assert.equal(lc.state,'failed');
 assert.deepEqual(lc.railEdges,[{from:'card',to:'page'}]);
 const edited=world();edited.captures[0].frames[5].output.ledgerTotal=7;
 assert.equal(value(coverageLifecycle(edited,{step:5}),'ledger'),7);
});

test('without a capture at this head nothing plays and no rail value is invented',()=>{
 const lc=coverageLifecycle(world({capture:false}),{step:5});
 assert.equal(lc.frames.length,0);assert.equal(lc.canPlay,false);assert.ok(lc.rail.every(r=>r.value===undefined));
 const other=world();other.captures[0].commit=base;
 assert.equal(coverageLifecycle(other).canPlay,false);
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
 await f.click({behaviorAction:'lifecycle-step',index:'5'});
 assert.match(f.host.innerHTML,/data-rail="ledger"[^>]*>[\s\S]*?\$2/);
 assert.match(f.host.innerHTML,/data-rail="card"[^>]*>[\s\S]*?∅/);
 assert.match(f.host.innerHTML,/data-rail="page"[^>]*>[\s\S]*?\$0/);
 assert.match(f.host.innerHTML,/data-state="late"[^>]*class="[^"]*current/);
 const edited=world();edited.captures[0].frames[5].output.ledgerTotal=7;
 const g=mountView(edited);await g.click({behaviorAction:'lifecycle-step',index:'5'});
 assert.match(g.host.innerHTML,/data-rail="ledger"[^>]*>[\s\S]*?\$7/);
 f.view.dispose();g.view.dispose();
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
 assert.ok(f.requests.includes(`/api/stacks/pr1/evidence/${captureId}`));
 f.view.dispose();
});

test('missing coverage opens as uncertainty with no observed assertion',async()=>{
 const f=mountView(world({rows:[row({status:'unverified',tone:'pending',label:'Unverified',evidence:null})]}));
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
