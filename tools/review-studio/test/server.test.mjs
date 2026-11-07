import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {startServer} from '../server.mjs';
test('loopback service exposes app, persists registry, and rejects unauthenticated/cross-origin writes',async t=>{
 const root=await mkdtemp(resolve(tmpdir(),'docviz-http-test-')),s=await startServer({dataRoot:root,port:0,seed:false});t.after(async()=>{await new Promise(r=>s.server.close(r));await rm(root,{recursive:true,force:true});});
 const get=await fetch(s.url+'api/bootstrap'),boot=await get.json();assert.equal(boot.app,'docviz-review');assert.equal(boot.token,s.token);assert.deepEqual(boot.repositories,[]);
 const html=await fetch(s.url);assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(await html.text(),/Docviz/);
 const write=(headers={})=>fetch(s.url+'api/repositories',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({path:root})});assert.equal((await write()).status,403);assert.equal((await write({'x-docviz-token':s.token,origin:'https://untrusted.example'})).status,403);assert.equal((await write({'x-docviz-token':s.token})).status,400);
 const identity=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../extension/identity.json',import.meta.url)));const approved='chrome-extension://'+identity.id;const allowed=await fetch(s.url+'api/bootstrap',{headers:{origin:approved}});assert.equal(allowed.status,200);assert.equal(allowed.headers.get('access-control-allow-origin'),approved);assert.equal((await fetch(s.url+'api/bootstrap',{headers:{origin:'chrome-extension://other'}})).status,403);
 const traversal=await fetch(s.url+'data/repositories.json');assert.equal(traversal.ok,false);const wrongHost=await new Promise((resolveStatus,reject)=>{http.get(s.url+'api/bootstrap',{headers:{host:'untrusted.example'}},res=>{res.resume();resolveStatus(res.statusCode);}).on('error',reject);});assert.equal(wrongHost,403);
});
