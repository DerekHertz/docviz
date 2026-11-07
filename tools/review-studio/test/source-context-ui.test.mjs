import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceContextDetails} from '../ui/source-context.mjs';
import {sourceJudgmentPresentation} from '../ui/verification.mjs';
test('the source inspector distinguishes submitted context, omissions and older unrecorded packets',()=>{
 const html=sourceContextDetails({kind:'source-judgment',requestSent:true,sourceContext:{version:'test',bytes:90,digest:'abc',code:'<script>bad()</script>',files:[{path:'<source>.js',side:'head',commit:'a'.repeat(40),blob:'b'.repeat(40),from:1,to:8,includedBecause:['anchor module']}],omissions:[{path:'missing.js',reason:'file limit'}]}});
 assert.match(html,/1 files · 1 omissions/);assert.match(html,/head aaaaaaa/);assert.match(html,/lines 1–8/);assert.match(html,/file limit/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/not a complete dependency/);
 assert.match(sourceContextDetails({kind:'source-judgment'}),/exact submitted source packet is unavailable/);
 assert.equal(sourceContextDetails({kind:'executed-command'}),'');
});
test('unreadable source does not pretend that Jev returned an invalid answer',()=>{
 assert.equal(sourceJudgmentPresentation({kind:'source-judgment',result:'unknown',requestSent:false}).label,'Source unavailable');
 assert.match(sourceContextDetails({kind:'source-judgment',requestSent:false,sourceContext:{files:[],omissions:[],code:''}}),/no Jev request/);
});
