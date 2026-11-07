import test from 'node:test';
import assert from 'node:assert/strict';
import {createBehaviorView} from '../ui/behavior.js';

const base='a'.repeat(40),head='b'.repeat(40);
const capture=(commit,frames=3,observed=true)=>({
 commit,scenarioId:'cache-case',harnessDigest:'same-harness',
 frames:Array.from({length:frames},(_,index)=>({id:index===0?'input':index===frames-1?'output':'checkpoint-'+index,title:'Checkpoint '+(index+1),observed:observed&&index===frames-1,output:{status:'rejected'}}))
});
function fixture({frames=3,observed=true,evidence=[]}={}){
 const stack={id:'fixture',target:base,tip:head,kind:'pr-checkpoints',
  layers:[{id:'initial',title:'Initial',parent:base,head,changedNodes:['cache','git']}],
  nodes:[{id:'git',title:'Git adapter',purpose:'Read pinned Git source',inputs:['revisions'],outputs:['source blobs'],sources:[{commit:head,path:'git.mjs',from:1,to:2}]},{id:'cache',title:'System map cache',inputs:['descriptions'],outputs:['stored maps'],sources:[]}],
  edges:[{id:'flow',from:'git',to:'cache',label:'source context'}],
  scenarios:[{id:'cache-case',nodeId:'cache',label:'Reject malformed cache',inputLabel:'Object in a text field',claimIds:[],relatedPropertyIds:['cache-claim'],expectation:'Cache rejects malformed description',expectedStatus:'rejected',sources:[],testSources:[]}],
  captures:[capture(base,frames,observed),capture(head,frames,observed)]};
 const review={repository:{name:'Fixture'},properties:[{id:'cache-claim',title:'Edited claim',expectation:'Current property definition',authority:'agent-proposed'}],evidence,findings:[]};
 // This host isolates the renderer from a browser. Its output is the same HTML and
 // delegated action surface used by the real application; no execution data is mocked as proof.
 const dialog={open:false,innerHTML:'',showModal(){this.open=true;},close(){this.open=false;}};
 const code={isConnected:true,innerHTML:'',textContent:''};
 const host={innerHTML:'',getBoundingClientRect(){return{width:1200};},querySelector(selector){if(selector==='#behavior-dialog')return dialog;if(selector==='#behavior-code')return code;return null;}};
 const requests=[];
 const view=createBehaviorView({api:async path=>{requests.push(path);return{path:'git.mjs',commit:head,blob:'c'.repeat(40),text:'export const source = 1;\nexport const revision = 2;'};},onProperty(){},onAgents(){},onReview(){},onFiles(){}});
 view.mount(host,stack,review);
 const click=dataset=>host.onclick({target:{closest(){return{dataset};}}});
 return{host,dialog,code,requests,view,click};
}

test('an edited claim keeps its previous source assessment visibly historical',async()=>{
 const f=fixture({evidence:[{id:'prior',kind:'source-judgment',label:'Original submitted claim',propertyIds:['cache-claim'],result:'supports',supported:.9,contradicted:.1,contextSufficient:.9,criteriaVersion:'source-context-v2',outdatedPropertyIds:['cache-claim']}]});
 await f.click({behaviorAction:'detail',tab:'agents'});
 assert.match(f.dialog.innerHTML,/Edited claim/);
 assert.match(f.dialog.innerHTML,/Historical · Source support/);
 assert.match(f.dialog.innerHTML,/Recorded for a previous property definition/);
 assert.match(f.dialog.innerHTML,/does not apply to the current claim/);
 assert.match(f.dialog.innerHTML,/Original submitted claim/);
 f.view.dispose();
});

test('a module without a scenario opens its own source and cannot borrow another module test',async()=>{
 const f=fixture();await f.click({behaviorAction:'node',id:'git'});
 assert.match(f.host.innerHTML,/INSIDE Git adapter/);
 await f.click({behaviorAction:'detail',tab:'code'});
 assert.match(f.dialog.innerHTML,/<h2[^>]*>Git adapter<\/h2>/);
 assert.match(f.dialog.innerHTML,/Module implementation/);
 assert.doesNotMatch(f.dialog.innerHTML,/Reject malformed cache|Matches this expectation|Claim &amp; visual test/);
 assert.equal(f.requests[0],`/api/stacks/fixture/source?commit=${head}&path=git.mjs`);
 f.view.dispose();
});

for(const frames of[2,4])test(`${frames}-checkpoint playback shows the final observed value`,async()=>{
 const f=fixture({frames});await f.click({behaviorAction:'step',index:String(frames-1)});
 assert.match(f.host.innerHTML,/Inspect after outcome: Rejected/);
 assert.match(f.host.innerHTML,/OBSERVED OUTPUT/);
 assert.doesNotMatch(f.host.innerHTML,/Play or step to observe/);
 f.view.dispose();
});

test('a capture with no observed frame is shown as unknown rather than successful execution',async()=>{
 const f=fixture({observed:false});await f.click({behaviorAction:'step',index:'2'});
 assert.match(f.host.innerHTML,/Inspect after outcome: Not observed/);
 assert.match(f.host.innerHTML,/NO OBSERVATION/);
 assert.match(f.host.innerHTML,/No execution observed/);
 assert.doesNotMatch(f.host.innerHTML,/OBSERVED OUTPUT|output-object success/);
 f.view.dispose();
});

test('Enter leaves native button activation to the browser and activates custom graph controls once',()=>{
 const f=fixture();let clicks=0,prevented=0;
 f.host.onkeydown({key:'Enter',preventDefault(){prevented++;},target:{matches(){return false;},click(){clicks++;}}});
 assert.equal(clicks,0);assert.equal(prevented,0);
 f.host.onkeydown({key:'Enter',preventDefault(){prevented++;},target:{matches(){return true;},click(){clicks++;}}});
 assert.equal(clicks,1);assert.equal(prevented,1);
 f.view.dispose();
});
