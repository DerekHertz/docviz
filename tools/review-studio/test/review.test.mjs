import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptance,blankReview,applyReviewPatch} from '../review.mjs';

for(const id of ['ordinary','constructor','toString','__proto__'])test(`review decisions for ${id} must be explicit own entries`,()=>{
 const doc={snapshot:{files:[{path:'answer.js'}],coverage:{omissions:[]}},components:[{id,changedFiles:['answer.js'],basis:'human-defined'}],properties:[{id,authority:'human-confirmed'}],findings:[],contributions:[],evidence:[],review:{...blankReview(),reviewer:'Fixture reviewer',rationale:'Source inspected; runtime gaps retained.',scope:'source',acknowledgedGaps:true}};
 const before=acceptance(doc,{status:'current'});
 assert.equal(before.ready,false);
 assert(before.reasons.includes('Record a decision for every changed component.'));
 assert(before.reasons.includes('Record a decision for every specified property.'));
 doc.review=applyReviewPatch(doc,{componentDecisions:{[id]:'satisfied'},propertyDecisions:{[id]:'follow-up'}});
 assert(Object.hasOwn(doc.review.componentDecisions,id));assert(Object.hasOwn(doc.review.propertyDecisions,id));
 assert.equal(doc.review.componentDecisions[id],'satisfied');assert.equal(doc.review.propertyDecisions[id],'follow-up');
 assert.equal(Object.getPrototypeOf(doc.review.componentDecisions),Object.prototype);
 assert.equal(acceptance(doc,{status:'current'}).ready,true);
 doc.review=applyReviewPatch(doc,{propertyDecisions:{[id]:''}});
 assert.equal(Object.hasOwn(doc.review.propertyDecisions,id),false);
 assert.equal(acceptance(doc,{status:'current'}).ready,false);
});
