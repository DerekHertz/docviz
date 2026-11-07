import { digest } from './git.mjs';
export const DECISIONS = new Set(['satisfied','follow-up','changes']);
const text=(v,label,max=20000)=>{if(typeof v!=='string'||v.length>max)throw new Error(`Invalid ${label}.`);return v.trim();};
const requiredText=(v,label,max)=>{const result=text(v,label,max);if(!result)throw new Error(`A ${label} is required.`);return result;};
const list=(v,label,max=150)=>{if(!Array.isArray(v)||v.length>max)throw new Error(`Invalid ${label}.`);return v;};
const identifier=(v,label)=>{if(typeof v!=='string'||!/^[a-zA-Z0-9_.:-]{1,120}$/.test(v))throw new Error(`Invalid ${label}.`);return v;};
export function blankReview() {return{reviewer:'Derek',scope:'source',rationale:'',acknowledgedGaps:false,componentDecisions:{},propertyDecisions:{},findingResolutions:{},status:'in-progress'};}
export function modelDigest(doc) {return digest({intent:doc.intent,components:doc.components,relationships:doc.relationships,properties:doc.properties,evidence:doc.evidence.map(x=>x.id),findings:doc.findings,contributions:doc.contributions.map(c=>({id:c.id,applied:c.applied,dismissed:c.dismissed||false})),review:doc.review});}
export function limitations(doc) {
 const gaps=[];
 if(!doc.properties.length)gaps.push('No behavioral properties have been specified; this review does not establish behavioral verification.');
 if(doc.components.some(c=>c.basis==='directory-derived'))gaps.push('Some component boundaries are derived from directories rather than confirmed domain responsibilities.');
 if(doc.snapshot.coverage.omissions.length)gaps.push(`${doc.snapshot.coverage.omissions.length} source paths have import-scan limitations; source files remain listed.`);
 const unconfirmed=doc.properties.filter(p=>p.authority!=='human-confirmed');if(unconfirmed.length)gaps.push(`${unconfirmed.length} properties are agent proposals, not human-confirmed governing requirements.`);
 const uncovered=doc.properties.filter(p=>!doc.evidence.some(e=>e.propertyIds?.includes(p.id)&&e.kind==='executed-command'&&!e.stale&&!e.outdatedPropertyIds?.includes(p.id)&&e.observations?.some(o=>o.propertyId===p.id&&o.result!=='unknown')));
 if(uncovered.length)gaps.push(`${uncovered.length} properties have no recorded executed property-specific assertion; source or agent judgments remain separate.`);
 if(!doc.evidence.some(e=>e.kind==='executed-command'))gaps.push('No verification command has been executed through this review.');
 if(doc.evidence.some(e=>e.stale))gaps.push('Some evidence was captured while the checkout changed; those observations are stale.');
 if(doc.evidence.some(e=>e.kind==='reported'))gaps.push('Imported or agent-reported evidence has not been independently reproduced by this application.');
 if(!doc.contributions.some(c=>c.actor.role==='reviewer'))gaps.push('No separate reviewer-agent contribution is recorded.');
 if(!doc.contributions.some(c=>c.actor.role==='verifier'))gaps.push('No verifier-agent contribution is recorded.');
 gaps.push('A local human review is not an authenticated signature or a guarantee of runtime correctness.');
 return gaps;
}
export function acceptance(doc,fresh) {
 const reasons=[];
 const decided=(field,id)=>Object.hasOwn(doc.review[field],id)&&DECISIONS.has(doc.review[field][id]);
 if(fresh.status!=='current')reasons.push('The selected refs moved or are unavailable. Open the current comparison before accepting it.');
 if(!doc.snapshot.files.length)reasons.push('This comparison has no changed files.');
 const changed=doc.components.filter(c=>c.changedFiles.length);
 if(changed.some(c=>!decided('componentDecisions',c.id)))reasons.push('Record a decision for every changed component.');
 if(doc.properties.some(p=>!decided('propertyDecisions',p.id)))reasons.push('Record a decision for every specified property.');
 if([...Object.values(doc.review.componentDecisions),...Object.values(doc.review.propertyDecisions)].includes('changes'))reasons.push('A component or property needs changes.');
 if(doc.findings.some(f=>!doc.review.findingResolutions[f.id]?.rationale))reasons.push('Give each agent finding a disposition and rationale.');
 if(doc.contributions.some(c=>!c.applied&&!c.dismissed))reasons.push('Apply or dismiss each pending agent contribution.');
 if(Object.values(doc.review.findingResolutions).some(r=>r.disposition==='changes'))reasons.push('An agent finding still requests changes.');
 if(doc.review.scope==='behavior'&&(!doc.properties.length||doc.properties.some(p=>p.authority!=='human-confirmed')))reasons.push('A behavioral review needs human-confirmed property definitions.');
 if(!doc.review.reviewer.trim())reasons.push('Add the reviewer’s name.');
 if(!doc.review.rationale.trim())reasons.push('Describe the review scope and remaining follow-ups.');
 if(!doc.review.acknowledgedGaps)reasons.push('Acknowledge the current evidence limitations.');
 return{ready:reasons.length===0,reasons,gaps:limitations(doc)};
}
export function receiptFor(doc,fresh) {
 const gate=acceptance(doc,fresh);if(!gate.ready)throw new Error(gate.reasons.join(' '));
 const receipt={schema:1,kind:'local-human-review',repository:doc.repository,snapshotId:doc.snapshot.id,base:doc.snapshot.base,head:doc.snapshot.head,comparisonMode:doc.snapshot.mode,reviewedAt:new Date().toISOString(),reviewer:doc.review.reviewer,scope:doc.review.scope,disposition:gate.gaps.length||Object.values(doc.review.propertyDecisions).includes('follow-up')?'accepted-with-follow-ups':'accepted',rationale:doc.review.rationale,componentDecisions:doc.review.componentDecisions,components:doc.components,relationships:doc.relationships,properties:doc.properties.map(p=>({...p,decision:doc.review.propertyDecisions[p.id]})),findingResolutions:doc.review.findingResolutions,evidence:doc.evidence,contributions:doc.contributions,limitations:gate.gaps,documentDigest:modelDigest(doc),publication:'No PR was created or merged. CI and integration checks remain separate.'};return{...receipt,id:digest(receipt)};
}
export function handoff(doc,receipt) {
 return `# ${doc.intent||'Review '+doc.repository.name}\n\nRepository: ${doc.repository.remote||doc.repository.path}\nBase: ${doc.snapshot.base.commit}\nCandidate: ${doc.snapshot.head.commit}\nReview: ${doc.id}\n\n## Local review\n\nReviewer: ${receipt.reviewer}\nScope: ${receipt.scope}\nDisposition: ${receipt.disposition}\n\n${receipt.rationale}\n\n## Changed components\n\n${doc.components.filter(c=>c.changedFiles.length).map(c=>`- ${c.title}: ${doc.review.componentDecisions[c.id]} (${c.changedFiles.length} changed files)`).join('\n')}\n\n## Properties\n\n${doc.properties.length?doc.properties.map(p=>`- ${p.title}: ${doc.review.propertyDecisions[p.id]} — ${p.expectation}`).join('\n'):'No behavioral properties specified; source review only.'}\n\n## Evidence limitations and follow-ups\n\n${receipt.limitations.map(g=>'- '+g).join('\n')}\n\n## Integration checkpoint\n\nThe submitted head must match ${receipt.head.commit}. Required CI and integration checks must be run against the current target branch. New commits or changes to the review model/evidence require a new review receipt.\n`;
}
export function applyReviewPatch(doc,patch) {
 if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('Invalid review update.');
 const next=structuredClone(doc.review);
 for(const key of Object.keys(patch))if(!['reviewer','scope','rationale','acknowledgedGaps','componentDecisions','propertyDecisions','findingResolutions'].includes(key))throw new Error(`Unsupported review field ${key}.`);
 for(const field of ['reviewer','rationale'])if(field in patch)next[field]=text(patch[field],field);
 if('scope'in patch){if(!['source','behavior'].includes(patch.scope))throw new Error('Choose source or behavioral review scope.');next.scope=patch.scope;}
 if('acknowledgedGaps'in patch){if(typeof patch.acknowledgedGaps!=='boolean')throw new Error('Invalid acknowledgment.');next.acknowledgedGaps=patch.acknowledgedGaps;}
 for(const [field,targets] of [['componentDecisions',doc.components],['propertyDecisions',doc.properties]])if(field in patch){for(const[id,decision]of Object.entries(patch[field])){if(!targets.some(x=>x.id===id)||(!DECISIONS.has(decision)&&decision!==''))throw new Error('Unknown review target or decision.');if(decision)next[field]={...next[field],[id]:decision};else delete next[field][id];}}
 if(patch.findingResolutions)for(const[id,value]of Object.entries(patch.findingResolutions)){if(!doc.findings.some(f=>f.id===id)||!['resolved','follow-up','dismissed','changes'].includes(value.disposition))throw new Error('Invalid finding resolution.');next.findingResolutions[id]={disposition:value.disposition,rationale:text(value.rationale,'finding rationale')};}
 next.status='in-progress';return next;
}
export function normalizeSources(refs,snapshot) {
 return list(refs||[],'source references',100).map(ref=>{
  if(!ref||!['base','head'].includes(ref.side||'head')||!Number.isInteger(ref.from)||!Number.isInteger(ref.to)||ref.from<1||ref.to<ref.from||ref.to-ref.from>500)throw new Error('Source references need a side, path and bounded 1-based line range.');
  const side=ref.side||'head',file=snapshot.tree[side].find(f=>f.path===ref.path&&/^100/.test(f.mode));if(!file)throw new Error(`Source not found at this snapshot: ${ref.path}`);
  return{side,path:file.path,from:ref.from,to:ref.to,blob:file.blob};
 });
}
export function normalizeContribution(raw,doc,actor) {
 if(!raw||raw.schema!==1||raw.head!==doc.snapshot.head.commit||raw.base!==doc.snapshot.base.commit)throw new Error('Agent package must name schema 1 and this exact comparison head/base.');
 const components=list(raw.components||[],'components',80).map(c=>{
  const files=list(c.files,'component files',500).map(p=>{if(typeof p!=='string'||!doc.snapshot.tree.head.some(f=>f.path===p)&&!doc.snapshot.files.some(f=>f.path===p))throw new Error('A component names a file outside this snapshot.');return p;});
  return{id:identifier(c.id,'component id'),title:requiredText(c.title,'component title',200),responsibility:text(c.responsibility||'','responsibility'),basis:'agent-proposed',files,changedFiles:doc.snapshot.files.filter(f=>files.includes(f.path)).map(f=>f.path),inputs:list(c.inputs||[],'inputs',30).map(x=>text(x,'input',500)),outputs:list(c.outputs||[],'outputs',30).map(x=>text(x,'output',500)),behavior:list(c.behavior||[],'behavior',30).map(s=>({label:text(s.label,'behavior label',1000),before:text(s.before||'','before behavior',2000),after:text(s.after||'','after behavior',2000),sources:normalizeSources(s.sources,doc.snapshot)}))};
 });
 const componentIds=new Set([...doc.components,...components].map(c=>c.id));
 const relationships=list(raw.relationships||[],'relationships',150).map(l=>{if(!componentIds.has(l.from)||!componentIds.has(l.to)||l.from===l.to)throw new Error('A relationship needs two known, distinct components.');return{from:l.from,to:l.to,kind:requiredText(l.kind,'relationship kind',100),reason:requiredText(l.reason,'relationship reason'),basis:'agent-source-interpretation',actor,sources:normalizeSources(l.sources,doc.snapshot)};});
 const properties=list(raw.properties||[],'properties',100).map(p=>{if(!componentIds.has(p.componentId))throw new Error('Property component is unknown.');return{id:identifier(p.id,'property id'),componentId:p.componentId,title:requiredText(p.title,'property title',250),condition:requiredText(p.condition,'condition'),expectation:requiredText(p.expectation,'expectation'),violation:requiredText(p.violation,'violation'),authority:actor.kind==='human'?'human-confirmed':'agent-proposed',sources:normalizeSources(p.sources,doc.snapshot)};});
 const propertyIds=new Set([...doc.properties,...properties].map(p=>p.id));
 const findings=list(raw.findings||[],'findings',100).map(f=>{if(f.propertyId&&!propertyIds.has(f.propertyId))throw new Error('Finding property is unknown.');if(f.componentId&&!componentIds.has(f.componentId))throw new Error('Finding component is unknown.');if(!['info','review','blocking'].includes(f.severity||'review'))throw new Error('Invalid finding severity.');return{id:identifier(f.id,'finding id'),componentId:f.componentId||null,propertyId:f.propertyId||null,severity:f.severity||'review',claim:requiredText(f.claim,'finding claim'),reasoning:text(f.reasoning||'','finding reasoning'),scope:text(f.scope||'Source interpretation','finding scope'),resolvingCheck:text(f.resolvingCheck||'','resolving check'),sources:normalizeSources(f.sources,doc.snapshot),actor};});
 const evidence=list(raw.evidence||[],'reported evidence',100).map(x=>{const ids=list(x.propertyIds||[],'evidence property IDs',100);if(ids.some(id=>!propertyIds.has(id)))throw new Error('Evidence property is unknown.');return{kind:'reported',propertyIds:ids,result:text(x.result||'unknown','reported result',200),scope:text(x.scope||'Agent/imported report; not independently reproduced','reported scope'),notes:text(x.notes||'','reported notes'),sources:normalizeSources(x.sources,doc.snapshot),actor};});
 for(const values of [components,properties,findings])if(new Set(values.map(x=>x.id)).size!==values.length)throw new Error('Duplicate IDs in agent package.');
 return{schema:1,head:raw.head,base:raw.base||doc.snapshot.base.commit,intent:text(raw.intent||'','intent'),components,relationships,properties,findings,evidence};
}
