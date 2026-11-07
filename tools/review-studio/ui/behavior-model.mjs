import {capturePair} from './stack-model.mjs';

export function behaviorScope(stack,id='whole'){
 if(id==='whole')return{id,kind:'whole-pr',label:'Whole PR',base:stack.target,head:stack.tip,changed:new Set(stack.layers.flatMap(l=>l.changedNodes||[]))};
 const layer=stack.layers.find(l=>l.id===id);if(!layer)throw new Error('Unknown behavior comparison.');
 return{id,kind:stack.kind==='pr-checkpoints'?'within-pr':'layer',label:layer.title,base:layer.parent,head:layer.head,changed:new Set(layer.changedNodes||[])};
}
export function observedOutcome(capture){
 if(!capture)return null;
 const frame=[...capture.frames].reverse().find(f=>f.observed);
 return frame?{frame,value:frame.output,status:typeof frame.output?.status==='string'?frame.output.status:null}:null;
}
export function behaviorStory(stack,{comparison='whole',scenarioId,nodeId,step=0}={}){
 const scope=behaviorScope(stack,comparison),scenarios=stack.scenarios||[];
 const scenario=scenarios.find(s=>s.id===scenarioId&&(!nodeId||s.nodeId===nodeId))||(nodeId?scenarios.find(s=>s.nodeId===nodeId):scenarios[0])||null;
 const pair=scenario?capturePair(stack,scope,scenario.id):{base:null,head:null,status:'missing'};
 const frames=pair.status==='paired'?pair.head.frames:[];
 const index=Math.max(0,Math.min(Number.isInteger(step)?step:0,Math.max(0,frames.length-1)));
 const before=observedOutcome(pair.base),after=observedOutcome(pair.head);
 const expected=scenario?.expectedStatus;
 return{scope,scenario,pair,frames,index,lastIndex:frames.length-1,atOutcome:frames.length>0&&index===frames.length-1,phase:frames.length&&index===frames.length-1?2:index===0?0:1,before,after,assertion:pair.status==='paired'&&after?.status&&typeof expected==='string'?{expected,actual:after.status,holds:after.status===expected}:null};
}

// Rank by data dependencies; only the interpreted graph is laid out here, not private runtime calls.
export function flowLayout(nodes,edges,widthHint){
 const rank=new Map(nodes.map(n=>[n.id,0])),pending=new Set(nodes.map(n=>n.id)),ordered=[];
 while(pending.size){const ready=[...pending].filter(id=>edges.filter(e=>e.to===id).every(e=>!pending.has(e.from)));if(!ready.length){ordered.push(...pending);break;}for(const id of ready){pending.delete(id);ordered.push(id);for(const e of edges.filter(e=>e.from===id))rank.set(e.to,Math.max(rank.get(e.to)||0,(rank.get(id)||0)+1));}}
 const groups=new Map();for(const id of ordered){const r=rank.get(id);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(id);}
 const columns=Math.max(1,...rank.values())+1,width=Math.max(980,widthHint||columns*205),height=Math.max(250,...[...groups.values()].map(g=>g.length*88+36));
 const positions=new Map();for(const[r,ids]of groups)ids.forEach((id,i)=>positions.set(id,{x:82+r*(width-164)/Math.max(1,columns-1),y:height/(ids.length+1)*(i+1)}));
 return{width,height,positions};
}

export function sourceAssessments(review,propertyIds){
 return review.evidence.filter(e=>e.kind==='source-judgment'&&e.propertyIds.some(id=>propertyIds.includes(id))).map(evidence=>({evidence,historical:!!evidence.stale||evidence.outdatedPropertyIds?.some(id=>propertyIds.includes(id))||false,reason:evidence.stale?'Recorded for an earlier revision':evidence.outdatedPropertyIds?.some(id=>propertyIds.includes(id))?'Recorded for a previous property definition':null}));
}
