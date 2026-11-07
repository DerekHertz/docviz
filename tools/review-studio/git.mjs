import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, lstat, readFile } from 'node:fs/promises';
import { resolve, posix, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
const exec = promisify(execFile);
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const safeGit = ['--no-optional-locks','--literal-pathspecs','-c','core.fsmonitor=','-c','core.hooksPath=/dev/null','-c','diff.external=','-c','core.pager=cat'];
const environment = {...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GIT_NO_REPLACE_OBJECTS:'1'};
export async function git(root,args,options={}) {
 try { const {stdout}=await exec('git',[...safeGit,'-C',root,...args],{env:environment,maxBuffer:20*1024*1024,timeout:30000,...options});return stdout; }
 catch(error){throw Object.assign(new Error(String(error.stderr||error.message).trim().slice(0,1600)),{status:400});}
}
export async function repositoryAt(input) {
 if(typeof input!=='string'||!input.trim()||input.includes('\0'))throw new Error('Choose a Git repository folder.');
 const path=await realpath(input.startsWith('~/')?resolve(homedir(),input.slice(2)):resolve(input));
 const bare=(await git(path,['rev-parse','--is-bare-repository'])).trim()==='true';
 const root=bare?path:(await git(path,['rev-parse','--show-toplevel'])).trim();
 let remote='';try{remote=(await git(root,['config','--get','remote.origin.url'])).trim().replace(/(https?:\/\/)[^/@]+@/,'$1');}catch{}
 const name=(remote.split('/').at(-1)||basename(root)).replace(/\.git$/,'');
 return {id:digest(root).slice(0,24),path:root,name,bare,remote};
}
export async function resolveCommit(repo,ref) {
 if(typeof ref!=='string'||!ref.trim()||ref.length>250||ref.includes('\0'))throw new Error('Enter a valid Git branch or commit.');
 const commit=(await git(repo.path,['rev-parse','--verify','--end-of-options',`${ref}^{commit}`])).trim();
 if(!/^[a-f0-9]{40,64}$/.test(commit))throw new Error('Git did not resolve the requested commit.');return commit;
}
export async function repositoryRefs(repo) {
 const text=await git(repo.path,['for-each-ref','--sort=-committerdate','--format=%(refname:short)\t%(objectname)','refs/heads','refs/remotes']);
 const refs=text.trim().split('\n').filter(Boolean).map(line=>{const[name,commit]=line.split('\t');return{name,commit};});
 let active='HEAD';try{active=(await git(repo.path,['symbolic-ref','--quiet','--short','HEAD'])).trim();}catch{}
 let defaultBase=refs.find(x=>x.name==='origin/main')?.name||refs.find(x=>x.name==='origin/master')?.name||refs.find(x=>x.name==='main')?.name||refs.find(x=>x.name==='master')?.name||'HEAD~1';
 return {refs,active,defaultBase};
}
async function treeAt(repo,commit) {
 const text=await git(repo.path,['ls-tree','-r','-z','-l',commit]);
 return text.split('\0').filter(Boolean).map(entry=>{const at=entry.indexOf('\t'),[mode,type,blob,size]=entry.slice(0,at).trim().split(/\s+/);return{path:entry.slice(at+1),mode,type,blob,size:Number(size)||0};});
}
export function parseChanges(text) {
 const parts=text.split('\0'),files=[];
 for(let i=0;i<parts.length&&parts[i];){const status=parts[i++];if(status[0]==='R'||status[0]==='C'){const oldPath=parts[i++],path=parts[i++];files.push({status:status[0],oldPath,path});}else files.push({status:status[0],path:parts[i++]});}
 return files;
}
export async function sourceAt(repo,snapshot,path,side='head') {
 if(!['base','head'].includes(side)||typeof path!=='string')throw new Error('Choose a source revision and path.');
 const entry=snapshot.tree[side].find(x=>x.path===path);
 if(!entry||entry.type!=='blob'||!/^100/.test(entry.mode))throw new Error('This path is not a regular source file at the selected revision.');
 if(entry.size>750000)throw new Error('This file is larger than the source viewer limit (750 KB). It remains listed in the change.');
 const bytes=await git(repo.path,['cat-file','blob',entry.blob],{encoding:'buffer'});
 if(bytes.includes(0))throw new Error('Binary content is listed but not rendered as source.');
 return {path,side,commit:snapshot[side].commit,blob:entry.blob,text:bytes.toString('utf8')};
}
export async function diffAt(repo,snapshot,path) {
 const file=snapshot.files.find(f=>f.path===path);if(!file)throw new Error('This file is not changed in the selected comparison.');
 const args=['diff','--no-ext-diff','--no-textconv','--find-renames','--unified=4',snapshot.base.commit,snapshot.head.commit,'--',file.path];
 if(file.oldPath)args.push(file.oldPath);
 const text=await git(repo.path,args);return {path,text:text.length>400000?text.slice(0,400000):text,truncated:text.length>400000};
}
const codeFile=path=>/\.(?:[cm]?[jt]sx?|py|go|rs|java|c|cc|cpp|h|hpp|swift|rb|php|vue|svelte)$/i.test(path)&&!/(?:^|\/)(?:vendor|dist|build|node_modules)\//.test(path)&&!/(?:\.min\.[jt]s|\.d\.ts)$/.test(path);
function groupKey(path) {const parts=path.split('/');return parts.length===1?'Repository':parts[0]==='src'&&parts.length>2?parts.slice(0,2).join('/'):parts[0];}
export function structuralComponents(tree,files) {
 const groups=new Map();const changed=new Set(files.map(f=>f.path));
 for(const file of tree){if(file.type!=='blob'||!/^100/.test(file.mode)||(!codeFile(file.path)&&!changed.has(file.path)))continue;const key=groupKey(file.path);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(file.path);}
 for(const f of files){const key=groupKey(f.path);if(!groups.has(key))groups.set(key,[]);if(!groups.get(key).includes(f.path))groups.get(key).push(f.path);}
 return [...groups].map(([title,paths])=>({id:'component-'+digest(title).slice(0,12),title,responsibility:'',basis:'directory-derived',files:paths,changedFiles:paths.filter(p=>changed.has(p)),inputs:[],outputs:[],behavior:[]})).sort((a,b)=>b.changedFiles.length-a.changedFiles.length||a.title.localeCompare(b.title));
}
async function indexRelationships(repo,snapshot,components) {
 const omissions=[],fileRelationships=[],allPaths=new Set(snapshot.tree.head.map(f=>f.path)),owner=new Map(components.flatMap(c=>c.files.map(p=>[p,c.id]))),links=new Map();let indexed=0,bytes=0;
 const candidates=snapshot.tree.head.filter(f=>codeFile(f.path)&&f.type==='blob'&&/^100/.test(f.mode)).sort((a,b)=>Number(snapshot.files.some(f=>f.path===b.path))-Number(snapshot.files.some(f=>f.path===a.path)));
 for(const file of candidates){
  if(indexed>=400||bytes+file.size>3000000||file.size>80000){omissions.push({path:file.path,reason:'Import scan limit; file still available in source review.'});continue;}
  const source=(await git(repo.path,['cat-file','blob',file.blob])).toString();indexed++;bytes+=file.size;
  if(!/\.[cm]?[jt]sx?$/.test(file.path)){omissions.push({path:file.path,reason:'Structural grouping available; import extraction currently supports JS/TS syntax.'});continue;}
  const pattern=/(?:\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?|\b(?:import|require)\s*\(\s*)['"]([^'"]+)['"]/g;
  for(const match of source.matchAll(pattern)){
   const spec=match[1];if(!spec.startsWith('.'))continue;
   const stem=posix.normalize(posix.join(posix.dirname(file.path),spec));
   const variants=[stem,...['.js','.mjs','.cjs','.ts','.tsx','.jsx','/index.js','/index.ts','/index.tsx'].map(x=>stem+x),stem.replace(/\.js$/,'.ts'),stem.replace(/\.js$/,'.tsx')];
   const target=variants.find(p=>allPaths.has(p));if(target)fileRelationships.push({from:file.path,to:target,path:file.path,line:source.slice(0,match.index).split('\n').length,blob:file.blob});const from=owner.get(file.path),to=owner.get(target);if(!from||!to||from===to)continue;
   const key=from+'>'+to;if(!links.has(key))links.set(key,{from,to,kind:'imports',basis:'static-source',sources:[]});
   const link=links.get(key);if(link.sources.length<8)link.sources.push({side:'head',path:file.path,from:source.slice(0,match.index).split('\n').length,to:source.slice(0,match.index).split('\n').length,blob:file.blob,target});
  }
 }
 return {relationships:[...links.values()],fileRelationships,coverage:{indexed,sourceFiles:candidates.length,omissions}};
}
export async function captureComparison(repo,{baseRef,headRef='HEAD',mode='merge-base'}) {
 if(!['merge-base','direct'].includes(mode))throw new Error('Unknown comparison mode.');
 const requestedBase=await resolveCommit(repo,baseRef),head=await resolveCommit(repo,headRef);
 const base=mode==='merge-base'?(await git(repo.path,['merge-base',requestedBase,head])).trim():requestedBase;
 const files=parseChanges(await git(repo.path,['diff','--no-ext-diff','--no-textconv','--name-status','-z','--find-renames',base,head]));
 const [baseTree,headTree]=await Promise.all([treeAt(repo,base),treeAt(repo,head)]);
 const components=structuralComponents(headTree,files);
 const snapshot={id:digest({repository:repo.id,base,head,mode,baseRef,headRef,requestedBase}),repositoryId:repo.id,repositoryName:repo.name,capturedAt:new Date().toISOString(),mode,base:{ref:baseRef,requestedCommit:requestedBase,commit:base},head:{ref:headRef,commit:head},files,tree:{base:baseTree,head:headTree}};
 const index=await indexRelationships(repo,snapshot,components);
 return {...snapshot,components,...index};
}
export async function freshness(repo,snapshot) {
 try{const [base,head]=await Promise.all([resolveCommit(repo,snapshot.base.ref),resolveCommit(repo,snapshot.head.ref)]);return{status:base===snapshot.base.requestedCommit&&head===snapshot.head.commit?'current':'refs-moved',baseCommit:base,headCommit:head};}
 catch(error){return{status:'unavailable',reason:error.message};}
}
export async function checkoutFingerprint(repo) {
 if(repo.bare)return{bare:true,head:null,dirty:true,fingerprint:null,untracked:[]};
 const [head,status,diff]=await Promise.all([resolveCommit(repo,'HEAD'),git(repo.path,['status','--porcelain=v1','-z','--untracked-files=normal']),git(repo.path,['diff','--no-ext-diff','--no-textconv','--binary','HEAD','--'])]);
 const untracked=[];
 for(const entry of status.split('\0').filter(s=>s.startsWith('?? ')).slice(0,100)){const path=entry.slice(3);try{const absolute=resolve(repo.path,path),info=await lstat(absolute);untracked.push({path,size:info.size,mtime:info.mtimeMs,hash:info.isFile()&&info.size<100000?digest(await readFile(absolute)):null});}catch{untracked.push({path,unavailable:true});}}
 return {head,dirty:!!diff,bare:false,untracked,fingerprint:digest({head,status,diff,untracked})};
}
