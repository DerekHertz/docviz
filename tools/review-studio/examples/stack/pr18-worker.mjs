import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const [root,scenarioId,scratch,targetRoot,stepsFile,profileFile]=process.argv.slice(2);
if(!root||!scratch||!['malformed-cache','missing-context','source-context','canonical-evidence','contract-review'].includes(scenarioId))throw new Error('Usage: pr18-worker.mjs CHECKOUT SCENARIO SCRATCH [TARGET_CHECKOUT STEPS PROFILE]');
await mkdir(scratch,{recursive:true});
const load=path=>import(pathToFileURL(resolve(root,'tools/review-studio',path)).href);
const commit=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim();
if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('The capture checkout has no readable HEAD.');
// The PR base has the CLI but no studio, so studio modules load only for the studio scenarios.
const {repositoryAt,digest}=scenarioId==='contract-review'?{}:await load('git.mjs');
const repository=scenarioId==='contract-review'?null:await repositoryAt(root);
const frames=[];
const frame=(id,title,nodeId,input,output,observed)=>frames.push({id,title,nodeId,input:structuredClone(input),output:structuredClone(output),observed});
let output;
if(scenarioId==='malformed-cache'){
 const {createSystemMapCache}=await load('system-maps.mjs');
 const input={nodes:[{id:'cache',title:'Cache description',purpose:{claims:['leak']},inputs:[],outputs:[],sources:[]}],edges:[]};
 frame('input','Supply an object where prose is expected','cache',input,input,false);
 const maps=createSystemMapCache(resolve(scratch,'cache'));
 try{const result=await maps.ensure(repository,commit,input.nodes,input.edges);output={status:'stored',purpose:result.map.nodes[0].purpose,mapId:result.map.id};}
 catch(error){output={status:'rejected',error:error.message};}
 let artifacts=[];try{artifacts=await readdir(resolve(scratch,'cache/system-maps/snapshots'));}catch(error){if(error.code!=='ENOENT')throw error;}
 output.artifactCount=artifacts.length;
 frame('transform','Run the real cache persistence boundary','cache',input,output,true);
 frame('output','Inspect persisted map artifacts','cache',{artifactDirectory:'system-maps/snapshots'},output,true);
}else if(scenarioId==='missing-context'){
 const {judgeClaims}=await load('agents.mjs');
 const answers={supported:{noul:.2},contradicted:{noul:.9},contextSufficient:{noul:.1}};
 const property={id:'partial-source',componentId:'cache',title:'Exact base correspondence',condition:'a repository map is explicitly selected',expectation:'the cache checks repository identity and exact revision',violation:'a map from another repository or revision is accepted',sources:[{side:'head',path:'tools/review-studio/system-maps.mjs',from:1,to:4}]};
 const sourceText=await readFile(resolve(root,property.sources[0].path),'utf8');
 const input={claim:`When ${property.condition}, ${property.expectation}`,source:{...property.sources[0],text:sourceText.split('\n').slice(0,4).join('\n')},controlledScores:answers};
 frame('input','Supply a partial excerpt and controlled provider scores','judgment',input,input,false);
 // The fake key never leaves this isolated worker. Every network attempt is intercepted below.
 process.env.TYPESAFE_API_KEY='docviz-capture-fixture-not-a-real-key';
 let requests=0,request;
 globalThis.fetch=async(url,options)=>{if(url!=='https://api.typesafe.ai/v1/systemone')throw new Error('Unexpected fixture request.');requests++;request=JSON.parse(options.body);return{ok:true,json:async()=>({model:'controlled-provider-response',answers})};};
 let evidence;
 await judgeClaims({properties:[property]},async()=>({text:sourceText}),async value=>{evidence=value;return value;});
 if(requests!==1||!evidence)throw new Error('Expected one intercepted provider request and a recorded judgment.');
 output={status:evidence.result,supported:evidence.supported,contradicted:evidence.contradicted,contextSufficient:evidence.contextSufficient??null,uncertaintyReason:evidence.uncertaintyReason??null,criteriaVersion:evidence.criteriaVersion??'original-two-question',thresholds:evidence.thresholds??null};
 frame('transform','Run judgeClaims with the intercepted response','judgment',{scores:answers,requestedQuestions:Object.keys(request.questions)},output,true);
 frame('output','Read the actual recorded source judgment','judgment',{recordKind:evidence.kind},output,true);
}else if(scenarioId==='source-context'){
 const {judgeClaims}=await load('agents.mjs');
 const sourceText="const THRESHOLD = 0.6;\nfunction allowed(score) { return score >= THRESHOLD; }\nexport function decide(score) {\n return allowed(score) ? 'accept' : 'review';\n}\n";
 const property={id:'complete-source',condition:'decide is checked',expectation:'decide accepts at its declared threshold',sources:[{side:'head',path:'controlled-source.js',from:3,to:5}]};
 const input={claim:property.expectation,anchor:property.sources[0],controlledSource:sourceText};
 frame('input','The anchor omits the threshold and helper','judgment',input,{anchorOnly:sourceText.split('\n').slice(2,5).join('\n')},false);
 process.env.TYPESAFE_API_KEY='docviz-capture-fixture-not-a-real-key';
 let request,record,requests=0;
 globalThis.fetch=async(url,options)=>{if(url!=='https://api.typesafe.ai/v1/systemone')throw Error('Unexpected fixture request');request=JSON.parse(options.body);requests++;return{ok:true,json:async()=>({model:'controlled-response',answers:{contextSufficient:{noul:1},supported:{noul:1},contradicted:{noul:0}}})};};
 await judgeClaims({properties:[property]},async()=>({text:sourceText}),async e=>{record=e;return e;});
 if(requests!==1)throw Error('Expected one intercepted request');
 const includesThreshold=request.state.code.includes('const THRESHOLD'),includesHelper=request.state.code.includes('function allowed');
 output={status:includesThreshold&&includesHelper?'expanded':'clipped',includesThreshold,includesHelper,files:record.sourceContext?.files.map(f=>({path:f.path,from:f.from,to:f.to}))||[],packetBytes:Buffer.byteLength(request.state.code),packetDigest:record.sourceContext?.digest??null};
 frame('transform','Inspect the actual outgoing source packet','judgment',input,output,true);
 frame('output','Definitions supplied, not runtime certified','judgment',{requestIntercepted:true},output,true);
}else if(scenarioId==='contract-review'){
 // This revision's own `docviz pr`, run as a process on the frozen PR1 target. The verdict and any
 // coverage come only from what that process printed and wrote; nothing is read from the candidate.
 if(!targetRoot||!stepsFile||!profileFile)throw new Error('contract-review needs TARGET_CHECKOUT STEPS PROFILE.');
 const target={repository:'docviz',pr:1,base:'595f590ba2b69e90f73e14c0591be0ca3d8f97d7',head:'8967e5d3e193b84d62ae359f59ae37a0312014b3'};
 const sha=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
 const input={tool:{commit},target,stepsSha256:await sha(stepsFile),profileSha256:await sha(profileFile)};
 frame('input','The same frozen PR1 target, author steps and contract profile','cli',input,input,false);
 const coverageOut=resolve(scratch,'coverage.json');
 const argv=[process.execPath,resolve(root,'helper/cli.js'),'pr',stepsFile,'--pr','https://github.com/DerekHertz/docviz/pull/1','--no-check','--base',target.base,'--contracts',profileFile,'--coverage-out',coverageOut,'--trust-head',target.head];
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key!=='TYPESAFE_API_KEY'));
 const started=Date.now(),run=spawnSync(argv[0],argv.slice(1),{cwd:targetRoot,encoding:'utf8',env,timeout:120000});
 await writeFile(resolve(scratch,'stdout.md'),run.stdout??'');await writeFile(resolve(scratch,'stderr.txt'),run.stderr??'');
 const headline=run.stdout?.match(/^\*\*(Needs you|Look when you can|Nothing for you)\*\*$/m)?.[1]??null;
 const status={'Needs you':'needs','Look when you can':'look','Nothing for you':'nothing'}[headline]??'unknown';
 let coverage=null;try{coverage=JSON.parse(await readFile(coverageOut,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const obligation=coverage?.obligations?.find(o=>o.contractId==='card-spend-accounting')??null;
 const process_={argv:argv.map(a=>a===process.execPath?'node':a),cwd:targetRoot,exitCode:run.status,signal:run.signal,durationMs:Date.now()-started,stdoutSha256:createHash('sha256').update(run.stdout??'').digest('hex'),stderr:run.stderr,rawFiles:{stdout:resolve(scratch,'stdout.md'),stderr:resolve(scratch,'stderr.txt'),coverage:coverage?coverageOut:null}};
 frame('transform','Run this revision\'s docviz pr as a process','cli',{argv:process_.argv,cwd:'PR1 target checkout at '+target.head.slice(0,7)},{exitCode:run.status,stderrVerdict:run.stderr?.match(/^verdict: (\w+)$/m)?.[1]??null,cost:run.stderr?.match(/^cost: (.+)$/m)?.[1]??null,coverageWritten:!!coverage},true);
 output={status,headline,exitCode:run.status,stderrVerdict:run.stderr?.match(/^verdict: (\w+)$/m)?.[1]??null,cost:run.stderr?.match(/^cost: (.+)$/m)?.[1]??null,
  contract:obligation?{contractId:obligation.contractId,status:obligation.status,reason:obligation.reason,provenance:obligation.evidence?.provenance??null,outcome:obligation.evidence?.outcome??null,evidenceBase:obligation.evidence?.base??null,evidenceHead:obligation.evidence?.head??null}:null,
  contractResult:obligation?'present':'absent: this revision wrote no contract coverage and printed no contract row',
  targetCoverage:coverage?{id:coverage.id,base:coverage.base,head:coverage.head,role:'Regression evidence for the PR1 target. It is not coverage of this PR.'}:null};
 frame('output','Read the review this revision printed','cli',{headline},output,true);
 process.stdout.write(JSON.stringify({scenarioId,frames,output,process:process_,stdout:run.stdout})+'\n');process.exit(0);
}else{
 const {createStackStore}=await load('stack.mjs');
 const folder=resolve(scratch,'data/stacks/capture-fixture');await mkdir(resolve(folder,'artifacts'),{recursive:true});
 const canonical={kind:'executed-command',commit,title:'Controlled failing command',scope:'Fixture with canonical failure and altered inline success. The command record is supplied, not executed by this scenario.',exitCode:1,result:'fail',summary:'Canonical fixture reports failure',output:'not ok 1 - controlled failure\n# pass 0\n# fail 1\n'};
 const id=digest(canonical),declared={id,kind:'executed-command',commit,title:'Altered inline success',scope:'Inline presentation metadata',exitCode:0,result:'pass',summary:'Everything passed'};
 const fixture={schema:1,id:'capture-fixture',repository,target:commit,tip:commit,layers:[],nodes:[],edges:[],claims:[],captures:[],evidence:[declared]};
 await writeFile(resolve(folder,'artifacts',id+'.json'),JSON.stringify({...canonical,id}));await writeFile(resolve(folder,'stack.json'),JSON.stringify(fixture));
 const input={inline:{result:declared.result,exitCode:declared.exitCode},artifact:{result:canonical.result,exitCode:canonical.exitCode},artifactId:id};
 frame('input','Provide conflicting inline and canonical evidence facts','checks',input,input,false);
 const store=createStackStore(resolve(scratch,'data')),loaded=await store.read('capture-fixture'),card=loaded.evidence[0],raw=await store.evidence('capture-fixture',id);
 output={status:card.result,displayedExitCode:card.exitCode,canonicalResult:raw.result,canonicalExitCode:raw.exitCode,title:card.title,artifactId:id};
 frame('transform','Run the real stack read and artifact lookup','checks',input,output,true);
 frame('output','Compare the displayed card with its immutable artifact','checks',{canonicalResult:raw.result},output,true);
}
process.stdout.write(JSON.stringify({scenarioId,frames,output})+'\n');
