export function sourceJudgmentPresentation(evidence){
 if(evidence.kind!=='source-judgment')return{label:evidence.result,tone:evidence.result==='fail'?'bad':'neutral',detail:''};
 if(evidence.result==='uncertain')return{
  label:evidence.uncertaintyReason==='insufficient-source-context'?'Source context uncertain':'Source judgment uncertain',tone:'pending',
  detail:evidence.uncertaintyReason==='insufficient-source-context'?'The supplied source context is insufficient to establish or refute this claim. Add the relevant code and reassess.':'The supplied source did not yield a conclusive support or contradiction judgment. Inspect the claim and recorded scores.'
 };
 if(evidence.result==='unknown'&&evidence.requestSent===false)return{label:'Source unavailable',tone:'pending',detail:'No Jev request was made because the source packet could not be read. Inspect the missing source and recorded limits.'};
 if(evidence.result==='unknown')return{label:'Source check incomplete',tone:'pending',detail:'The model response did not contain valid scores for every required question. No support or contradiction is established.'};
 if(evidence.result==='contradicts')return{label:'Source contradiction',tone:'bad',detail:'The recorded model judgment flags a conflict with the supplied source. Inspect its scope and evidence before treating it as a code finding.'};
 if(evidence.result==='supports')return{label:'Source support',tone:'neutral',detail:'The model supports this source-linked claim. Runtime behavior remains a separate question.'};
 return{label:'Source judgment needs review',tone:'pending',detail:'Inspect this recorded source judgment and its criteria.'};
}
export function verificationFor(doc,componentId,propertyId){
 const component=doc.components.find(c=>c.id===componentId);if(!component)throw new Error('Unknown component.');
 const properties=doc.properties.filter(p=>p.componentId===componentId),selected=properties.find(p=>p.id===propertyId)||properties[0]||null;
 const current=e=>!e.stale&&!e.outdatedPropertyIds?.includes(selected?.id);
 const evidence=selected?doc.evidence.filter(e=>e.propertyIds?.includes(selected.id)).map(e=>({...e,applicable:current(e),observations:(e.observations||[]).filter(o=>o.propertyId===selected.id)})):[];
 const observations=evidence.filter(e=>e.applicable&&e.kind==='executed-command').flatMap(e=>e.observations);
 const failed=observations.some(o=>o.result==='fails'),holds=observations.some(o=>o.result==='holds'),unknown=observations.some(o=>o.result==='unknown');
 const propertyFindings=selected?doc.findings.filter(f=>f.propertyId===selected.id):[];
 const contextFindings=doc.findings.filter(f=>f.componentId===componentId&&(!selected||f.propertyId!==selected.id));
 const openFindings=propertyFindings.filter(f=>!doc.review.findingResolutions[f.id]?.rationale);
 let observation={kind:'missing',title:'No mapped runtime observation',detail:'A related command can pass without establishing this whole property. Inspect the source assertions and recorded output.'};
 if(failed)observation={kind:'failed',title:'An executed observation reports a failure',detail:'Inspect the recorded assertion, its input scope, and the raw command output.'};
 else if(holds)observation={kind:unknown?'partial':'observed',title:unknown?'Mixed scoped observations':'Scoped runtime observations recorded',detail:'These assertions cover their recorded cases. Remaining agent challenges and broader conditions need separate review.'};
 return{component,properties,selected,evidence,observations,observation,propertyFindings,contextFindings,openFindings,decision:selected?doc.review.propertyDecisions[selected.id]||null:null};
}
export function verificationSummary(doc){
 const covered=doc.properties.filter(p=>doc.evidence.some(e=>e.kind==='executed-command'&&!e.stale&&!e.outdatedPropertyIds?.includes(p.id)&&e.observations?.some(o=>o.propertyId===p.id&&o.result!=='unknown'))).length;
 return{changedComponents:doc.components.filter(c=>c.changedFiles.length).length,properties:doc.properties.length,mappedObservations:covered,unconfirmed:doc.properties.filter(p=>p.authority!=='human-confirmed').length,openFindings:doc.findings.filter(f=>!doc.review.findingResolutions[f.id]?.rationale).length};
}
