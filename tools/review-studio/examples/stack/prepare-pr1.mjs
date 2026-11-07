import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {git,repositoryAt,digest} from '../../git.mjs';
import {createSystemMapCache} from '../../system-maps.mjs';

// Builds the PR1 review stack around a `docviz pr --coverage-out` result. It runs no code itself:
// verdicts and recorded states come only from the attached, fingerprinted coverage result.
const here=dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),coverageAt=args.indexOf('--coverage'),coverageFile=coverageAt>=0?args.splice(coverageAt,2)[1]:null;
const [repoPath,dataPath]=args;
if(!dataPath)throw new Error('Usage: node tools/review-studio/examples/stack/prepare-pr1.mjs REPO DATA_ROOT [--coverage CONTRACT_COVERAGE.json]');
const base='595f590ba2b69e90f73e14c0591be0ca3d8f97d7',head='8967e5d3e193b84d62ae359f59ae37a0312014b3',stepsSha='385578d34246f7f753bbd6ca691dbf0a22e3fac0d8aa6618c24021d83affbc4a';
const repository=await repositoryAt(repoPath),dataRoot=resolve(dataPath),id='docviz-pr1-coverage',folder=resolve(dataRoot,'stacks',id);
for(const commit of[base,head])try{await git(repository.path,['cat-file','-e',commit+'^{commit}']);}catch{throw new Error(`PR1 commit ${commit} is missing from ${repository.path}. Fetch PR #1 first: git fetch origin pull/1/head:refs/docviz/pr1/head`);}
await mkdir(resolve(folder,'artifacts'),{recursive:true});

const stepsBytes=await readFile(resolve(here,'pr1-steps.json'));
assert.equal(createHash('sha256').update(stepsBytes).digest('hex'),stepsSha,'pr1-steps.json must be the unchanged historical five-step summary.');
const steps=JSON.parse(stepsBytes);

const sourceCache=new Map();
const lines=async path=>{if(!sourceCache.has(path))sourceCache.set(path,(await git(repository.path,['show',head+':'+path])).split('\n'));return sourceCache.get(path);};
const lineOf=async(path,marker)=>{const index=(await lines(path)).findIndex(line=>line.includes(marker));if(index<0)throw new Error(`Missing source marker ${head.slice(0,7)}:${path}: ${marker}`);return index+1;};
const block=async(path,from,to)=>({commit:head,path,from:await lineOf(path,from),to:to?await lineOf(path,to)-1:await lineOf(path,from)});

const summarySteps=[];
for(const s of steps.steps)summarySteps.push({id:s.id,label:s.label,changed:s.changed,sources:await Promise.all(s.sources.map(x=>block(x.path,x.from,x.to)))});
const summaryEdges=[...steps.card.mermaid.matchAll(/^\s*(\w+) -->(?:\|([^|]+)\|)? (\w+)\s*$/gm)].map(([,from,label,to])=>({from,to,...(label?{label}:{})}));

const bg='extension/background.js';
const anchors={
 visualize:await block(bg,'export async function visualizeSelection(','// ---------- per-card actions'),
 generate:await block(bg,'async function generate(','async function learn('),
 callHelper:await block(bg,'async function callHelper(','// Every call is charged to the ledger'),
 ledger:await block(bg,'const ledger = createLedger(','// Charge a card for a call'),
 retry:await block(bg,"'card:retry':"),
 dismissMessage:await block(bg,"'card:dismiss':"),
 dismiss:await block(bg,'async function dismiss(','// ---------- optional highlight chip'),
 page:await block('extension/sidepanel.js','const page = '),
 ledgerModule:await block('extension/ledger.js','export function createLedger(')
};
// `frame` names the per-action state id the core card-spend harness records (helper/contracts/card-spend.mjs).
const lifecycle={id:'card-spend',title:'One card from draw to a late helper return',contractId:'card-spend-accounting',outcome:'late',basis:'source-interpretation',
 states:[{id:'none',label:'not drawn'},{id:'drawing',label:'drawing'},{id:'failed',label:'failed'},{id:'retrying',label:'retry · call out'},{id:'dismissed',label:'dismissed · call out'},{id:'late',label:'late return'}],
 events:[
  {id:'draw',frame:'before-first-reply',from:'none',to:'drawing',label:'visualizeSelection',boundary:'chrome',sources:[anchors.visualize,anchors.generate]},
  {id:'fail',frame:'after-failed-draw',from:'drawing',to:'failed',label:'helper error + usage',boundary:'helper',sources:[anchors.callHelper,anchors.generate]},
  {id:'retry',frame:'after-retry-request',from:'failed',to:'retrying',label:'card:retry',boundary:'chrome',sources:[anchors.retry,anchors.generate]},
  {id:'dismiss',frame:'after-dismiss',from:'retrying',to:'dismissed',label:'card:dismiss',boundary:'chrome',sources:[anchors.dismissMessage,anchors.dismiss]},
  {id:'late',frame:'after-late-return',from:'dismissed',to:'late',label:'helper returns usage',boundary:'helper',sources:[anchors.callHelper,anchors.generate]}
 ],
 rail:[{id:'ledger',label:'Ledger total · chrome.storage.local',field:'ledgerPaid'},{id:'card',label:'Card record · chrome.storage.session',field:'card'},{id:'page',label:'Page total · side panel expression',field:'pageTotal',from:'card'}],
 limits:['States and events are a source interpretation of the pinned handlers, not an instrumented call graph.','Recorded states come from one docviz execution of one scenario. They support this path only and prove nothing about other inputs.','chrome.storage, chrome.tabs, chrome.runtime and the helper are controlled fixtures. No browser, extension host or provider ran.','The page total is the pinned side-panel expression evaluated over the recorded card records, without DOM rendering.','The coverage result lists the operator\'s registered contracts only, not every possible behavior of the repository.']};

let coverage=[];
if(coverageFile){
 const {validateCoverage}=await import('../../coverage.mjs').catch(()=>{throw new Error('tools/review-studio/coverage.mjs (issue 19 core) is required to attach a coverage result.');});
 const record=validateCoverage(JSON.parse(await readFile(resolve(coverageFile),'utf8')));
 assert.equal(record.head,head,'The coverage result must be for the PR1 head.');assert.equal(record.base,base,'The coverage result must be for the PR1 base.');
 await writeFile(resolve(folder,'artifacts',record.id+'.json'),JSON.stringify(record,null,2));coverage=[{id:record.id}];
}

const nodes=[
 {id:'background',title:'Card actions',purpose:'Draw, retry and dismiss cards; charge each card for its calls.',inputs:['selection','Retry / Dismiss messages'],outputs:['card records','helper requests'],introducedBy:'pr1',sources:[anchors.visualize,anchors.generate,anchors.retry,anchors.dismissMessage,anchors.dismiss],steps:[],pseudocode:[]},
 {id:'helper',title:'Helper call',purpose:'POST to the local helper and record reported usage in the ledger.',inputs:['card request'],outputs:['result or error + usage'],sources:[anchors.callHelper],steps:[],pseudocode:[]},
 {id:'ledger',title:'Spend ledger',purpose:'Accumulate every reported charge in chrome.storage.local.',inputs:['reported usage'],outputs:['today / total spend'],introducedBy:'pr1',sources:[anchors.ledger,anchors.ledgerModule],steps:[],pseudocode:[]},
 {id:'sidepanel',title:'Side panel',purpose:'Show the page total from card costs, and the ledger totals separately.',inputs:['card records','spend totals'],outputs:['page total'],sources:[anchors.page],steps:[],pseudocode:[]}
];
const edges=[['background','helper','card request'],['helper','ledger','reported usage'],['background','sidepanel','card records → page total'],['ledger','sidepanel','spend totals (shown separately)']].map(([from,to,label],index)=>({id:'flow-'+index,from,to,label,basis:'source-interpretation'}));
const rows=(await git(repository.path,['diff','--numstat',base,head])).trim().split('\n').filter(Boolean).map(line=>line.split('\t'));
const stats={files:rows.length,added:rows.reduce((n,r)=>n+(Number(r[0])||0),0),removed:rows.reduce((n,r)=>n+(Number(r[1])||0),0)};
await createSystemMapCache(dataRoot).ensure(repository,head,nodes,edges);
const world={schema:1,id,title:'PR #1 · contract coverage beside the author summary',displayTitle:'Card spend after Retry and Dismiss',kind:'pr-checkpoints',label:'PR #1 · historical head, unchanged',
 summary:'PR #1\'s code is unchanged. The original review checked the author\'s five steps only; this stack adds the independent contract check of the same head.',repository,target:base,tip:head,
 layers:[{id:'pr1',number:1,title:'PR #1 · ELI5 depth, per-card costs, daily budget',parent:base,head,changedNodes:nodes.map(n=>n.id),claimIds:[],evidenceIds:[],stats}],
 nodes,edges,claims:[],scenarios:[],captures:[],evidence:[],coverage,
 authorSummary:{kind:'author-summary',stepsSha256:stepsSha,steps:summarySteps,edges:summaryEdges},lifecycles:[lifecycle],stats,limitations:lifecycle.limits};
await writeFile(resolve(folder,'stack.json'),JSON.stringify(world,null,2));
console.log(JSON.stringify({id,folder,base,head,coverage:coverage.map(c=>c.id),summary:summarySteps.map(s=>({id:s.id,lines:s.sources.map(x=>x.from+'-'+x.to)})),events:lifecycle.events.map(e=>({id:e.id,frame:e.frame,lines:e.sources.map(x=>x.from+'-'+x.to)}))},null,2));
