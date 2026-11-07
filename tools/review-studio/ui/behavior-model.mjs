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

// One row per canonical coverage status (core-interface.json). A renamed status changes only this table.
export const coverageMarks={
 violated:{kind:'violation',glyph:'!',tone:'alert',label:'Executed counterexample'},
 unverified:{kind:'missing',glyph:'○',tone:'pending',label:'Missing coverage'},
 stale:{kind:'stale',glyph:'?',tone:'uncertain',label:'Evidence bound to another revision or definition'},
 'supported-in-scope':{kind:'scoped',glyph:'◇',tone:'neutral',label:'Held on the recorded scenario only'},
 'not-applicable':{kind:'not-applicable',glyph:'–',tone:'muted',label:'Not applicable'},
 unknown:{kind:'unknown',glyph:'?',tone:'uncertain',label:'Applicability unknown'},
 'no-result':{kind:'no-result',glyph:'?',tone:'uncertain',label:'No coverage result for this contract'}
};
// A result or execution counts only for the exact comparison on screen: same base and same head.
// Core's binding (CoverageView.binding) also covers repository identity, so a false `current` always wins.
export const coverageBoundTo=(result,scope)=>!!result&&result.binding?.current!==false&&result.base===scope.base&&result.head===scope.head;
const executedStatus=new Set(['violated','supported-in-scope']);
const executedAt=(evidence,scope)=>evidence?.provenance==='executed-by-docviz'&&evidence.head===scope.head&&(evidence.base==null||evidence.base===scope.base);
const executedHere=(evidence,scope,outcome)=>executedAt(evidence,scope)&&evidence.outcome===outcome;
function coverageMark(row,scope){
 if(!row)return coverageMarks['no-result'];
 if(row.applies===null)return coverageMarks.unknown;
 if(row.status==='violated')return executedHere(row.evidence,scope,'fails')?coverageMarks.violated:{...coverageMarks.unverified,note:'The violation is not backed by a docviz execution at this head.'};
 if(row.status==='supported-in-scope')return executedHere(row.evidence,scope,'holds')?coverageMarks['supported-in-scope']:{...coverageMarks.unverified,note:'The support is not backed by a docviz execution at this head.'};
 return coverageMarks[row.status]||coverageMarks.unknown;
}
export function coverageResultMark(result,row,scope){return result&&!coverageBoundTo(result,scope)?{...coverageMarks.unknown,label:'Coverage recorded for another comparison'}:coverageMark(row,scope);}
const overlaps=(a,b)=>a.path===b.path&&a.commit===b.commit&&a.from<=b.to&&b.from<=a.to;

export function coverageLifecycle(stack,{lifecycleId,step,comparison='whole'}={}){
 const lifecycle=(stack.lifecycles||[]).find(l=>!lifecycleId||l.id===lifecycleId);if(!lifecycle)return null;
 const scope=behaviorScope(stack,comparison),short=v=>String(v).slice(0,7);
 const steps=stack.authorSummary?.steps||[];
 const events=lifecycle.events.map(e=>{const citedBy=steps.filter(s=>s.sources.some(a=>e.sources.some(b=>overlaps(a,b)))).map(s=>s.id);return{...e,citedBy,omitted:!citedBy.length};});
 const summary={steps:steps.map(s=>({...s,events:events.filter(e=>e.citedBy.includes(s.id)).map(e=>e.id)})),edges:stack.authorSummary?.edges||[],gutter:steps.filter(s=>!events.some(e=>e.citedBy.includes(s.id))).map(s=>s.id)};
 const result=(stack.coverage||[]).find(v=>v.rows?.some(r=>r.contractId===lifecycle.contractId))||null,row=result?.rows.find(r=>r.contractId===lifecycle.contractId)||null;
 const stale=!!result&&!coverageBoundTo(result,scope);
 const mark=coverageResultMark(result,row,scope);
 // Playback uses only per-action states a docviz execution recorded for this comparison. Nothing is inferred from the final result.
 const execution=!stale&&executedStatus.has(row?.status)&&executedAt(row?.evidence,scope)?row.evidence:null;
 const frames=Array.isArray(execution?.observed?.frames)?execution.observed.frames.filter(f=>f&&typeof f.id==='string'):[];
 const index=Math.max(0,Math.min(Number.isInteger(step)?step:frames.length-1,frames.length-1)),frame=frames[index];
 const eventOf=f=>events.find(e=>(e.frame??e.id)===f.id)||null;
 return{lifecycle,events,summary,scope,result,row,mark,stale,banner:stale?`${result.binding?.current===false&&result.binding.detail?result.binding.detail+'. ':''}Coverage recorded for ${short(result.base)} → ${short(result.head)}; this comparison is ${short(scope.base)} → ${short(scope.head)}. Every mark is shown as unknown.`:null,
  execution,frames,index,canPlay:frames.length>1,atOutcome:frames.length>0&&index===frames.length-1,state:frame?eventOf(frame)?.to??null:null,
  reached:new Set(frames.slice(0,index+1).map(eventOf).filter(Boolean).map(e=>e.id)),
  rail:lifecycle.rail.map(r=>({...r,value:frame?frame[r.field]:undefined,history:frames.slice(0,index+1).map(f=>f[r.field])})),
  railEdges:lifecycle.rail.filter(r=>r.from).map(r=>({from:r.from,to:r.id}))};
}

// Linear left-to-right lifecycle. Forward event labels sit above their arrow on two alternating rows,
// so neighbours never collide and gaps stay short; widths assume 7.4px per 12px monospace character.
export function lifecycleLayout(lc,{stateWidth=108,stateHeight=48,gap=76,labelHeight=22}={}){
 const order=lc.lifecycle.states.map(s=>s.id),states=new Map(),labels=new Map();
 const labelWidth=e=>Math.ceil(e.label.length*7.4+(e.omitted?40:24));
 const rowY=24+2*(labelHeight+6)+10+stateHeight/2,top=rowY-stateHeight/2;
 order.forEach((id,i)=>states.set(id,{x:24+i*(stateWidth+gap),y:top,w:stateWidth,h:stateHeight}));
 let forward=0,below=0;
 for(const e of lc.events){const a=states.get(e.from),b=states.get(e.to);if(!a||!b)continue;const w=labelWidth(e);
  if(order.indexOf(e.to)===order.indexOf(e.from)+1){const row=forward++%2;labels.set(e.id,{x:Math.round((a.x+a.w+b.x)/2-w/2),y:top-10-labelHeight-row*(labelHeight+6),w,h:labelHeight});}
  else labels.set(e.id,{x:Math.round((a.x+b.x+b.w)/2-w/2),y:top+stateHeight+30+below++*(labelHeight+6),w,h:labelHeight});}
 const xs=[...states.values(),...labels.values()],right=Math.max(...xs.map(b=>b.x+b.w)),left=Math.min(0,...xs.map(b=>b.x));
 if(left<0)for(const b of xs)b.x-=left-8;
 return{width:right-Math.min(0,left-8)+24,height:Math.max(top+stateHeight+34,...[...labels.values()].map(l=>l.y+l.h+12)),states,labels,rowY};
}

export function sourceAssessments(review,propertyIds){
 return review.evidence.filter(e=>e.kind==='source-judgment'&&e.propertyIds.some(id=>propertyIds.includes(id))).map(evidence=>({evidence,historical:!!evidence.stale||evidence.outdatedPropertyIds?.some(id=>propertyIds.includes(id))||false,reason:evidence.stale?'Recorded for an earlier revision':evidence.outdatedPropertyIds?.some(id=>propertyIds.includes(id))?'Recorded for a previous property definition':null}));
}
