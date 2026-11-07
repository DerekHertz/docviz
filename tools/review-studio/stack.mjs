import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createSystemMapCache} from './system-maps.mjs';
import {git,digest} from './git.mjs';
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const validId=id=>{if(!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id))throw new Error('Unknown stack.');return id;};
export function createStackStore(dataRoot){
 const folder=id=>resolve(dataRoot,'stacks',validId(id));
 const load=id=>json(resolve(folder(id),'stack.json'));
 const maps=createSystemMapCache(dataRoot);
 async function artifact(id,stack,artifactId){
  if(!/^[a-f0-9]{64}$/.test(artifactId))throw new Error('Unknown stack evidence.');
  if(![...(stack.evidence||[]),...(stack.captures||[])].some(e=>e.id===artifactId))throw new Error('This evidence does not belong to the stack.');
  const record=await json(resolve(folder(id),'artifacts',artifactId+'.json'));
  const{id:storedId,...payload}=record;if(storedId!==artifactId||digest(payload)!==artifactId)throw new Error('Stored evidence fingerprint does not match.');return record;
 }
 function evidenceCard(stack,declared,record){
  const failed=Number.isInteger(record.exitCode)&&record.exitCode!==0||['fail','failed','error','interrupted'].includes(record.status);
  const result=failed?'fail':typeof record.result==='string'?record.result:record.exitCode===0||['pass','passed','success','succeeded','completed'].includes(record.status)?'pass':'unknown';
  const kind=typeof record.kind==='string'?record.kind:'unknown';
  const title=typeof record.title==='string'&&record.title.trim()?record.title:kind==='executed-functions'?'Captured function execution':kind==='executed-command'?'Executed command':'Recorded evidence';
  const scope=typeof record.scope==='string'?record.scope:typeof record.environment==='string'?record.environment:'Inspect the immutable record for its execution scope.';
  const counts=typeof record.output==='string'?record.output.match(/^# (?:pass|fail|skipped) \d+$/gm):null;
  const summary=typeof record.summary==='string'&&record.summary.trim()?record.summary:result==='fail'?'Execution failed; inspect the recorded output.':counts?.length?counts.map(line=>line.slice(2)).join(' · '):result==='pass'?kind==='executed-functions'?'Execution completed; inspect captured outputs and limitations.':'Command completed successfully; inspect its assertions.':'No successful execution status is recorded.';
  const association=record.layerId||declared.layerId,layer=stack.layers?.find(item=>item.id===association&&item.head===record.commit);
  return{id:record.id,kind,commit:record.commit,title,scope,summary,result,...(record.status!==undefined?{status:record.status}:{}),...(record.exitCode!==undefined?{exitCode:record.exitCode}:{}),...(record.createdAt||record.startedAt?{createdAt:record.createdAt||record.startedAt}:{}),...(layer?{layerId:layer.id}:{})};
 }
 const readStack=async id=>{
  const stack=await load(id),captures=[],evidence=[];
  for(const declared of stack.captures||[]){
   const captured=await artifact(id,stack,declared.id);
   if(captured.kind!=='executed-functions'||!(/^[a-f0-9]{40,64}$/).test(captured.commit)||typeof captured.scenarioId!=='string'||!captured.scenarioId.trim()||typeof captured.harnessDigest!=='string'||!captured.harnessDigest.trim()||!Array.isArray(captured.frames)||!captured.frames.length||captured.frames.some(frame=>!frame||typeof frame.id!=='string'||!frame.id.trim()||typeof frame.observed!=='boolean'||!Object.hasOwn(frame,'output'))||new Set(captured.frames.map(frame=>frame.id)).size!==captured.frames.length)throw new Error('Stored capture has an invalid replay shape.');
   captures.push(captured);
  }
  for(const declared of stack.evidence||[])evidence.push(evidenceCard(stack,declared,await artifact(id,stack,declared.id)));
  const mapped=await maps.forStack(stack);return{...stack,...mapped,claims:stack.claims||[],evidence,captures,jevConfigured:!!process.env.TYPESAFE_API_KEY};
 };
 return{
  async forReview(doc){
   let names;try{names=await readdir(resolve(dataRoot,'stacks'));}catch(e){if(e.code==='ENOENT')return{status:'missing'};throw e;}
   const matches=[];for(const id of names){let candidate;try{candidate=await load(id);}catch{continue;}if(candidate.repository?.id===doc.repository.id&&candidate.target===doc.snapshot.base.commit&&candidate.tip===doc.snapshot.head.commit)matches.push(id);}
   if(matches.length!==1)return{status:matches.length?'ambiguous':'missing',stackIds:matches};
   return{status:'available',stack:await readStack(matches[0])};
  },
  async list(){let names;try{names=await readdir(resolve(dataRoot,'stacks'));}catch(e){if(e.code==='ENOENT')return[];throw e;}const rows=[];for(const id of names)try{const s=await load(id);rows.push({id:s.id,title:s.title,repositoryName:s.repository?.name||s.repositoryName||'Repository',kind:s.kind,numbers:(s.layers||[]).map(l=>l.number)});}catch{}return rows;},
  read:readStack,
  map:id=>maps.read(id),
  async evidence(id,artifactId){return artifact(id,await load(id),artifactId);},
  async source(id,commit,path){const stack=await readStack(id);const anchors=[...stack.nodes.flatMap(n=>[...(n.sources||[]),...(n.steps||[]).flatMap(x=>x.sources||[]),...(n.pseudocode||[]).flatMap(x=>x.sources||[])]),...stack.claims.flatMap(c=>c.sources||[])];if(![stack.target,...(stack.layers||[]).map(l=>l.head),...anchors.map(a=>a.commit)].includes(commit))throw new Error('Source revision is outside this stack.');if(!anchors.some(a=>a.path===path))throw new Error('This source path is outside the declared stack model.');const text=await git(stack.repository.path,['show',commit+':'+path]);if(Buffer.byteLength(text)>750000)throw new Error('Source is too large for this viewer.');const blob=(await git(stack.repository.path,['rev-parse',commit+':'+path])).trim();return{commit,path,blob,text};}
 };
}
