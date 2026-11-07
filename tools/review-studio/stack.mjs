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
 const readStack=async id=>{const stack=await load(id),mapped=await maps.forStack(stack);return{...stack,...mapped,claims:stack.claims||[],evidence:stack.evidence||[],captures:stack.captures||[],jevConfigured:!!process.env.TYPESAFE_API_KEY};};
 return{
  async list(){let names;try{names=await readdir(resolve(dataRoot,'stacks'));}catch(e){if(e.code==='ENOENT')return[];throw e;}const rows=[];for(const id of names)try{const s=await load(id);rows.push({id:s.id,title:s.title,repositoryName:s.repository?.name||s.repositoryName||'Repository',kind:s.kind,numbers:(s.layers||[]).map(l=>l.number)});}catch{}return rows;},
  read:readStack,
  map:id=>maps.read(id),
  async evidence(id,artifactId){if(!/^[a-f0-9]{64}$/.test(artifactId))throw new Error('Unknown stack evidence.');const stack=await load(id);if(![...stack.evidence,...stack.captures].some(e=>e.id===artifactId))throw new Error('This evidence does not belong to the stack.');const artifact=await json(resolve(folder(id),'artifacts',artifactId+'.json'));const{ id:storedId, ...payload }=artifact;if(storedId!==artifactId||digest(payload)!==artifactId)throw new Error('Stored evidence fingerprint does not match.');return artifact;},
  async source(id,commit,path){const stack=await readStack(id);const anchors=[...stack.nodes.flatMap(n=>[...(n.sources||[]),...(n.steps||[]).flatMap(x=>x.sources||[]),...(n.pseudocode||[]).flatMap(x=>x.sources||[])]),...stack.claims.flatMap(c=>c.sources||[])];if(![stack.target,...(stack.layers||[]).map(l=>l.head),...anchors.map(a=>a.commit)].includes(commit))throw new Error('Source revision is outside this stack.');if(!anchors.some(a=>a.path===path))throw new Error('This source path is outside the declared stack model.');const text=await git(stack.repository.path,['show',commit+':'+path]);if(Buffer.byteLength(text)>750000)throw new Error('Source is too large for this viewer.');const blob=(await git(stack.repository.path,['rev-parse',commit+':'+path])).trim();return{commit,path,blob,text};}
 };
}
