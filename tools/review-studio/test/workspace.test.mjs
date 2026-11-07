import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createWorkspace} from '../workspace.mjs';
import {sourceAt, repositoryAt, parseChanges} from '../git.mjs';
async function fixture(t){
 const root=await mkdtemp(resolve(tmpdir(),'docviz-review-test-')),repo=resolve(root,'repo');await mkdir(repo);
 t.after(()=>rm(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
 git('init','-q','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 await mkdir(resolve(repo,'src'));await writeFile(resolve(repo,'src/b.js'),'export const b = 1;\n');await writeFile(resolve(repo,'src/a.js'),"import {b} from './b.js';\nexport const answer = b;\n");git('add','.');git('commit','-qm','Base');const base=git('rev-parse','HEAD');git('checkout','-qb','candidate');
 await writeFile(resolve(repo,'src/a.js'),"import {b} from './b.js';\nexport const answer = b + 1;\n");git('add','.');git('commit','-qm','Candidate');const head=git('rev-parse','HEAD');
 const data=resolve(root,'data'),ws=await createWorkspace(data),doc=await ws.open({repositoryPath:repo,baseRef:'main',headRef:'candidate'});return{root,repo,data,git,base,head,ws,doc};
}
const property=(doc)=>({componentId:doc.components[0].id,title:'Answer advances',condition:'b is one',expectation:'answer is two',violation:'answer differs from two',sources:[{side:'head',path:'src/a.js',from:1,to:2}]});
const finishable=doc=>({reviewer:'Test reviewer',scope:'source',rationale:'Fixture source inspected; runtime gaps retained.',componentDecisions:Object.fromEntries(doc.components.filter(c=>c.changedFiles.length).map(c=>[c.id,'satisfied'])),propertyDecisions:Object.fromEntries(doc.properties.map(p=>[p.id,'follow-up'])),acknowledgedGaps:true});
test('snapshot reads exact source without checking out or executing Git hooks',async t=>{
 const f=await fixture(t);assert.equal(f.doc.snapshot.base.commit,f.base);assert.equal(f.doc.snapshot.head.commit,f.head);assert.equal(f.doc.properties.length,0);assert.equal(f.doc.evidence.length,0);
 await writeFile(resolve(f.repo,'src/a.js'),'uncommitted\n');const value=await f.ws.source(f.doc.id,'src/a.js','head');assert.match(value.text,/b \+ 1/);assert.equal(f.git('branch','--show-current'),'candidate');assert.equal(await readFile(resolve(f.repo,'src/a.js'),'utf8'),'uncommitted\n');assert.equal(f.doc.snapshot.fileRelationships.length,1);
 await assert.rejects(()=>f.ws.source(f.doc.id,'../outside','head'),/not a regular/);
 const marker=resolve(f.root,'executed-hook');await writeFile(resolve(f.root,'monitor'),`#!/bin/sh\ntouch '${marker}'\n`);f.git('config','core.fsmonitor',resolve(f.root,'monitor'));await f.ws.read(f.doc.id);await assert.rejects(()=>readFile(marker),{code:'ENOENT'});
 assert.deepEqual(parseChanges('R100\0old name.js\0new name.js\0M\0src/a.js\0'),[{status:'R',oldPath:'old name.js',path:'new name.js'},{status:'M',path:'src/a.js'}]);
});
test('properties and optimistic decisions survive restart; receipt invalidates on evidence/model/ref change',async t=>{
 const f=await fixture(t);let d=await f.ws.changeProperty(f.doc.id,f.doc.version,property(f.doc));assert.equal(d.properties[0].authority,'human-confirmed');const p=d.properties[0];
 await assert.rejects(()=>f.ws.saveReview(d.id,1,{rationale:'stale overwrite'}),{status:409});
 d=await f.ws.saveReview(d.id,d.version,finishable(d));d=await f.ws.finish(d.id,d.version);assert.equal(d.receiptCurrent,true);assert.equal(d.receipt.properties[0].condition,'b is one');assert.equal(d.receipt.head.commit,f.head);assert.match((await f.ws.export(d.id)).markdown,/runtime gaps retained/);
 const reopened=await createWorkspace(f.data);assert.equal((await reopened.read(d.id)).receiptCurrent,true);assert.equal((await reopened.read(d.id)).review.reviewer,'Test reviewer');
 d=await reopened.recordEvidence(d.id,{kind:'reported',propertyIds:[p.id],scope:'Imported external report',result:'pass',actor:{role:'verifier',name:'External'}});assert.equal(d.receiptCurrent,false);assert.equal(d.review.acknowledgedGaps,false);await assert.rejects(()=>reopened.export(d.id),/current review/);
 d=await reopened.saveReview(d.id,d.version,finishable(d));d=await reopened.finish(d.id,d.version);f.git('commit','--allow-empty','-qm','New candidate');assert.equal((await reopened.read(d.id)).freshness.status,'refs-moved');assert.equal((await reopened.read(d.id)).receiptCurrent,false);assert.notEqual((await reopened.refresh(d.id)).id,d.id);
});
test('moving target with unchanged merge-base opens a fresh comparison, rather than reviving stale authority',async t=>{
 const f=await fixture(t);f.git('checkout','-q','main');f.git('commit','--allow-empty','-qm','Target advanced');const next=await f.ws.refresh(f.doc.id);assert.equal(next.snapshot.base.commit,f.base);assert.equal(next.snapshot.head.commit,f.head);assert.notEqual(next.id,f.doc.id);assert.equal(next.freshness.status,'current');assert.equal(next.review.rationale,'');
});
test('agent package is pending until applied; imported passes never become observed assertions',async t=>{
 const f=await fixture(t),raw={schema:1,base:f.base,head:f.head,components:[],properties:[{id:'answer',...property(f.doc)}],findings:[],evidence:[{propertyIds:['answer'],result:'pass',scope:'External test report',notes:'not reproduced here',sources:[]}]};
 let d=await f.ws.contribute(f.doc.id,raw,{kind:'imported',name:'Author agent',role:'author'});assert.equal(d.properties.length,0);assert.equal(d.contributions[0].applied,false);assert.match(d.acceptance.reasons.join(),/pending/);
 d=await f.ws.applyContribution(d.id,d.contributions[0].id,d.version);assert.equal(d.properties[0].authority,'agent-proposed');assert.equal(d.evidence[0].kind,'reported');assert.equal(d.evidence[0].observations,undefined);
 d=await f.ws.saveReview(d.id,d.version,{...finishable(d),scope:'behavior'});assert.equal(d.acceptance.ready,false);d=await f.ws.confirmProperty(d.id,d.version,'answer');assert.equal(d.properties[0].authority,'human-confirmed');assert.equal(d.review.propertyDecisions.answer,undefined);
 await assert.rejects(()=>f.ws.contribute(d.id,{...raw,head:'bad'},{kind:'imported',role:'reviewer'}),/exact comparison/);await assert.rejects(()=>f.ws.changeProperty(d.id,d.version,{...property(d),sources:[{side:'head',path:'src/a.js',from:1,to:99}]}),/exceeds/);
});
test('real commands retain output, command exit alone is not property evidence, failures require disposition',async t=>{
 const f=await fixture(t);let d=await f.ws.changeProperty(f.doc.id,f.doc.version,property(f.doc));const id=d.properties[0].id;
 d=await f.ws.runCheck(d.id,{argv:[process.execPath,'-e','console.log("check completed")'],propertyIds:[id]});assert.equal(d.evidence[0].result,'pass');assert.deepEqual(d.evidence[0].observations,[]);assert.match(d.acceptance.gaps.join(),/no recorded executed property-specific/);
 const observation={propertyId:id,result:'holds',assertion:'runtime import exports answer 2'};
 d=await f.ws.runCheck(d.id,{argv:[process.execPath,'--input-type=module','-e',`import {answer} from './src/a.js';if(answer!==2)process.exit(1);console.log('DOCVIZ_OBSERVATION '+${JSON.stringify(JSON.stringify(observation))});`],propertyIds:[id]});assert.equal(d.evidence[1].observations[0].result,'holds');
 d=await f.ws.runCheck(d.id,{argv:[process.execPath,'-e','process.exit(1)'],propertyIds:[id]});assert.equal(d.evidence[2].result,'fail');assert.equal(d.findings.length,1);d=await f.ws.saveReview(d.id,d.version,finishable(d));assert.equal(d.acceptance.ready,false);assert.match(d.acceptance.reasons.join(),/finding/);
 await writeFile(resolve(f.repo,'src/a.js'),'dirty\n');await assert.rejects(()=>f.ws.runCheck(d.id,{argv:[process.execPath,'-v']}),/no tracked edits/);
});
test('binary changes remain listed but are never treated as text source',async t=>{
 const f=await fixture(t);await writeFile(resolve(f.repo,'picture.bin'),Buffer.from([0,1,2]));f.git('add','.');f.git('commit','-qm','Binary');const d=await f.ws.refresh(f.doc.id);assert(d.snapshot.files.some(x=>x.path==='picture.bin'));await assert.rejects(()=>f.ws.source(d.id,'picture.bin','head'),/Binary/);
});
test('isolated checks run the pinned commit without touching a dirty source checkout',async t=>{
 const f=await fixture(t);await writeFile(resolve(f.repo,'src/a.js'),'uncommitted original\n');
 const d=await f.ws.runCheck(f.doc.id,{execution:'snapshot',argv:[process.execPath,'--input-type=module','-e',"import {answer} from './src/a.js';if(answer!==2)process.exit(1);console.log(answer)"]});assert.equal(d.evidence[0].result,'pass');assert.equal(d.evidence[0].execution,'snapshot');assert.match(d.evidence[0].output,/2/);assert.equal(await readFile(resolve(f.repo,'src/a.js'),'utf8'),'uncommitted original\n');assert.equal(f.git('branch','--show-current'),'candidate');
});
test('editing a contract retains earlier evidence as historical and resets its decision',async t=>{
 const f=await fixture(t);let d=await f.ws.changeProperty(f.doc.id,f.doc.version,property(f.doc)),p=d.properties[0];d=await f.ws.recordEvidence(d.id,{kind:'executed-command',propertyIds:[p.id],result:'pass',observations:[{propertyId:p.id,result:'holds',assertion:'observed 2'}]});d=await f.ws.saveReview(d.id,d.version,{propertyDecisions:{[p.id]:'satisfied'}});d=await f.ws.changeProperty(d.id,d.version,{...p,expectation:'answer is three'},p.id);assert(d.evidence[0].outdatedPropertyIds.includes(p.id));assert.equal(d.review.propertyDecisions[p.id],undefined);assert.match(d.acceptance.gaps.join(),/no recorded executed property-specific/);
});
test('semantic links keep their claim, sources and producer; unrelated targets are rejected',async t=>{
 const f=await fixture(t),raw={schema:1,base:f.base,head:f.head,components:[{id:'a',title:'Answer',responsibility:'Produce answer',files:['src/a.js'],inputs:[],outputs:[],behavior:[]},{id:'b',title:'Input',responsibility:'Provide b',files:['src/b.js'],inputs:[],outputs:[],behavior:[]}],relationships:[{from:'a',to:'b',kind:'uses input',reason:'Answer reads the imported b value',sources:[{side:'head',path:'src/a.js',from:1,to:2}]}],properties:[],findings:[],evidence:[]};let d=await f.ws.contribute(f.doc.id,raw,{kind:'imported',name:'Modeler',role:'author'});d=await f.ws.applyContribution(d.id,d.contributions[0].id,d.version);assert(d.relationships.some(l=>l.kind==='uses input'&&l.actor.name==='Modeler'&&l.sources[0].blob));await assert.rejects(()=>f.ws.contribute(d.id,{...raw,relationships:[{...raw.relationships[0],to:'missing'}]},{kind:'imported',role:'author'}),/known, distinct/);
});
test('renamed files open their actual base and candidate blobs',async t=>{
 const f=await fixture(t);f.git('mv','src/a.js','src/new name.js');f.git('commit','-qm','Rename');const d=await f.ws.open({repositoryPath:f.repo,baseRef:f.head,headRef:'candidate'});assert(d.snapshot.files.some(f=>f.path==='src/new name.js'&&f.oldPath==='src/a.js'));assert.match((await f.ws.source(d.id,'src/new name.js','base')).text,/b \+ 1/);assert.match((await f.ws.source(d.id,'src/new name.js','head')).text,/b \+ 1/);
});
test('a PR reuses exact-commit review evidence while watching its fetched refs',async t=>{
 const f=await fixture(t);let d=await f.ws.changeProperty(f.doc.id,f.doc.version,property(f.doc));d=await f.ws.recordEvidence(d.id,{kind:'reported',propertyIds:[d.properties[0].id],result:'source inspection',scope:'fixture'});f.git('update-ref','refs/docviz/pr-1/base',f.base);f.git('update-ref','refs/docviz/pr-1/head',f.head);
 const bound=await f.ws.open({repositoryId:d.repository.id,baseRef:'refs/docviz/pr-1/base',headRef:'refs/docviz/pr-1/head',pr:{url:'https://github.com/fixture/repo/pull/1',number:1}});assert.equal(bound.id,d.id);assert.equal(bound.properties.length,1);assert.equal(bound.evidence.length,1);assert.equal(bound.snapshot.base.ref,'main');assert.equal(bound.watchRefs.base,'refs/docviz/pr-1/base');f.git('checkout','--detach','-q',f.head);f.git('branch','-D','main','candidate');assert.equal((await f.ws.read(bound.id)).freshness.status,'current');f.git('commit','--allow-empty','-qm','new');f.git('update-ref','refs/docviz/pr-1/head',f.git('rev-parse','HEAD'));assert.equal((await f.ws.read(bound.id)).freshness.status,'refs-moved');
});
