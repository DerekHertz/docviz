import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {coverageView,validateCoverage} from '../coverage.mjs';
import {createStackStore} from '../stack.mjs';
import {digest,repositoryAt} from '../git.mjs';
const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');

// A real `docviz pr --coverage-out` result: a throwaway repo carrying docviz's extension code.
function realCoverage(t,{trust=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'docviz-studio-coverage-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const g=(...a)=>execFileSync('git',a,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 g('init','-q');g('config','user.email','t@example.test');g('config','user.name','t');g('remote','add','origin','https://example.test/a/b.git');
 writeFileSync(join(dir,'package.json'),'{ "type": "module" }\n');g('add','-A');g('commit','-qm','base');const base=g('rev-parse','HEAD');
 mkdirSync(join(dir,'extension'));for(const f of readdirSync(join(repoRoot,'extension')).filter(f=>f.endsWith('.js')))writeFileSync(join(dir,'extension',f),readFileSync(join(repoRoot,'extension',f)));
 g('add','-A');g('commit','-qm','cards');const head=g('rev-parse','HEAD');
 const steps=join(dir,'..',`${dir.split('/').at(-1)}-steps.json`),out=join(dir,'..',`${dir.split('/').at(-1)}-coverage.json`);t.after(()=>{rmSync(steps,{force:true});rmSync(out,{force:true});});
 writeFileSync(steps,JSON.stringify({steps:[{id:'draw',label:'A selection becomes a card',changed:true,sources:[{path:'extension/background.js',from:'export async function visualizeSelection(',to:'// ---------- per-card actions'}]}],card:{caption:'Draw.',mermaid:'flowchart TD\n  draw["A selection becomes a card"]:::changed\n  classDef changed stroke:#d29922,stroke-width:3px'}}));
 const res=spawnSync(process.execPath,[join(repoRoot,'helper/cli.js'),'pr',steps,'--pr','https://example.test/pull/2','--no-check','--base',base,'--contracts',join(repoRoot,'test/fixtures/contracts/card-spend.json'),'--coverage-out',out,...(trust?['--trust-head',head]:[])],{cwd:dir,encoding:'utf8'});
 assert.equal(res.status,0,res.stderr);return Object.defineProperty(JSON.parse(readFileSync(out,'utf8')),'checkout',{value:dir});
}

test('the studio view keeps status, authority, omission and execution apart for a real CLI result',t=>{
 const view=coverageView(realCoverage(t)),[row]=view.rows;
 assert.equal(view.needsReview,true);assert.equal(view.counts.violated,1);
 assert.deepEqual([row.status,row.tone,row.reason],['violated','bad','executed-fails']);
 assert.equal(row.authority,'Operator-selected (not a signature)');
 assert.ok(row.omittedBySummary&&row.omitted.includes('dismiss'));
 assert.deepEqual([row.evidence.provenance,row.evidence.outcome,row.evidence.harness,row.evidence.observed.unattributed],['executed-by-docviz','fails','card-spend',1]);
});

test('without trust the studio sees pending uncertainty, not a violation',t=>{
 const [row]=coverageView(realCoverage(t,{trust:false})).rows;
 assert.deepEqual([row.status,row.tone,row.evidence],['unverified','pending',null]);
});

test('an edited stored result is rejected: by fingerprint, or as a claim with no matching execution',t=>{
 const real=realCoverage(t,{trust:false});
 const edited=structuredClone(real);edited.obligations[0].status='supported-in-scope';
 assert.throws(()=>validateCoverage(edited),/fingerprint/);
 const {id,...payload}=edited;assert.throws(()=>validateCoverage({...payload,id:digest(payload)}),/without a matching docviz execution/);
 const authority=structuredClone(real);authority.obligations[0].authority.kind='human-confirmed';const {id:_,...p2}=authority;
 assert.throws(()=>validateCoverage({...p2,id:digest(p2)}),/operator-selected/);
});

test('the view carries only the frames the harness captured, and says so when there are none',t=>{
 const real=realCoverage(t),[row]=coverageView(real).rows,recorded=real.obligations[0].evidence.observed.frames;
 assert.ok(Array.isArray(recorded)&&recorded.length>=5,'the CLI result records frames');
 assert.deepEqual(row.evidence.frames,recorded);
 const reseal=edit=>{const copy=structuredClone(real);edit(copy);const {id,...payload}=copy;return{...payload,id:digest(payload)};};
 assert.equal(coverageView(reseal(c=>{delete c.obligations[0].evidence.observed.frames;})).rows[0].evidence.frames,null);
 assert.throws(()=>validateCoverage(reseal(c=>{c.obligations[0].evidence.observed.frames=[{action:'made up'}];})),/frames/);
 assert.throws(()=>validateCoverage(reseal(c=>{c.obligations[0].evidence.observed.frames='after-late-return';})),/frames/);
});

test('a stack serves declared coverage through the same fingerprinted artifacts as evidence',async t=>{
 const real=realCoverage(t),root=mkdtempSync(join(tmpdir(),'docviz-stack-coverage-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const dir=join(root,'stacks','example');mkdirSync(join(dir,'artifacts'),{recursive:true});
 writeFileSync(join(dir,'stack.json'),JSON.stringify({id:'example',repository:await repositoryAt(real.checkout),target:real.base,tip:real.head,layers:[],nodes:[],edges:[],claims:[],evidence:[],captures:[],coverage:[{id:real.id}]}));
 writeFileSync(join(dir,'artifacts',real.id+'.json'),JSON.stringify(real));
 const store=createStackStore(root);
 const stack=await store.read('example');
 assert.equal(stack.coverage[0].rows[0].status,'violated');
 assert.equal((await store.evidence('example',real.id)).kind,'contract-coverage');
 writeFileSync(join(dir,'artifacts',real.id+'.json'),JSON.stringify({...real,base:null}));
 await assert.rejects(()=>store.read('example'),/fingerprint/);
});
