import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {coverageView,validateCoverage} from '../coverage.mjs';
import {createStackStore} from '../stack.mjs';
import {digest,repositoryAt} from '../git.mjs';
const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');

// A real `docviz pr --coverage-out` result: a throwaway repo carrying docviz's extension code.
function realCoverage(t,{trust=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'docviz-studio-coverage-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const g=(...a)=>execFileSync('git',a,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 g('init','-q');g('config','user.email','t@example.test');g('config','user.name','t');g('remote','add','origin','https://example.test/a/b.git');
 writeFileSync(join(dir,'package.json'),'{ "type": "module" }\n');g('add','-A');g('commit','-qm','base');const base=g('rev-parse','HEAD');
 mkdirSync(join(dir,'extension'));for(const f of readdirSync(join(repoRoot,'extension')).filter(f=>f.endsWith('.js')))writeFileSync(join(dir,'extension',f),readFileSync(join(repoRoot,'extension',f)));
 g('add','-A');g('commit','-qm','cards');const head=g('rev-parse','HEAD');
 const steps=join(dir,'..',`${dir.split('/').at(-1)}-steps.json`),out=join(dir,'..',`${dir.split('/').at(-1)}-coverage.json`);t.after(()=>{rmSync(steps,{force:true});rmSync(out,{force:true});});
 writeFileSync(steps,JSON.stringify({steps:[{id:'draw',label:'A selection becomes a card',changed:true,sources:[{path:'extension/background.js',from:'export async function visualizeSelection(',to:'// ---------- per-card actions'}]}],card:{caption:'Draw.',mermaid:'flowchart TD\n  draw["A selection becomes a card"]:::changed\n  classDef changed stroke:#d29922,stroke-width:3px'}}));
 const res=spawnSync(process.execPath,[join(repoRoot,'helper/cli.js'),'pr',steps,'--pr','https://example.test/pull/2','--no-check','--base',base,'--contracts',join(repoRoot,'test/fixtures/contracts/card-spend.json'),'--coverage-out',out,...(trust?['--trust-head',head]:[])],{cwd:dir,encoding:'utf8'});
 assert.equal(res.status,0,res.stderr);return Object.defineProperty(JSON.parse(readFileSync(out,'utf8')),'checkout',{value:dir});
}

test('the studio view keeps status, authority, omission and execution apart for a real CLI result',t=>{
 const view=coverageView(realCoverage(t)),[row]=view.rows;
 assert.equal(view.needsReview,true);assert.equal(view.counts.violated,1);
 assert.deepEqual([row.status,row.tone,row.reason],['violated','bad','executed-fails']);
 assert.equal(row.authority,'Operator-selected (not a signature)');
 assert.ok(row.omittedBySummary&&row.omitted.includes('dismiss'));
 assert.deepEqual([row.evidence.provenance,row.evidence.outcome,row.evidence.harness,row.evidence.observed.unattributed],['executed-by-docviz','fails','card-spend',1]);
});

test('without trust the studio sees pending uncertainty, not a violation',t=>{
 const [row]=coverageView(realCoverage(t,{trust:false})).rows;
 assert.deepEqual([row.status,row.tone,row.evidence],['unverified','pending',null]);
});

test('an edited stored result is rejected: by fingerprint, or as a claim with no matching execution',t=>{
 const real=realCoverage(t,{trust:false});
 const edited=structuredClone(real);Object.assign(edited.obligations[0],{status:'supported-in-scope',reason:'executed-holds'});
 assert.throws(()=>validateCoverage(edited),/fingerprint/);
 const {id,...payload}=edited;assert.throws(()=>validateCoverage({...payload,id:digest(payload)}),/without a matching docviz execution/);
 const authority=structuredClone(real);authority.obligations[0].authority.kind='human-confirmed';const {id:_,...p2}=authority;
 assert.throws(()=>validateCoverage({...p2,id:digest(p2)}),/operator-selected/);
});

test('the view carries only the frames the harness captured, and says so when there are none',t=>{
 const real=realCoverage(t),[row]=coverageView(real).rows,recorded=real.obligations[0].evidence.observed.frames;
 assert.ok(Array.isArray(recorded)&&recorded.length>=5,'the CLI result records frames');
 assert.deepEqual(row.evidence.frames,recorded);
 assert.equal(coverageView(resealed(real,e=>{delete e.observed.frames;})).rows[0].evidence.frames,null);
 assert.throws(()=>validateCoverage(resealed(real,e=>{e.observed.frames=[{action:'made up'}];})),/frames/);
 assert.throws(()=>validateCoverage(resealed(real,e=>{e.observed.frames='after-late-return';})),/frames/);
});

test('a stack serves declared coverage through the same fingerprinted artifacts as evidence',async t=>{
 const real=realCoverage(t),root=mkdtempSync(join(tmpdir(),'docviz-stack-coverage-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const dir=join(root,'stacks','example');mkdirSync(join(dir,'artifacts'),{recursive:true});
 writeFileSync(join(dir,'stack.json'),JSON.stringify({id:'example',repository:await repositoryAt(real.checkout),target:real.base,tip:real.head,layers:[],nodes:[],edges:[],claims:[],evidence:[],captures:[],coverage:[{id:real.id}]}));
 writeFileSync(join(dir,'artifacts',real.id+'.json'),JSON.stringify(real));
 const store=createStackStore(root);
 const stack=await store.read('example');
 assert.equal(stack.coverage[0].rows[0].status,'violated');
 assert.equal((await store.evidence('example',real.id)).kind,'contract-coverage');
 writeFileSync(join(dir,'artifacts',real.id+'.json'),JSON.stringify({...real,base:null}));
 await assert.rejects(()=>store.read('example'),/fingerprint/);
});

// Rewrites a stored result the way a forger would: edit the execution record, then recompute its own
// fingerprint (the producer's payload, in the producer's key order) and the outer one.
const resealed=(real,edit)=>{
 const copy=structuredClone(real),e=copy.obligations[0].evidence;edit(e,copy.obligations[0],copy);
 if(e){const {provenance:_p,id:_i,...payload}=e;e.id=digest(payload);}
 const {id,...payload}=copy;return{...payload,id:digest(payload)};
};

test('the real CLI record carries its own fingerprint and the harness the contract selected',t=>{
 const real=realCoverage(t),o=real.obligations[0],{provenance:_p,id,...payload}=o.evidence;
 assert.equal(id,digest(payload),'the execution record id is the digest of its payload');
 assert.deepEqual(o.check,{harness:'card-spend',digest:o.evidence.harness.digest});
 assert.doesNotThrow(()=>validateCoverage(resealed(real,()=>{})),'resealing an unedited record changes nothing');
});

test('a stored executed record bound to another contract, definition, repository or harness is rejected, even with both fingerprints recomputed',t=>{
 const real=realCoverage(t);
 const cases={
  definitionDigest:e=>{e.definitionDigest='d'.repeat(64);},
  contractId:e=>{e.contractId='another-contract';},
  repositoryRoot:e=>{e.repositoryRoot='c'.repeat(40);},
  'harness id':e=>{e.harness={...e.harness,id:'other-harness'};},
  'harness digest':e=>{e.harness={...e.harness,digest:'f'.repeat(64)};},
  'selected harness':(e,o)=>{o.check={...o.check,digest:'e'.repeat(64)};},
  'no selected harness':(e,o)=>{delete o.check;},
  base:e=>{e.base='a'.repeat(40);},
  'a reason that is not the status':(e,o)=>{o.reason='executed-holds';},
 };
 for(const [field,edit] of Object.entries(cases))assert.throws(()=>validateCoverage(resealed(real,edit)),/Invalid contract coverage/,field);
});

test('an executed record whose own fingerprint does not match its content is rejected',t=>{
 const real=realCoverage(t),copy=structuredClone(real);copy.obligations[0].evidence.observed.unattributed=0;
 const {id,...payload}=copy;assert.throws(()=>validateCoverage({...payload,id:digest(payload)}),/record fingerprint/);
});

test('a reported record stays reported: never a violation or support, whatever its fields say',t=>{
 const real=realCoverage(t);
 assert.throws(()=>validateCoverage(resealed(real,e=>{e.provenance='reported';})),/without a matching docviz execution/);
 const [row]=coverageView(resealed(real,(e,o)=>{e.provenance='reported';e.id='0'.repeat(64);o.status='unverified';o.reason='reported-only';})).rows;
 assert.deepEqual([row.status,row.evidence.provenance],['unverified','reported']);
});

test('each row shows the promised condition and expectation, and keeps the raw anchors and execution record',t=>{
 const real=realCoverage(t),o=real.obligations[0],[row]=coverageView(real).rows;
 assert.deepEqual([row.condition,row.expectation,row.violation],[o.condition,o.expectation,o.violation]);
 assert.deepEqual(row.anchors,o.summary);assert.deepEqual(row.sources,o.authority.governing);assert.deepEqual(row.check,o.check);
 assert.deepEqual(row.evidence.record,o.evidence);
});

test('the card-spend detail says what cards and page showed before Dismiss, and what they show after',t=>{
 const {detail}=realCoverage(t).obligations[0];
 assert.match(detail,/showed 1 before Dismiss/);assert.match(detail,/show 0 after the late return/);
 assert.doesNotMatch(detail,/cards and page show 1/);
});

async function stackWith(t,real,{target=real.base,tip=real.head,layers=[],declared={id:real.id},repository=real.checkout}={}){
 const root=mkdtempSync(join(tmpdir(),'docviz-stack-binding-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const dir=join(root,'stacks','example');mkdirSync(join(dir,'artifacts'),{recursive:true});
 writeFileSync(join(dir,'stack.json'),JSON.stringify({id:'example',repository:await repositoryAt(repository),target,tip,layers,nodes:[],edges:[],claims:[],evidence:[],captures:[],coverage:[declared]}));
 writeFileSync(join(dir,'artifacts',real.id+'.json'),JSON.stringify(real));
 return (await createStackStore(root).read('example')).coverage[0];
}

test('stack coverage counts as current only for the comparison it was recorded on',async t=>{
 const real=realCoverage(t),g=(...a)=>execFileSync('git',a,{cwd:real.checkout,encoding:'utf8'}).trim();
 g('commit','-q','--allow-empty','-m','later');const later=g('rev-parse','HEAD');
 const layers=[{id:'cards',number:1,parent:real.base,head:real.head},{id:'later',number:2,parent:real.head,head:later}];
 const whole=await stackWith(t,real);
 assert.deepEqual([whole.binding.current,whole.binding.scope,whole.rows[0].status],[true,'stack','violated']);
 const layer=await stackWith(t,real,{tip:later,layers,declared:{id:real.id,layerId:'cards'}});
 assert.deepEqual([layer.binding.current,layer.binding.scope,layer.binding.layerId,layer.rows[0].status],[true,'layer','cards','violated']);
 // The first layer's report, attached as if it covered the whole stack.
 const asWhole=await stackWith(t,real,{tip:later,layers});
 assert.deepEqual([asWhole.binding.current,asWhole.rows[0].status,asWhole.rows[0].reason,asWhole.counts.violated],[false,'stale','other-head',0]);
 assert.deepEqual([asWhole.rows[0].recorded.status,asWhole.rows[0].evidence.outcome],['violated','fails'],'the recorded result stays inspectable');
 const wrongLayer=await stackWith(t,real,{tip:later,layers,declared:{id:real.id,layerId:'later'}});
 assert.deepEqual([wrongLayer.binding.current,wrongLayer.rows[0].status,wrongLayer.rows[0].reason],[false,'stale','other-head']);
 // Same head, compared with another base.
 const otherBase=await stackWith(t,real,{target:real.head});
 assert.deepEqual([otherBase.binding.current,otherBase.rows[0].status,otherBase.rows[0].reason,otherBase.needsReview],[false,'stale','other-base',true]);
 await assert.rejects(()=>stackWith(t,real,{declared:{id:real.id,layerId:'missing'}}),/layer this stack does not have/);
});

test('stack coverage from another repository is never current',async t=>{
 // Self-consistent, both fingerprints recomputed: the same commits, recorded as another repository's.
 const original=realCoverage(t),real=resealed(original,(e,o,c)=>{c.repository={...c.repository,root:'c'.repeat(40)};e.repositoryRoot='c'.repeat(40);});
 Object.defineProperty(real,'checkout',{value:original.checkout});
 assert.doesNotThrow(()=>validateCoverage(real));
 const view=await stackWith(t,real);
 assert.deepEqual([view.binding.current,view.rows[0].status,view.rows[0].reason,view.needsReview],[false,'stale','other-repository',true]);
});
