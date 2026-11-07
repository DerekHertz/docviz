import {readFile,writeFile,mkdir,rename,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {git,digest} from './git.mjs';
const SCHEMA=1;
const clean=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hash=value=>digest(canonical(value));
const validHash=id=>{if(!/^[a-f0-9]{64}$/.test(id||''))throw new Error('Invalid stored map ID.');return id;};
const validRepo=id=>{if(!/^[a-f0-9]{24,64}$/.test(id||''))throw new Error('Use a registered repository for stored maps.');return id;};
const validCommit=commit=>{if(!/^[a-f0-9]{40,64}$/.test(commit||''))throw new Error('Stored maps require an exact commit.');return commit;};
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const maybe=async path=>{try{return await json(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)&&value[k]!==undefined).map(k=>[k,clean(value[k])]));
const ownList=(value,key)=>Object.hasOwn(value,key)&&value[key]!==undefined?value[key]:[];
const invalid=path=>{throw new Error('Invalid stored map schema at '+path+'.');};
function record(value,path){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))invalid(path);}
function stringField(value,key,path,required=false){if(!Object.hasOwn(value,key)||value[key]===undefined){if(required)invalid(path+'.'+key);return;}if(typeof value[key]!=='string')invalid(path+'.'+key);}
function identifier(value,key,path){stringField(value,key,path,true);if(!value[key].trim())invalid(path+'.'+key);}
function items(value,path,visit){if(!Array.isArray(value))invalid(path);for(const[i,item]of value.entries())visit(item,path+'['+i+']');}
function fieldItems(value,key,path,visit){if(Object.hasOwn(value,key)&&value[key]!==undefined)items(value[key],path+'.'+key,visit);}
function relativePath(value,path){if(typeof value!=='string'||!value||value.startsWith('/')||value.split('/').includes('..')||value.includes('\0'))invalid(path);}
function validateGraph(nodes,edges){
 const sources=(value,path)=>{record(value,path);stringField(value,'commit',path,true);validCommit(value.commit);stringField(value,'path',path,true);relativePath(value.path,path+'.path');if(!Object.hasOwn(value,'from')||!Object.hasOwn(value,'to')||!Number.isSafeInteger(value.from)||value.from<1||!Number.isSafeInteger(value.to)||value.to<value.from)invalid(path+'.range');};
 const strings=(value,path)=>{if(typeof value!=='string')invalid(path);};
 items(nodes,'nodes',(node,path)=>{record(node,path);identifier(node,'id',path);for(const key of['title','purpose'])stringField(node,key,path);for(const key of['inputs','outputs'])fieldItems(node,key,path,strings);fieldItems(node,'sources',path,sources);
  fieldItems(node,'steps',path,(step,path)=>{record(step,path);stringField(step,'title',path,true);stringField(step,'detail',path);fieldItems(step,'sources',path,sources);});
  fieldItems(node,'pseudocode',path,(step,path)=>{record(step,path);stringField(step,'text',path,true);if(Object.hasOwn(step,'indent')&&step.indent!==undefined&&(!Number.isSafeInteger(step.indent)||step.indent<0))invalid(path+'.indent');fieldItems(step,'sources',path,sources);});
 });
 items(edges,'edges',(edge,path)=>{record(edge,path);for(const key of['id','from','to'])identifier(edge,key,path);for(const key of['label','basis'])stringField(edge,key,path);});
 const nodeIds=new Set(nodes.map(n=>n.id)),edgeIds=new Set(edges.map(e=>e.id));if(nodeIds.size!==nodes.length||edgeIds.size!==edges.length||edges.some(e=>!nodeIds.has(e.from)||!nodeIds.has(e.to)))throw new Error('Stored map has duplicate IDs or dangling connections.');
}
function graphOf(nodes=[],edges=[]){
 validateGraph(nodes,edges);
 const sources=refs=>refs.map(s=>pick(s,['commit','path','from','to']));
 const graph={nodes:nodes.map(n=>({...pick(n,['id','title','purpose','inputs','outputs']),sources:sources(ownList(n,'sources')),steps:ownList(n,'steps').map(step=>({...pick(step,['title','detail']),sources:sources(ownList(step,'sources'))})),pseudocode:ownList(n,'pseudocode').map(step=>({...pick(step,['text','indent']),sources:sources(ownList(step,'sources'))}))})).sort((a,b)=>a.id.localeCompare(b.id)),edges:edges.map(e=>pick(e,['id','from','to','label','basis'])).sort((a,b)=>a.id.localeCompare(b.id))};
 return graph;
}
const sourceRefs=node=>[...(node.sources||[]),...(node.steps||[]).flatMap(s=>s.sources||[]),...(node.pseudocode||[]).flatMap(s=>s.sources||[])];
const omitCommits=value=>Array.isArray(value)?value.map(omitCommits):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>k!=='commit').map(([k,v])=>[k,omitCommits(v)])):value;
export function compareMaps(base,candidate,changedPaths=[]){
 const before=new Map(base.nodes.map(n=>[n.id,n])),after=new Map(candidate.nodes.map(n=>[n.id,n]));
 const added=[],removed=[],updated=[],sourceChanged=[],outdated=[],reused=[];
 const paths=map=>new Map(map.sourceFiles.map(s=>[s.path,s.blob]));const oldFiles=paths(base),newFiles=paths(candidate);
 for(const[id,n]of before)if(!after.has(id))removed.push(id);
 for(const[id,n]of after){if(!before.has(id)){added.push(id);continue;}const refs=sourceRefs(n),old=before.get(id),changed=refs.some(s=>oldFiles.get(s.path)!==newFiles.get(s.path));const modelChanged=hash(omitCommits(n))!==hash(omitCommits(old));if(modelChanged)updated.push(id);if(changed)sourceChanged.push(id);if(candidate.outdatedNodes.includes(id))outdated.push(id);if(!changed&&!modelChanged&&!candidate.outdatedNodes.includes(id))reused.push(id);}
 const edgesBefore=new Map(base.edges.map(e=>[e.id,e])),edgesAfter=new Map(candidate.edges.map(e=>[e.id,e]));
 const relationTouched=new Set();for(const id of new Set([...edgesBefore.keys(),...edgesAfter.keys()])){const a=edgesBefore.get(id),b=edgesAfter.get(id);if(hash(a||null)!==hash(b||null))for(const edge of[a,b])if(edge){relationTouched.add(edge.from);relationTouched.add(edge.to);}}
 const direct=[...new Set([...added,...removed,...updated,...sourceChanged,...outdated,...relationTouched])];const reachable=new Set(direct),queue=[...direct];while(queue.length){const id=queue.shift();for(const edge of[...base.edges,...candidate.edges])if(edge.from===id&&!reachable.has(edge.to)){reachable.add(edge.to);queue.push(edge.to);}}
 const mapped=new Set([...base.sourceFiles,...candidate.sourceFiles].map(s=>s.path));
 return{added,removed,updated,sourceChanged,outdated,reused,directlyAffected:direct,downstreamContext:[...reachable].filter(id=>!direct.includes(id)),unmappedChangedFiles:changedPaths.filter(p=>!mapped.has(p)),meaning:'Reuse describes unchanged source context, not newly verified behavior. Recorded relations do not establish complete dependency coverage.'};
}
export function createSystemMapCache(dataRoot){
 const root=resolve(dataRoot,'system-maps');
 const mapPath=id=>resolve(root,'snapshots',validHash(id)+'.json');
 const revisionPath=(repoId,commit)=>resolve(root,'revisions',validRepo(repoId),validCommit(commit));
 async function atomic(path,value){const prior=await maybe(path);if(prior){if(canonical(prior)!==canonical(value))throw new Error('An immutable map record already exists with different content.');return;}await mkdir(dirname(path),{recursive:true});const temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(value,null,2)+'\n');await rename(temporary,path);}
 async function read(id){const record=await json(mapPath(id)),{id:storedId,...payload}=record;if(storedId!==id||hash(payload)!==id)throw new Error('Stored system map fingerprint does not match.');if(record.schema!==SCHEMA)throw new Error('Stored system map schema is incompatible.');const graph=graphOf(record.nodes,record.edges);if(canonical(graph)!==canonical({nodes:record.nodes,edges:record.edges}))throw new Error('Stored map schema contains undeclared or unnormalized graph fields.');return record;}
 async function at(repositoryId,commit,explicitId){
  validRepo(repositoryId);validCommit(commit);
  if(explicitId){const map=await read(explicitId);if(map.repositoryId!==repositoryId||map.commit!==commit)throw new Error('Stored map does not match this repository and exact base revision.');return{status:'exact',map};}
  let names;try{names=(await readdir(revisionPath(repositoryId,commit))).filter(n=>/^[a-f0-9]{64}\.json$/.test(n));}catch(e){if(e.code==='ENOENT')return{status:'missing',map:null};throw e;}
  if(!names.length)return{status:'missing',map:null};if(names.length>1)return{status:'ambiguous',map:null};const ref=await json(resolve(revisionPath(repositoryId,commit),names[0]));return at(repositoryId,commit,ref.id);
 }
 async function ensure(repository,commit,nodes,edges){
  const repositoryId=validRepo(repository.id);validCommit(commit);const graph=graphOf(nodes,edges),definitionHash=hash({schema:SCHEMA,...graph}),index=resolve(revisionPath(repositoryId,commit),definitionHash+'.json'),existing=await maybe(index);
  if(existing){const map=await read(existing.id);if(map.repositoryId!==repositoryId||map.commit!==commit||map.definitionHash!==definitionHash)throw new Error('Stored map index does not match its snapshot.');return{map,status:'loaded'};}
  if((await git(repository.path,['rev-parse','--verify',commit+'^{commit}'])).trim()!==commit)throw new Error('The mapped revision is not available in this repository.');
  const refs=graph.nodes.flatMap(sourceRefs),files=new Map();
  const blob=async(rev,path)=>{const key=rev+':'+path;if(!files.has(key)){const entry=await git(repository.path,['ls-tree','-z',rev,'--',path]);const match=entry.match(/^100\d+ blob ([a-f0-9]{40,64})\t/);files.set(key,match?match[1]:null);}return files.get(key);};
  const sourceFiles=[];for(const path of [...new Set(refs.map(s=>s.path))].sort())sourceFiles.push({path,blob:await blob(commit,path)});
  const current=new Map(sourceFiles.map(f=>[f.path,f.blob])),outdatedNodes=[];
  for(const node of graph.nodes){let stale=false;for(const s of sourceRefs(node)){const origin=await blob(s.commit,s.path);if(!origin||origin!==current.get(s.path))stale=true;}if(stale)outdatedNodes.push(node.id);}
  const payload={schema:SCHEMA,repositoryId,commit,definitionHash,...graph,sourceFiles,outdatedNodes,coverage:{mappedPaths:sourceFiles.map(s=>s.path),basis:'Declared source anchors only; not exhaustive repository or dependency coverage.'},authority:'source-interpretation'};
  const map={...payload,id:hash(payload)};await atomic(mapPath(map.id),map);await atomic(index,{id:map.id});return{map,status:'stored'};
 }
 async function assessment(repository,base,head){const match=await at(repository.id,base);if(!match.map)return{status:match.status,mapId:null};const candidate=await ensure(repository,head,match.map.nodes,match.map.edges),changedPaths=(await git(repository.path,['diff','--name-only','--no-renames',base,head])).trim().split('\n').filter(Boolean);return{status:'exact-base',mapId:match.map.id,base,head,overlay:compareMaps(match.map,candidate.map,changedPaths)};}
 async function forStack(stack){
  const repository=stack.repository;validRepo(repository.id);validCommit(stack.target);validCommit(stack.tip);
  const base=await at(repository.id,stack.target,stack.baseMapId);
  let nodes,edges;
  if(stack.mapOverlay){if(!base.map)throw new Error('This PR overlay requires an explicit, compatible stored base map.');const patch=stack.mapOverlay,n=new Map(base.map.nodes.map(x=>[x.id,x])),e=new Map(base.map.edges.map(x=>[x.id,x]));for(const id of patch.removeNodeIds||[])n.delete(id);for(const id of patch.removeEdgeIds||[])e.delete(id);for(const item of patch.nodes||[])n.set(item.id,item);for(const item of patch.edges||[])e.set(item.id,item);nodes=[...n.values()];edges=[...e.values()];}
  else{nodes=stack.nodes||[];edges=stack.edges||[];}
  const candidate=await ensure(repository,stack.tip,nodes,edges);
  const changes=(await git(repository.path,['diff','--name-only','--no-renames',stack.target,stack.tip])).trim().split('\n').filter(Boolean);
  const overlay=base.map?compareMaps(base.map,candidate.map,changes):{reused:[],directlyAffected:[],downstreamContext:[],unmappedChangedFiles:changes.filter(p=>!candidate.map.coverage.mappedPaths.includes(p)),meaning:'No exact stored baseline map is bound to this historical comparison.'};
  const refs={schema:SCHEMA,repositoryId:repository.id,target:stack.target,tip:stack.tip,baseMapId:base.map?.id||null,candidateMapId:candidate.map.id,baseStatus:base.status};
  const bindingId=hash(refs);await atomic(resolve(root,'bindings',bindingId+'.json'),refs);
  const context=new Map([...stack.nodes||[],...stack.mapOverlay?.nodes||[]].map(n=>[n.id,n]));
  return{nodes:candidate.map.nodes.map(n=>({...n,...(context.get(n.id)?.introducedBy?{introducedBy:context.get(n.id).introducedBy}:{})})),edges:candidate.map.edges,systemMap:{...refs,bindingId,status:candidate.status,nodeCount:candidate.map.nodes.length,edgeCount:candidate.map.edges.length,outdatedNodes:candidate.map.outdatedNodes,coverage:candidate.map.coverage,overlay,authority:'Cached descriptions; PR claims, checks, evidence and decisions are separate.'}};
 }
 return{read,at,ensure,assessment,forStack};
}
