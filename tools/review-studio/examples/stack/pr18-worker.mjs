import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const [root,scenarioId,scratch]=process.argv.slice(2);
if(!root||!scratch||!['malformed-cache','missing-context','canonical-evidence'].includes(scenarioId))throw new Error('Usage: pr18-worker.mjs CHECKOUT SCENARIO SCRATCH');
await mkdir(scratch,{recursive:true});
const load=path=>import(pathToFileURL(resolve(root,'tools/review-studio',path)).href);
const {repositoryAt,digest,git}=await load('git.mjs');
const repository=await repositoryAt(root),commit=(await git(root,['rev-parse','HEAD'])).trim();
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
