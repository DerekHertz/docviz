import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createWorkspace} from '../workspace.mjs';
import {judgeClaims} from '../agents.mjs';

test('a Jev answer arriving after a property edit stays bound to the original definition',async t=>{
 const root=await mkdtemp(resolve(tmpdir(),'docviz-jev-test-')),repo=resolve(root,'repo');
 await mkdir(repo);t.after(()=>rm(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=','-C',repo,...args],{encoding:'utf8'}).trim();
 git('init','-q','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 await writeFile(resolve(repo,'answer.js'),'export const answer = 1;\n');git('add','.');git('commit','-qm','Base');git('checkout','-qb','candidate');
 await writeFile(resolve(repo,'answer.js'),'export const answer = 2;\n');git('add','.');git('commit','-qm','Candidate');
 const ws=await createWorkspace(resolve(root,'data'));let doc=await ws.open({repositoryPath:repo,baseRef:'main',headRef:'candidate'});
 doc=await ws.changeProperty(doc.id,doc.version,{componentId:doc.components[0].id,title:'Answer',condition:'the value is read',expectation:'answer is two',violation:'answer differs',sources:[{side:'head',path:'answer.js',from:1,to:1}]});
 const property=doc.properties[0],reviewId=doc.id,previousKey=process.env.TYPESAFE_API_KEY;
 process.env.TYPESAFE_API_KEY='controlled-test-value';t.after(()=>{if(previousKey===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=previousKey;});
 let release,started;const waiting=new Promise(resolveWait=>{release=resolveWait;}),requested=new Promise(resolveRequest=>{started=resolveRequest;});
 t.mock.method(globalThis,'fetch',async()=>{started();await waiting;return{ok:true,json:async()=>({answers:{supported:{noul:1},contradicted:{noul:0},contextSufficient:{noul:1}}})};});
 const judge=sourceDoc=>judgeClaims(sourceDoc,(path,side)=>ws.source(reviewId,path,side),evidence=>ws.recordEvidence(reviewId,evidence));
 const pending=judge(doc);await requested;
 doc=await ws.changeProperty(reviewId,doc.version,{...property,expectation:'answer is three'},property.id);release();
 doc=await pending;const oldAnswer=doc.evidence[0];
 assert.match(oldAnswer.label,/answer is two/);assert.equal(doc.properties[0].expectation,'answer is three');
 assert(oldAnswer.outdatedPropertyIds?.includes(property.id),'an answer for the edited definition must be historical');
 doc=await judge(doc);const currentAnswer=doc.evidence.at(-1);
 assert.match(currentAnswer.label,/answer is three/);assert(!currentAnswer.outdatedPropertyIds?.includes(property.id));
});

function controlledJev(t,answers){
 const previous=process.env.TYPESAFE_API_KEY;process.env.TYPESAFE_API_KEY='controlled-test-value';
 t.after(()=>{if(previous===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=previous;});
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({answers})}));
}
async function recordedJudgment(t,answers){
 controlledJev(t,answers);
 const doc={properties:[{id:'property',condition:'an explicit stored map is requested',expectation:'a mismatched repository is rejected',sources:[{path:'cache.js',side:'head',from:1,to:1}]}]};
 return judgeClaims(doc,async()=>({text:'function graphOf(nodes) { return { nodes }; }'}),async evidence=>evidence);
}
test('missing source context remains uncertain despite a high contradiction score',async t=>{
 const evidence=await recordedJudgment(t,{supported:{noul:.2},contradicted:{noul:.9},contextSufficient:{noul:.1}});
 assert.equal(evidence.result,'uncertain');
 assert.equal(evidence.uncertaintyReason,'insufficient-source-context');
 assert.equal(evidence.contextSufficient,.1);
 assert.equal(evidence.contradicted,.9);
});

for(const c of[
 {name:'adequate source supports its claim',scores:[.9,.1,1],result:'supports',reason:null},
 {name:'a direct refutation remains a contradiction',scores:[0,1,1],result:'contradicts',reason:null},
 {name:'adequate source with inconclusive judgments stays uncertain',scores:[.1,.2,1],result:'uncertain',reason:'inconclusive-source-judgment'},
 {name:'missing context takes precedence over both confident judgments',scores:[1,1,0],result:'uncertain',reason:'insufficient-source-context'},
 {name:'existing support cutoff is inclusive after the context gate',scores:[.6,.49,.6],result:'supports',reason:null},
 {name:'existing contradiction cutoff is inclusive after the context gate',scores:[.59,.5,.6],result:'contradicts',reason:null}
])test(c.name,async t=>{
 const [supported,contradicted,contextSufficient]=c.scores,evidence=await recordedJudgment(t,{supported:{noul:supported},contradicted:{noul:contradicted},contextSufficient:{noul:contextSufficient}});
 assert.equal(evidence.result,c.result);assert.equal(evidence.uncertaintyReason,c.reason);
 assert.deepEqual([evidence.supported,evidence.contradicted,evidence.contextSufficient],c.scores);
 assert.equal(evidence.criteriaVersion,'source-context-v2');
 assert.deepEqual(evidence.thresholds,{contextSufficient:.6,supported:.6,contradicted:.5});
 assert(evidence.propertyDefinitions.property);
});

test('malformed or missing model scores cannot become source support or contradiction',async t=>{
 const invalid=[undefined,null,'0.9',NaN,Infinity,-.01,1.01];
 for(const field of ['supported','contradicted','contextSufficient'])for(const [index,value]of invalid.entries())await t.test(field+' invalid case '+index,async child=>{
  const answers={supported:{noul:.9},contradicted:{noul:.9},contextSufficient:{noul:.9}};answers[field]={noul:value};
  const evidence=await recordedJudgment(child,answers);
  assert.equal(evidence.result,'unknown');assert.equal(evidence.uncertaintyReason,'invalid-model-response');
  assert.equal(evidence[field],null);
  for(const retained of ['supported','contradicted','contextSufficient'].filter(name=>name!==field))assert.equal(evidence[retained],.9);
 });
});

test('a null provider response records an incomplete source check',async t=>{
 controlledJev(t,null);t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>null}));
 const evidence=await judgeClaims({properties:[{id:'p',condition:'a claim is checked',expectation:'its source can be assessed',sources:[{path:'a.js',side:'head',from:1,to:1}]}]},async()=>({text:'export const a = 1;'}),async e=>e);
 assert.equal(evidence.result,'unknown');assert.equal(evidence.uncertaintyReason,'invalid-model-response');
});
