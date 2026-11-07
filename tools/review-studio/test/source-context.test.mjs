import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {digest} from '../git.mjs';
import {buildSourceBundle} from '../source-context.mjs';
const property=(sources=[{side:'head',path:'cache.mjs',from:4,to:4}])=>({id:'p',componentId:'cache',condition:'a map is stored',expectation:'malformed descriptions are rejected',sources});
const reader=files=>async(path,side)=>{const text=files[side+':'+path]??files[path];if(text===undefined)throw Error('missing');return{path,side,text,commit:side==='base'?'a'.repeat(40):'b'.repeat(40),blob:digest(text)};};
const cache="import { persist } from './storage.mjs';\nfunction validate(value) { if (typeof value !== 'string') throw Error('bad'); }\nconst threshold = 0.6;\nexport function store(value) { validate(value); return persist(value); }\n";

test('a small seed anchor sends its whole module and relative helper definitions, with auditable identities',async()=>{
 const p=property(),b=await buildSourceBundle(p,reader({'cache.mjs':cache,'storage.mjs':'export function persist(value) { return value; }'}));
 assert.match(b.code,/function validate/);assert.match(b.code,/const threshold/);assert.match(b.code,/function persist/);
 assert.deepEqual(b.files.map(f=>f.path),['cache.mjs','storage.mjs']);assert.equal(b.files[0].from,1);assert.equal(b.files[0].to,5);
 assert.equal(b.files[0].commit,'b'.repeat(40));assert.equal(b.files[0].blob,digest(cache));assert.equal(b.definitionDigest,digest(p));assert.equal(b.digest,digest(b.code));assert.equal(b.bytes,Buffer.byteLength(b.code));assert.deepEqual(JSON.parse(b.code).files,b.files);
});

test('actual contract invocation and threshold definitions are not cut off by their display anchors',async()=>{
 const c=await readFile('helper/contracts.js','utf8'),a=await readFile('tools/review-studio/agents.mjs','utf8');
 const b=await buildSourceBundle(property([{side:'head',path:'helper/contracts.js',from:197,to:226},{side:'head',path:'tools/review-studio/agents.mjs',from:60,to:71}]),reader({'helper/contracts.js':c,'tools/review-studio/agents.mjs':a}),{maxDepth:0});
 assert.match(b.code,/facts\.evidence = runHarness/);assert.match(b.code,/sourceThresholds/);assert.match(b.code,/contextSufficient:\.6/);
});

test('declared component support includes non-import relationships such as controller and device',async()=>{
 const b=await buildSourceBundle(property(),reader({'cache.mjs':cache,'storage.mjs':'export const saved = true;','device.mjs':'export const pendingTimers = new Set();'}),{supportSources:[{path:'device.mjs',side:'head',includedBecause:'component:cache'}]});
 assert(b.files.some(f=>f.path==='device.mjs'&&f.includedBecause.includes('component:cache')));assert.match(b.code,/pendingTimers/);
});

test('every seed remains represented, duplicate paths merge and import cycles terminate',async()=>{
 const refs=Array.from({length:6},(_,i)=>({side:'head',path:'cache.mjs',from:i+1,to:i+1}));const src=cache+'export const sixth = true;\n';
 const b=await buildSourceBundle(property(refs),reader({'cache.mjs':src,'storage.mjs':"export {store} from './cache.mjs';"}));
 assert.equal(b.seeds.length,6);assert.equal(b.files.filter(f=>f.path==='cache.mjs').length,1);assert.equal(b.files.length,2);
});

test('base and head source stay separate, including imports',async()=>{
 const b=await buildSourceBundle(property([{side:'base',path:'a.mjs',from:1,to:1},{side:'head',path:'a.mjs',from:1,to:1}]),reader({'base:a.mjs':"import './b.mjs'; export const value = 1;",'head:a.mjs':"import './b.mjs'; export const value = 2;",'base:b.mjs':'export const base = true;','head:b.mjs':'export const head = true;'}));
 assert.equal(b.files.length,4);assert.match(b.code,/value = 1/);assert.match(b.code,/value = 2/);assert.equal(new Set(b.files.map(f=>f.side+':'+f.path)).size,4);
});

test('byte budget keeps seed lines and discloses omitted full modules and files',async()=>{
 const src='// '+ 'padding'.repeat(700)+'\nexport const answer = 2;\n';
 const b=await buildSourceBundle(property([{side:'head',path:'a.mjs',from:2,to:2}]),reader({'a.mjs':src,'extra.mjs':'// '+'extra'.repeat(1000)}),{maxBytes:1800,supportSources:[{side:'head',path:'extra.mjs'}]});
 assert(b.bytes<=1800);assert.match(b.code,/answer = 2/);assert(b.files.some(f=>f.path==='a.mjs'&&f.from===2&&f.to===2));assert(b.omissions.some(o=>o.reason==='byte-limit'));assert(b.omissions.some(o=>o.path==='extra.mjs'));
});

test('file and depth limits are visible, and seed files have priority over neighbors',async()=>{
 const b=await buildSourceBundle(property([{side:'head',path:'a.mjs',from:1,to:1},{side:'head',path:'b.mjs',from:1,to:1}]),reader({'a.mjs':"import './c.mjs';",'b.mjs':'export const b = 1;','c.mjs':"import './d.mjs';",'d.mjs':'export const d = 1;'}),{maxFiles:2,maxDepth:1});
 assert.deepEqual(b.files.map(f=>f.path),['a.mjs','b.mjs']);assert(b.omissions.some(o=>o.path==='c.mjs'&&o.reason==='file-limit'));
 const depth=await buildSourceBundle(property([{side:'head',path:'a.mjs',from:1,to:1}]),reader({'a.mjs':"import './c.mjs';",'c.mjs':"import './d.mjs';",'d.mjs':'export const d = 1;'}),{maxDepth:1});assert(depth.omissions.some(o=>o.path==='d.mjs'&&o.reason==='depth-limit'));
});

test('comments and strings do not discover dependencies; external and computed imports are disclosed',async()=>{
 const src="// import './comment.mjs'\nconst text = \"import './string.mjs'\";\nimport x from 'node:fs';\nconst y = import(name);\nexport {answer} from './real.mjs';";
 const b=await buildSourceBundle(property([{side:'head',path:'a.mjs',from:1,to:1}]),reader({'a.mjs':src,'real.mjs':'export const answer = 42;'}));
 assert.deepEqual(b.files.map(f=>f.path),['a.mjs','real.mjs']);assert(b.omissions.some(o=>o.reason==='external-import'));assert(b.omissions.some(o=>o.reason==='computed-import'));
});

test('missing seeds, invalid ranges, unexpected blobs, binary data and escaping paths do not become readable source',async()=>{
 for(const [ref,files]of[
  [{side:'head',path:'missing.mjs',from:1,to:1},{}],
  [{side:'head',path:'a.mjs',from:9,to:9},{'a.mjs':'export const a = 1;'}],
  [{side:'head',path:'a.mjs',from:1,to:1,blob:'wrong'},{'a.mjs':'export const a = 1;'}],
  [{side:'head',path:'a.mjs',from:1,to:1},{'a.mjs':'\0binary'}],
  [{side:'head',path:'../outside.mjs',from:1,to:1},{'../outside.mjs':'sensitive'}],
  [{side:'head',path:'/outside.mjs',from:1,to:1},{'/outside.mjs':'sensitive'}]
 ]){let reads=0;const read=reader(files),b=await buildSourceBundle(property([ref]),(...args)=>{reads++;return read(...args);});assert.equal(b.readableSeeds,0,JSON.stringify(ref));assert.equal(b.files.length,0);assert(b.omissions.length);if(ref.path.includes('outside'))assert.equal(reads,0);}
});

test('implicit imports and support paths do not retrieve configuration, vendor or escaping files',async()=>{
 const paths=[];const read=reader({'a.mjs':"import '../outside.mjs'; import './.env'; import './vendor/large.js'; import './good.js';",'good.js':'export const yes = true;'});
 const b=await buildSourceBundle(property([{side:'head',path:'a.mjs',from:1,to:1}]),async(...args)=>{paths.push(args[0]);return read(...args);},{supportSources:[{path:'.env',side:'head'},{path:'node_modules/x.js',side:'head'}]});
 assert.deepEqual(b.files.map(f=>f.path),['a.mjs','good.js']);assert(!paths.some(p=>p.includes('.env')||p.includes('vendor')||p.includes('node_modules')||p.startsWith('..')));assert(b.omissions.some(o=>o.reason==='unsupported-path'));
});


test('a reader returning a refreshed revision cannot mix that source into a pinned packet',async()=>{
 const b=await buildSourceBundle(property([{side:'head',path:'a.mjs',from:1,to:1}]),reader({'a.mjs':'export const a = 1;'}),{snapshotId:'pinned-snapshot',repositoryId:'repo',expectedCommits:{head:'c'.repeat(40)}});
 assert.equal(b.snapshotId,'pinned-snapshot');assert.equal(b.repositoryId,'repo');assert.equal(b.files.length,0);assert.equal(b.readableSeeds,0);assert(b.omissions.some(o=>o.reason==='source-identity-mismatch'));
});


test('an oversized manifest stays within the packet budget and returns exactly the manifest sent',async()=>{
 const refs=Array.from({length:40},(_,i)=>({side:'head',path:'long-name-'+i+'-'.repeat(100)+'.mjs',from:1,to:1}));
 const b=await buildSourceBundle(property(refs),reader({}),{maxBytes:1024});
 assert(b.bytes<=1024);assert.deepEqual(b.files,JSON.parse(b.code).files);assert.deepEqual(b.seeds,JSON.parse(b.code).seeds);assert.deepEqual(b.omissions,JSON.parse(b.code).omissions);assert.equal(b.readableSeeds,0);assert(b.omissions.some(o=>o.reason==='manifest-byte-limit'&&o.requestedSeeds===40));
});

test('a pinned tree resolves extensionless local imports without reading nonexistent candidates',async()=>{
 const paths=[],read=reader({'main.mjs':"import { answer } from './answer';",'answer.ts':'export const answer = 42;'});
 const b=await buildSourceBundle(property([{side:'head',path:'main.mjs',from:1,to:1}]),async(...args)=>{paths.push(args[0]);return read(...args);},{availablePaths:{head:new Set(['main.mjs','answer.ts'])}});
 assert.deepEqual(paths,['main.mjs','answer.ts']);assert.equal(b.files.length,2);
});
