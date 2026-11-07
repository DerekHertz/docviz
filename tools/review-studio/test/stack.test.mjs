import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {scopeFor,capturePair} from '../ui/stack-model.mjs';
import {createStackStore} from '../stack.mjs';
import {digest,git,repositoryAt} from '../git.mjs';
const make=()=>({id:'example',target:'a',tip:'c',summary:'whole',layers:[{id:'first',number:1,parent:'a',head:'b',summary:'first',changedNodes:['model']},{id:'second',number:2,parent:'b',head:'c',summary:'second',changedNodes:['policy']}],claims:[{layerId:'first'},{layerId:'second'}],evidence:[],captures:[]});
test('whole-stack scope differs from the base PR own diff, and every layer uses its parent',()=>{const s=make(),whole=scopeFor(s),first=scopeFor(s,'first'),second=scopeFor(s,'second');assert.deepEqual([whole.base,whole.head],['a','c']);assert.deepEqual([first.base,first.head],['a','b']);assert.deepEqual([second.base,second.head],['b','c']);assert.equal(first.claims.length,1);assert.equal(whole.claims.length,2);assert.throws(()=>scopeFor(s,'unknown'));});
test('replay cannot borrow results from a different parent, harness or scenario',()=>{const s=make(),capture=(commit,harnessDigest='h')=>({commit,scenarioId:'clear',harnessDigest,frames:[{id:'input'},{id:'outcome'}]});s.captures=[capture('a'),capture('c')];assert.equal(capturePair(s,scopeFor(s),'clear').status,'paired');assert.equal(capturePair(s,scopeFor(s,'second'),'clear').status,'missing');assert.equal(capturePair(s,scopeFor(s),'other').status,'missing');s.captures[1].harnessDigest='changed';assert.equal(capturePair(s,scopeFor(s),'clear').status,'incompatible');});
test('stack artifacts are content-bound and cannot escape declared scope',async t=>{const root=await mkdtemp(resolve(tmpdir(),'docviz-stack-'));t.after(()=>rm(root,{recursive:true,force:true}));const dir=resolve(root,'stacks','example');await mkdir(resolve(dir,'artifacts'),{recursive:true});const payload={kind:'executed-functions',output:{level:'look'}},id=digest(payload),s=make();s.evidence=[{id}];await writeFile(resolve(dir,'stack.json'),JSON.stringify(s));await writeFile(resolve(dir,'artifacts',id+'.json'),JSON.stringify({...payload,id}));const store=createStackStore(root);assert.equal((await store.evidence('example',id)).output.level,'look');await assert.rejects(()=>store.evidence('example','b'.repeat(64)));await assert.rejects(()=>store.read('../escape'));await assert.rejects(()=>store.source('example','unbound','helper.js'));await writeFile(resolve(dir,'artifacts',id+'.json'),JSON.stringify({...payload,id,output:{level:'nothing'}}));await assert.rejects(()=>store.evidence('example',id),/fingerprint/);});

test('a new repository review retains its own before/after explanation',()=>{const stack={...make(),title:'AfterClass',before:'Citations visible',after:'Citations hidden until requested',layers:[{id:'diagram',number:94,parent:'a',head:'c',changedNodes:['diagram']}],claims:[],evidence:[]};const scope=scopeFor(stack);assert.equal(scope.before,'Citations visible');assert.equal(scope.after,'Citations hidden until requested');assert.equal(scope.head,'c');});

async function replayFixture(t){
 const root=await mkdtemp(resolve(tmpdir(),'docviz-replay-integrity-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const repo=resolve(root,'repo'),dir=resolve(root,'data','stacks','fixture');await mkdir(repo);await mkdir(resolve(dir,'artifacts'),{recursive:true});
 await git(repo,['init']);await git(repo,['config','user.name','Fixture']);await git(repo,['config','user.email','fixture@example.invalid']);
 await writeFile(resolve(repo,'source.js'),'export const value = 1;\n');await git(repo,['add','.']);await git(repo,['commit','-m','Source']);
 const commit=(await git(repo,['rev-parse','HEAD'])).trim(),payload={kind:'executed-functions',commit,scenarioId:'clear',harnessDigest:'fixed-harness',frames:[{id:'outcome',observed:true,output:{level:'needs'}}],output:{level:'needs'}};
 const record={...payload,id:digest(payload)},world={id:'fixture',repository:await repositoryAt(repo),target:commit,tip:commit,layers:[],nodes:[],edges:[],claims:[],evidence:[{id:record.id}],captures:[structuredClone(record)]};
 const saveWorld=()=>writeFile(resolve(dir,'stack.json'),JSON.stringify(world));
 const saveRecord=value=>writeFile(resolve(dir,'artifacts',value.id+'.json'),JSON.stringify(value));
 await saveWorld();await saveRecord(record);return{world,record,saveWorld,saveRecord,store:createStackStore(resolve(root,'data'))};
}
test('replay uses verified capture artifacts instead of an altered inline copy',async t=>{
 const f=await replayFixture(t),inline=f.world.captures[0];
 inline.frames[0].output.level='nothing';inline.output.level='nothing';inline.commit='f'.repeat(40);inline.harnessDigest='different-harness';
 await f.saveWorld();const loaded=await f.store.read('fixture');
 assert.equal(loaded.captures[0].frames[0].output.level,'needs');
 assert.deepEqual(loaded.captures[0],f.record);
 const pair=capturePair(loaded,scopeFor(loaded),'clear');assert.equal(pair.status,'paired');
 assert.deepEqual(pair.head,await f.store.evidence('fixture',f.record.id));
});

test('reading a replay rejects a corrupt immutable capture artifact',async t=>{
 const f=await replayFixture(t);
 await f.saveRecord({...f.record,output:{level:'nothing'}});
 await assert.rejects(()=>f.store.read('fixture'),/fingerprint/);
 await assert.rejects(()=>f.store.evidence('fixture',f.record.id),/fingerprint/);
});
test('a fingerprint-valid artifact still needs a valid replay shape',async t=>{
 const f=await replayFixture(t),{id:oldId,...original}=f.record;
 for(const patch of [{frames:null},{frames:[{id:'outcome',output:{level:'needs'},observed:'yes'}]},{kind:'executed-command'}]){
  const payload={...original,...patch},record={...payload,id:digest(payload)};
  await f.saveRecord(record);f.world.captures=[{id:record.id}];await f.saveWorld();
  await assert.rejects(()=>f.store.read('fixture'),/invalid replay shape/);
 }
});
test('capture hydration rejects missing records and escaping declaration IDs',async t=>{
 const f=await replayFixture(t);
 f.world.captures=[{id:'b'.repeat(64)}];await f.saveWorld();await assert.rejects(()=>f.store.read('fixture'),{code:'ENOENT'});
 f.world.captures=[{id:'../escape'}];await f.saveWorld();await assert.rejects(()=>f.store.read('fixture'),/Unknown stack evidence/);
});
