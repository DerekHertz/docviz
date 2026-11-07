export function scopeFor(stack,layerId=null){
 const layer=layerId?stack.layers.find(l=>l.id===layerId):null;
 if(layerId&&!layer)throw new Error('Unknown stack layer.');
 const layers=layer?[layer]:stack.layers;
 return{id:layer?.id||'whole',label:layer?`PR #${layer.number} · local change`:'Whole stack · cumulative change',base:layer?.parent||stack.target,head:layer?.head||stack.tip,layers,claims:stack.claims.filter(c=>!layer||c.layerId===layer.id),evidence:stack.evidence.filter(e=>!layer||e.layerId===layer.id),changedNodes:[...new Set(layers.flatMap(l=>l.changedNodes))],summary:layer?.summary||stack.summary,before:layer?.before||stack.before||(stack.layers.length===1?stack.layers[0].before:null)||'PR diagrams and module movement exist, without this versioned behavior-review pipeline.',after:layer?.after||stack.after||(stack.layers.length===1?stack.layers[0].after:null)||'Repository models feed behavior findings and explicit attention with inspectable reasons.'};
}
export function capturePair(stack,scope,scenarioId){
 const get=commit=>stack.captures.find(c=>c.commit===commit&&c.scenarioId===scenarioId)||null;
 const base=get(scope.base),head=get(scope.head);
 if(!base||!head)return{base,head,status:'missing'};
 return{base,head,status:base.harnessDigest===head.harnessDigest&&base.frames.length===head.frames.length&&base.frames.every((f,i)=>f.id===head.frames[i].id)?'paired':'incompatible'};
}
