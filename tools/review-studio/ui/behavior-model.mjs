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
const executedHere=(evidence,tip,outcome)=>evidence?.provenance==='executed-by-docviz'&&evidence.outcome===outcome&&evidence.head===tip;
function coverageMark(row,tip){
 if(!row)return coverageMarks['no-result'];
 if(row.applies===null)return coverageMarks.unknown;
 if(row.status==='violated')return executedHere(row.evidence,tip,'fails')?coverageMarks.violated:{...coverageMarks.unverified,note:'The violation is not backed by a docviz execution at this head.'};
 if(row.status==='supported-in-scope')return executedHere(row.evidence,tip,'holds')?coverageMarks['supported-in-scope']:{...coverageMarks.unverified,note:'The support is not backed by a docviz execution at this head.'};
 return coverageMarks[row.status]||coverageMarks.unknown;
}
export function coverageResultMark(result,row,tip){return result&&result.head!==tip?{...coverageMarks.unknown,label:'Coverage recorded for another revision'}:coverageMark(row,tip);}
const overlaps=(a,b)=>a.path===b.path&&a.commit===b.commit&&a.from<=b.to&&b.from<=a.to;

export function coverageLifecycle(stack,{lifecycleId,step}={}){
 const lifecycle=(stack.lifecycles||[]).find(l=>!lifecycleId||l.id===lifecycleId);if(!lifecycle)return null;
 const steps=stack.authorSummary?.steps||[];
 const events=lifecycle.events.map(e=>{const citedBy=steps.filter(s=>s.sources.some(a=>e.sources.some(b=>overlaps(a,b)))).map(s=>s.id);return{...e,citedBy,omitted:!citedBy.length};});
 const summary={steps:steps.map(s=>({...s,events:events.filter(e=>e.citedBy.includes(s.id)).map(e=>e.id)})),edges:stack.authorSummary?.edges||[],gutter:steps.filter(s=>!events.some(e=>e.citedBy.includes(s.id))).map(s=>s.id)};
 const result=(stack.coverage||[]).find(v=>v.rows?.some(r=>r.contractId===lifecycle.contractId))||null,row=result?.rows.find(r=>r.contractId===lifecycle.contractId)||null;
 const stale=!!result&&result.head!==stack.tip;
 const mark=coverageResultMark(result,row,stack.tip);
 // Playback uses only per-action states a docviz execution recorded at this head. Nothing is inferred from the final result.
 const execution=!stale&&row?.evidence?.provenance==='executed-by-docviz'&&row.evidence.head===stack.tip?row.evidence:null;
 const frames=Array.isArray(execution?.observed?.frames)?execution.observed.frames.filter(f=>f&&typeof f.id==='string'):[];
 const index=Math.max(0,Math.min(Number.isInteger(step)?step:frames.length-1,frames.length-1)),frame=frames[index];
 const eventOf=f=>events.find(e=>(e.frame??e.id)===f.id)||null;
 return{lifecycle,events,summary,result,row,mark,stale,banner:stale?`Coverage recorded for ${result.head.slice(0,7)}; this review is ${stack.tip.slice(0,7)}. Every mark is shown as unknown.`:null,
  execution,frames,index,canPlay:frames.length>1,atOutcome:frames.length>0&&index===frames.length-1,state:frame?eventOf(frame)?.to??null:null,
  reached:new Set(frames.slice(0,index+1).map(eventOf).filter(Boolean).map(e=>e.id)),
  rail:lifecycle.rail.map(r=>({...r,value:frame?frame[r.field]:undefined,history:frames.slice(0,index+1).map(f=>f[r.field])})),
  railEdges:lifecycle.rail.filter(r=>r.from).map(r=>({from:r.from,to:r.id}))};
}

// Linear left-to-right lifecycle. Each gap is wide enough for its event label plus visible arrow ends.
export function lifecycleLayout(lc,{stateWidth=124,stateHeight=48,rowY=64}={}){
 const order=lc.lifecycle.states.map(s=>s.id),states=new Map(),labels=new Map();
 const labelWidth=e=>Math.round(e.label.length*6.4+(e.omitted?40:22));
 let x=24;
 order.forEach((id,i)=>{states.set(id,{x,y:rowY-stateHeight/2,w:stateWidth,h:stateHeight});const next=lc.events.find(e=>e.from===id&&e.to===order[i+1]);x+=stateWidth+(next?Math.max(70,labelWidth(next)+44):70);});
 lc.events.forEach((e,i)=>{const a=states.get(e.from),b=states.get(e.to);if(!a||!b)return;const w=labelWidth(e),adjacent=order.indexOf(e.to)===order.indexOf(e.from)+1;
  labels.set(e.id,adjacent?{x:Math.round((a.x+a.w+b.x)/2-w/2),y:rowY-11,w,h:22}:{x:Math.round((a.x+b.x+b.w)/2-w/2),y:rowY+stateHeight/2+30+i*26,w,h:22});});
 const bottom=Math.max(rowY+stateHeight/2+34,...[...labels.values()].map(l=>l.y+l.h+12));
 return{width:x-70+24,height:bottom,states,labels,rowY};
}

export function sourceAssessments(review,propertyIds){
 return review.evidence.filter(e=>e.kind==='source-judgment'&&e.propertyIds.some(id=>propertyIds.includes(id))).map(evidence=>({evidence,historical:!!evidence.stale||evidence.outdatedPropertyIds?.some(id=>propertyIds.includes(id))||false,reason:evidence.stale?'Recorded for an earlier revision':evidence.outdatedPropertyIds?.some(id=>propertyIds.includes(id))?'Recorded for a previous property definition':null}));
}
