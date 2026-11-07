import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {git,repositoryAt,digest} from '../git.mjs';
import {createSystemMapCache} from '../system-maps.mjs';
import {createWorkspace} from '../workspace.mjs';
import {createStackStore} from '../stack.mjs';
async function fixture(t){
 const root=await mkdtemp(resolve(tmpdir(),'docviz-maps-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=resolve(root,'repo'),data=resolve(root,'data');await mkdir(path);await git(path,['init']);await git(path,['config','user.name','Fixture']);await git(path,['config','user.email','fixture@example.test']);
 await writeFile(resolve(path,'producer.js'),'export const value = 1;\n');await writeFile(resolve(path,'consumer.js'),'export const consume = x => x;\n');await git(path,['add','.']);await git(path,['commit','-m','baseline']);const a=(await git(path,['rev-parse','HEAD'])).trim(),repository=await repositoryAt(path);
 const node=(id,file)=>({id,title:id,purpose:'A source interpretation',inputs:['number'],outputs:['number'],sources:[{commit:a,path:file,from:1,to:1}]});const nodes=[node('producer','producer.js'),node('consumer','consumer.js')],edges=[{id:'uses',from:'producer',to:'consumer',label:'value',basis:'source-interpretation'}];
 await writeFile(resolve(path,'producer.js'),'export const value = 2;\n');await writeFile(resolve(path,'new-effect.js'),'export const effect = true;\n');await git(path,['add','.']);await git(path,['commit','-m','new behavior']);const b=(await git(path,['rev-parse','HEAD'])).trim();return{root,path,data,repository,a,b,nodes,edges};
}
test('map snapshots persist across restart, converge on repeat writes and exclude PR verdicts',async t=>{const f=await fixture(t),maps=createSystemMapCache(f.data),first=await maps.ensure(f.repository,f.a,f.nodes.map(n=>({...n,claims:['not cached'],verified:true})),f.edges);const again=await maps.ensure(f.repository,f.a,f.nodes,f.edges);assert.equal(first.map.id,again.map.id);assert.equal(again.status,'loaded');const restored=await createSystemMapCache(f.data).read(first.map.id);assert.deepEqual(restored,first.map);assert.equal(restored.nodes[0].claims,undefined);assert.equal(restored.nodes[0].verified,undefined);assert.equal(restored.evidence,undefined);assert.equal(restored.authority,'source-interpretation');});
test('a later PR references the stored baseline and exposes source, dependency and coverage gaps',async t=>{const f=await fixture(t),maps=createSystemMapCache(f.data),stored=await maps.ensure(f.repository,f.a,f.nodes,f.edges);const original=await readFile(resolve(f.data,'system-maps','snapshots',stored.map.id+'.json'),'utf8');const stack={id:'new-pr',repository:f.repository,target:f.a,tip:f.b,baseMapId:stored.map.id,mapOverlay:{},claims:[],evidence:[]};await mkdir(resolve(f.data,'stacks','new-pr'),{recursive:true});await writeFile(resolve(f.data,'stacks','new-pr','stack.json'),JSON.stringify(stack));const view=await createStackStore(f.data).read('new-pr');assert.equal(view.systemMap.baseMapId,stored.map.id);assert.equal(view.nodes.length,2);assert.equal(view.claims.length,0);assert.deepEqual(view.systemMap.overlay.sourceChanged,['producer']);assert.deepEqual(view.systemMap.overlay.downstreamContext,['consumer']);assert.ok(view.systemMap.overlay.unmappedChangedFiles.includes('new-effect.js'));assert.ok(view.systemMap.outdatedNodes.includes('producer'));assert.equal(await readFile(resolve(f.data,'system-maps','snapshots',stored.map.id+'.json'),'utf8'),original);const repeated=await createStackStore(f.data).read('new-pr');assert.equal(repeated.systemMap.candidateMapId,view.systemMap.candidateMapId);const review=await(await createWorkspace(f.data)).open({repositoryPath:f.path,baseRef:f.a,headRef:f.b,mode:'direct'});assert.equal(review.systemMapReference.mapId,stored.map.id);assert.equal(review.systemMapReference.status,'exact-base');assert.deepEqual(review.evidence,[]);assert.deepEqual(review.review.propertyDecisions,{});});
test('contract-only and relation changes are not mistaken for unchanged explanations',async t=>{const f=await fixture(t),maps=createSystemMapCache(f.data),base=await maps.ensure(f.repository,f.a,f.nodes,f.edges);const changed=await maps.forStack({repository:f.repository,target:f.a,tip:f.a,baseMapId:base.map.id,mapOverlay:{nodes:[{...f.nodes[0],outputs:['string']}]}});assert.ok(changed.systemMap.overlay.updated.includes('producer'));assert.ok(changed.systemMap.overlay.downstreamContext.includes('consumer'));const relation=await maps.forStack({repository:f.repository,target:f.a,tip:f.a,baseMapId:base.map.id,mapOverlay:{edges:[{...f.edges[0],label:'new contract'}]}});assert.ok(relation.systemMap.overlay.directlyAffected.includes('consumer'));const ambiguous=await maps.at(f.repository.id,f.a);assert.equal(ambiguous.status,'ambiguous');assert.equal(ambiguous.map,null);assert.equal((await maps.at(f.repository.id,f.a,base.map.id)).map.id,base.map.id);});
test('a map from another base or repository, or a corrupted snapshot, cannot be reused',async t=>{const f=await fixture(t),maps=createSystemMapCache(f.data),base=await maps.ensure(f.repository,f.a,f.nodes,f.edges);await assert.rejects(()=>maps.at(f.repository.id,f.b,base.map.id),/exact base/);await assert.rejects(()=>maps.at('b'.repeat(24),f.a,base.map.id),/repository/);const path=resolve(f.data,'system-maps','snapshots',base.map.id+'.json'),record=JSON.parse(await readFile(path));record.nodes[0].purpose='silently edited';await writeFile(path,JSON.stringify(record));await assert.rejects(()=>maps.read(base.map.id),/fingerprint/);});
test('nested evidence flags never enter the shared description cache',async t=>{const f=await fixture(t),maps=createSystemMapCache(f.data);const source={...f.nodes[0].sources[0],verified:true,jev:{result:'pass'}};const node={...f.nodes[0],sources:[source],steps:[{title:'Explain',detail:'Source interpretation',sources:[source],evidence:['old-run'],verified:true}],pseudocode:[{text:'return a number',indent:0,sources:[source],jev:{result:'pass'}}]};const{map}=await maps.ensure(f.repository,f.a,[node],[]);assert.equal(map.nodes[0].steps[0].evidence,undefined);assert.equal(map.nodes[0].steps[0].verified,undefined);assert.equal(map.nodes[0].pseudocode[0].jev,undefined);assert.equal(map.nodes[0].sources[0].verified,undefined);});
test('unreadable source revisions fail without poisoning the cache; confirmed missing files stay explicit',async t=>{const f=await fixture(t),maps=createSystemMapCache(f.data);await assert.rejects(()=>maps.ensure(f.repository,f.a,[{...f.nodes[0],sources:[{...f.nodes[0].sources[0],commit:'f'.repeat(40)}]}],[]));assert.equal((await maps.at(f.repository.id,f.a)).status,'missing');const missing=await maps.ensure(f.repository,f.a,[{...f.nodes[0],sources:[{commit:f.a,path:'absent.js',from:1,to:1}]}],[]);assert.equal(missing.map.sourceFiles[0].blob,null);assert.deepEqual(missing.map.outdatedNodes,['producer']);});


test('structured values cannot hide metadata inside declared description fields',async t=>{
 const f=await fixture(t),node=f.nodes[0];
 const bad=[
  ['purpose',{...node,purpose:{claims:['old claim']}},[]],
  ['null purpose',{...node,purpose:null},[]],
  ['input item',{...node,inputs:[{evidence:['old run']}]},[]],
  ['output list',{...node,outputs:{verified:true}},[]],
  ['step detail',{...node,steps:[{title:'Step',detail:{reviewDecision:'approved'}}]},[]],
  ['pseudocode text',{...node,pseudocode:[{text:{verified:true}}]},[]],
  ['edge label',node,[{id:'self',from:node.id,to:node.id,label:{jev:'supports'}}]],
 ];
 for(const[label,value,edges]of bad)await t.test(label,async()=>{
  const maps=createSystemMapCache(resolve(f.data,label));
  await assert.rejects(()=>maps.ensure(f.repository,f.a,[value],edges));
  assert.equal((await maps.at(f.repository.id,f.a)).status,'missing');
 });
});

test('malformed graph containers and source coordinates fail before an index is written',async t=>{
 const f=await fixture(t),node=f.nodes[0],source=node.sources[0];
 const bad=[
  ['source container',{...node,sources:{path:'producer.js'}}],
  ['null sources',{...node,sources:null}],
  ['string coordinate',{...node,sources:[{...source,from:'1'}]}],
  ['zero coordinate',{...node,sources:[{...source,from:0}]}],
  ['reversed range',{...node,sources:[{...source,from:2,to:1}]}],
  ['step container',{...node,steps:{title:'Step'}}],
  ['fractional indent',{...node,pseudocode:[{text:'return value',indent:.5}]}],
  ['missing id',{...node,id:undefined}],
 ];
 for(const[label,value]of bad)await t.test(label,async()=>{
  const maps=createSystemMapCache(resolve(f.data,label));
  await assert.rejects(()=>maps.ensure(f.repository,f.a,[value],[]));
  assert.equal((await maps.at(f.repository.id,f.a)).status,'missing');
 });
});

const canonicalForFixture=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
test('read rejects a correctly fingerprinted v1 record with malformed description values',async t=>{
 const f=await fixture(t),maps=createSystemMapCache(f.data),stored=await maps.ensure(f.repository,f.a,f.nodes,f.edges);
 const{id,...payload}=stored.map;
 assert.equal(digest(canonicalForFixture(payload)),id);
 payload.nodes[0].purpose={claims:['persisted before schema validation']};
 const forgedId=digest(canonicalForFixture(payload));
 await writeFile(resolve(f.data,'system-maps','snapshots',forgedId+'.json'),JSON.stringify({...payload,id:forgedId}));
 await assert.rejects(()=>maps.read(forgedId));
});

test('schema validation preserves empty graphs and inclusive single-line sources',async t=>{
 const f=await fixture(t),maps=createSystemMapCache(f.data),empty=await maps.ensure(f.repository,f.a,[],[]);
 assert.deepEqual(empty.map.nodes,[]);assert.deepEqual(empty.map.edges,[]);
 const node={...f.nodes[0],steps:[{title:'Read',detail:'Source explanation',sources:[]}],pseudocode:[{text:'read value',indent:0,sources:[]}],claims:['discarded']};
 const saved=await maps.ensure(f.repository,f.a,[node],[]),again=await maps.ensure(f.repository,f.a,[{...node,claims:['another old claim']}],[]);
 assert.equal(saved.map.id,again.map.id);assert.deepEqual(await maps.read(saved.map.id),saved.map);
 assert.deepEqual(saved.map.nodes[0].sources,[f.nodes[0].sources[0]]);
});

test('source ranges beyond their anchored blob cannot be stored or reused',async t=>{
 const f=await fixture(t),maps=createSystemMapCache(f.data),badNode={...f.nodes[0],sources:[{...f.nodes[0].sources[0],from:999,to:999}]};
 await assert.rejects(()=>maps.ensure(f.repository,f.a,[badNode],[]),/source range.*exceeds/i);
 assert.equal((await maps.at(f.repository.id,f.a)).status,'missing');
});

test('a previously indexed out-of-file anchor is rejected before a cache hit is reused',async t=>{
 const f=await fixture(t),maps=createSystemMapCache(f.data),saved=await maps.ensure(f.repository,f.a,[f.nodes[0]],[]),{id,...payload}=saved.map;
 payload.nodes[0].sources[0].from=999;payload.nodes[0].sources[0].to=999;
 payload.definitionHash=digest(canonicalForFixture({schema:1,nodes:payload.nodes,edges:payload.edges}));
 const oldId=digest(canonicalForFixture(payload));
 await writeFile(resolve(f.data,'system-maps','snapshots',oldId+'.json'),JSON.stringify({...payload,id:oldId}));
 await writeFile(resolve(f.data,'system-maps','revisions',f.repository.id,f.a,payload.definitionHash+'.json'),JSON.stringify({id:oldId}));
 await assert.rejects(()=>maps.ensure(f.repository,f.a,payload.nodes,payload.edges),/source range.*exceeds/i);
});
