import {createStackStore} from './stack.mjs';
import {parseGitHubContext} from './github-context.mjs';
import http from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWorkspace } from './workspace.mjs';
import { availableProviders, generateContribution, judgeClaims, contributionSchema } from './agents.mjs';
import { git, repositoryAt, digest } from './git.mjs';
const appRoot=dirname(fileURLToPath(import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
const response=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
async function parseBody(req){if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new Error('Expected JSON input.');let body='';for await(const c of req){body+=c;if(body.length>2500000)throw new Error('Input is larger than 2.5 MB.');}return body?JSON.parse(body):{};}
export async function startServer({dataRoot=resolve(process.env.DOCVIZ_REVIEW_DATA||resolve(appRoot,'data')),port=Number(process.env.DOCVIZ_REVIEW_PORT||47836),seed=true,openBrowser=false}={}){
 const identity=JSON.parse(await readFile(resolve(appRoot,'extension/identity.json'),'utf8'));const extensionOrigin='chrome-extension://'+identity.id;
 const stacks=createStackStore(dataRoot);
 const workspace=await createWorkspace(dataRoot),token=randomBytes(24).toString('hex'),jobs=new Map();
 await mkdir(resolve(dataRoot,'jobs'),{recursive:true});
 for(const file of await readdir(resolve(dataRoot,'jobs')))try{const j=JSON.parse(await readFile(resolve(dataRoot,'jobs',file),'utf8'));if(j.status==='running'){j.status='interrupted';j.error='The local server stopped before this job completed.';await writeFile(resolve(dataRoot,'jobs',file),JSON.stringify(j));}jobs.set(j.id,j);}catch{}
 if(seed)try{await workspace.register(resolve(appRoot,'.cache/repositories/docviz.git'));}catch{}
 async function launchJob(reviewId,label,run,context=null){
  if(!context&&reviewId){const doc=await workspace.raw(reviewId);if(doc.pr||doc.githubComparison)context={githubUrl:doc.pr?.url||doc.githubComparison.url};}
  const job={id:randomUUID(),reviewId,label,...(context?{context}:{}),status:'running',startedAt:new Date().toISOString()};jobs.set(job.id,job);
  const save=()=>writeFile(resolve(dataRoot,'jobs',job.id+'.json'),JSON.stringify(job,null,2));await save();
  Promise.resolve().then(run).then(value=>{job.status='completed';job.completedAt=new Date().toISOString();job.reviewId=value?.id||reviewId;}).catch(error=>{job.status='failed';job.error=error.message;job.completedAt=new Date().toISOString();}).finally(save);
  return job;
 }
 async function githubJson(path){const key=process.env.GH_TOKEN||process.env.GITHUB_TOKEN;const res=await fetch('https://api.github.com'+path,{headers:{accept:'application/vnd.github+json',...(key?{authorization:`Bearer ${key}`}:{})},signal:AbortSignal.timeout(30000)});if(!res.ok)throw new Error(`GitHub returned ${res.status}. Public PRs work without a key; for private projects use a local checkout, or configure a valid GH_TOKEN in the server environment.`);return res.json();}
 async function cachedRepository(owner,name){
  const remote=`https://github.com/${owner}/${name}.git`,repos=await workspace.repositories();let repo=repos.find(r=>r.remote.replace(/\.git$/,'')===remote.replace(/\.git$/,''));
  if(!repo||!repo.bare){const root=resolve(appRoot,'.cache/repositories',digest(remote).slice(0,20)+'.git');await mkdir(resolve(root,'..'),{recursive:true});try{repo=await repositoryAt(root);}catch{await new Promise((resolveClone,reject)=>{const child=spawn('git',['clone','--mirror',remote,root],{env:{...process.env,GIT_TERMINAL_PROMPT:'0'},stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',x=>error+=x);child.on('error',reject);child.on('close',code=>code?reject(new Error(error.slice(-1400))):resolveClone());});repo=await repositoryAt(root);}await workspace.register(root);}
  return repo;
 }
 async function openPR(input){
  const context=parseGitHubContext(input);if(context?.kind!=='pull-request')throw new Error('Use a github.com/owner/repository/pull/number URL.');
  const {owner,repo:name,number}=context,pr=await githubJson(`/repos/${owner}/${name}/pulls/${number}`);
  const repo=await cachedRepository(owner,name);
  const baseRef=`refs/docviz/pr-${number}/base`,headRef=`refs/docviz/pr-${number}/head`;
  await git(repo.path,['fetch','--no-tags','origin',`+refs/heads/${pr.base.ref}:${baseRef}`,`+refs/pull/${number}/head:${headRef}`]);
  return workspace.open({repositoryId:repo.id,baseRef,headRef,mode:'merge-base',intent:pr.title,pr:{url:pr.html_url,number:Number(number),description:pr.body||'',owner,name,baseBranch:pr.base.ref,headBranch:pr.head.ref}});
 }
 async function openComparison(input){
  const context=parseGitHubContext(input);if(context?.kind!=='comparison')throw new Error('Use a GitHub comparison URL with explicit base...candidate branches from one repository.');
  const [base,head]=await Promise.all([githubJson(`/repos/${context.owner}/${context.repo}/commits/${encodeURIComponent(context.base)}`),githubJson(`/repos/${context.owner}/${context.repo}/commits/${encodeURIComponent(context.head)}`)]);
  const repo=await cachedRepository(context.owner,context.repo),prefix='refs/docviz/compare-'+digest(context.url).slice(0,16),baseRef=prefix+'/base',headRef=prefix+'/head';
  await git(repo.path,['fetch','--no-tags','origin',`+${base.sha}:${baseRef}`,`+${head.sha}:${headRef}`]);
  return workspace.open({repositoryId:repo.id,baseRef,headRef,mode:'merge-base',intent:`${context.head} → ${context.base}`,comparison:context});
 }
 let server;
 server=http.createServer(async(req,res)=>{
  try{
   const host=`127.0.0.1:${server.address().port}`;
   if(req.headers.host!==host){response(res,403,{error:'Use this application’s loopback address.'});return;}
   const url=new URL(req.url,`http://${host}`),path=url.pathname;
   const origin=req.headers.origin,trustedOrigin=origin===`http://${host}`||origin===extensionOrigin;
   if(origin===extensionOrigin){res.setHeader('access-control-allow-origin',extensionOrigin);res.setHeader('vary','Origin');}
   if(path.startsWith('/api/')&&req.method==='OPTIONS'){if(!trustedOrigin){response(res,403,{error:'Unknown application origin.'});return;}res.writeHead(204,{'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'content-type, x-docviz-token','access-control-max-age':'600'});res.end();return;}
   if(path.startsWith('/api/')&&origin&&!trustedOrigin){response(res,403,{error:'Unknown application origin.'});return;}
   if(path.startsWith('/api/')){
    if(req.method==='POST'){
     if(req.headers['x-docviz-token']!==token||req.headers.origin&&!trustedOrigin){response(res,403,{error:'Reload the local application before making changes.'});return;}
    }
    const storedMap=path.match(/^\/api\/system-maps\/([a-f0-9]{64})$/);
    if(req.method==='GET'&&storedMap){response(res,200,await stacks.map(storedMap[1]));return;}
    if(req.method==='GET'&&path==='/api/stacks'){response(res,200,await stacks.list());return;}
    const stackRoute=path.match(/^\/api\/stacks\/([a-z0-9-]+)(?:\/(source|evidence)(?:\/([a-f0-9]+))?)?$/);
    if(req.method==='GET'&&stackRoute){const[,id,part,artifactId]=stackRoute;const result=part==='source'?await stacks.source(id,url.searchParams.get('commit'),url.searchParams.get('path')):part==='evidence'?await stacks.evidence(id,artifactId):await stacks.read(id);response(res,200,result);return;}
    if(req.method==='GET'&&path==='/api/bootstrap'){response(res,200,{app:'docviz-review',version:'0.2.0',token,repositories:await workspace.repositories(),reviews:await workspace.list(),providers:availableProviders(),jev:!!process.env.TYPESAFE_API_KEY,jobs:[...jobs.values()]});return;}
    if(req.method==='POST'&&path==='/api/repositories'){const body=await parseBody(req);response(res,200,await workspace.register(body.path));return;}
    const refs=path.match(/^\/api\/repositories\/([a-f0-9]+)\/refs$/);if(req.method==='GET'&&refs){response(res,200,await workspace.refs(refs[1]));return;}
    if(req.method==='POST'&&path==='/api/open'){const body=await parseBody(req);response(res,200,await workspace.open(body));return;}
    if(req.method==='POST'&&path==='/api/open-github-comparison'){const body=await parseBody(req);response(res,202,await launchJob(null,'Open GitHub branch comparison',()=>openComparison(body.url),{githubUrl:body.url}));return;}
    if(req.method==='POST'&&path==='/api/open-pr'){const body=await parseBody(req);response(res,202,await launchJob(null,'Open GitHub PR',()=>openPR(body.url),{prUrl:body.url}));return;}
    const jobRoute=path.match(/^\/api\/jobs\/([\w-]+)$/);if(req.method==='GET'&&jobRoute){const job=jobs.get(jobRoute[1]);if(!job)throw new Error('Unknown job.');response(res,200,job);return;}
    const route=path.match(/^\/api\/reviews\/([a-f0-9]+)(?:\/(source|diff|context|export|actions))?$/);
    if(route){const [,id,part]=route;
     if(req.method==='GET'){
      const value=part==='source'?await workspace.source(id,url.searchParams.get('path'),url.searchParams.get('side')||'head'):part==='diff'?await workspace.diff(id,url.searchParams.get('path')):part==='context'?{context:await workspace.context(id),schema:contributionSchema}:part==='export'?await workspace.export(id):await workspace.read(id);response(res,200,value);return;
     }
     if(req.method==='POST'&&part==='actions'){
      const body=await parseBody(req);let value;
      if(body.action==='review')value=await workspace.saveReview(id,body.expectedVersion,body.patch);
      else if(body.action==='property')value=await workspace.changeProperty(id,body.expectedVersion,body.property,body.propertyId);
      else if(body.action==='confirm-property')value=await workspace.confirmProperty(id,body.expectedVersion,body.propertyId);
      else if(body.action==='component')value=await workspace.updateComponent(id,body.expectedVersion,body.componentId,body.component);
      else if(body.action==='import'){const role=body.role||'reviewer';if(!['author','reviewer','verifier'].includes(role))throw new Error('Choose an agent role.');value=await workspace.contribute(id,body.package,{kind:'imported',name:String(body.name||'Imported agent').slice(0,200),role});}
      else if(body.action==='apply-contribution')value=await workspace.applyContribution(id,body.contributionId,body.expectedVersion);
      else if(body.action==='dismiss-contribution')value=await workspace.dismissContribution(id,body.expectedVersion,body.contributionId,body.rationale);
      else if(body.action==='refresh'){const doc=await workspace.raw(id);value=doc.pr?await openPR(doc.pr.url):doc.githubComparison?await openComparison(doc.githubComparison.url):await workspace.refresh(id);}
      else if(body.action==='finish'){const doc=await workspace.raw(id);if(doc.pr||doc.githubComparison){const updated=doc.pr?await openPR(doc.pr.url):await openComparison(doc.githubComparison.url);if(updated.id!==id)throw Object.assign(new Error('The PR changed. Refresh and review the current comparison.'),{status:409});}value=await workspace.finish(id,body.expectedVersion);}
      else if(body.action==='generate'){
       if(!['author','reviewer','verifier'].includes(body.role)||!['auto','claude','codex'].includes(body.provider||'auto'))throw new Error('Choose an available provider and role.');
       value=await launchJob(id,body.role==='author'?'Draft component model':`${body.role} agent`,async()=>{const context=await workspace.context(id);const result=await generateContribution({context,role:body.role,provider:body.provider||'auto',workRoot:resolve(dataRoot,'agent-work')});return workspace.contribute(id,result.output,result.actor,result.usage);});
      }else if(body.action==='check')value=await launchJob(id,'Run verification command',()=>workspace.runCheck(id,{argv:body.argv,propertyIds:body.propertyIds||[],execution:body.execution||'snapshot'}));
      else if(body.action==='jev')value=await launchJob(id,'Jev source judgments',async()=>{const doc=await workspace.raw(id);return judgeClaims(doc,(path,side)=>workspace.source(id,path,side),evidence=>workspace.recordEvidence(id,evidence));});
      else throw new Error('Unknown review action.');
      response(res,['generate','check','jev'].includes(body.action)?202:200,value);return;
     }
    }
    response(res,404,{error:'Unknown local action.'});return;
   }
   if(req.method!=='GET'){response(res,405,{error:'Unsupported method.'});return;}
   const root=resolve(appRoot,'ui'),file=resolve(root,'.'+decodeURIComponent(path==='/'?'/index.html':path));
   if(!file.startsWith(root+sep)){response(res,403,{error:'Outside the application.'});return;}
   const info=await stat(file);if(!info.isFile())throw new Error('Unknown file.');
   res.writeHead(200,{'content-type':mime[extname(file)]||'text/plain; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"});res.end(await readFile(file));
  }catch(error){response(res,error.status||400,{error:error.message});}
 });
 await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolveListen);});
 const url=`http://127.0.0.1:${server.address().port}/`;console.log(`Docviz Review ${url}`);
 if(openBrowser)spawn(process.platform==='darwin'?'open':process.platform==='win32'?'explorer':'xdg-open',[url],{stdio:'ignore'}).on('error',()=>{});
 return{server,url,workspace,token,jobs};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))startServer({openBrowser:process.argv.includes('--open')}).catch(error=>{console.error(error.code==='EADDRINUSE'?'Docviz may already be running at http://127.0.0.1:47836/':error.message);process.exitCode=1;});
