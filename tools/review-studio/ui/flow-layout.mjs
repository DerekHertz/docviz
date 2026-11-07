// Pure layout and routing for the system map: module boxes, routed directed flows and label boxes.
//
// Modules sit in rank columns, and a label column sits between every pair of rank columns. Each flow
// becomes a chain of boxes, one per column it crosses: its source module, its own label box (or a thin
// pass-through slot), and its target module. Boxes in one column are stacked and never overlap, and a
// flow turns only in the channels between columns, on a vertical track no other flow in that channel
// uses. So an arrow can meet only the boxes of its own chain: it leaves its declared source, runs
// through its own label, and ends on its declared target.
//
// Cycles have no left-to-right order. They are broken for layout only: a backward flow keeps its
// declared direction (drawn right to left) and is returned in `backward` so the view can name it.
// A flow from a module to itself has no route and is returned in `selfLoops`.

// `char` is a conservative width for one 11px sans-serif character, so a label box always holds its text.
export const FLOW_METRICS={nodeWidth:140,nodeHeight:80,gap:14,margin:14,stub:12,track:8,char:6.1,lineHeight:14,labelPadX:7,labelPadY:5,wrap:18,minChannel:20,corner:6};
// Tried only when the full size would need panning: narrower modules (titles wrap) and labels.
const COMPACT={nodeWidth:118,nodeHeight:84,wrap:13};

// Greedy wrap at spaces only, so the lines joined by single spaces read exactly as the declared label.
export function wrapLabel(text,max){
 const lines=[];for(const word of String(text??'').split(' ')){const last=lines.at(-1);if(last!==undefined&&(last+' '+word).length<=max)lines[lines.length-1]=last+' '+word;else lines.push(word);}
 return lines.length?lines:[''];
}

export function flowLayout(nodes,edges,options){
 const available=typeof options==='number'?options:options?.available??Infinity;
 const full=layoutWith(nodes,edges,FLOW_METRICS);
 if(!(full.width>available))return{...full,available,pans:false};
 const compact=layoutWith(nodes,edges,{...FLOW_METRICS,...COMPACT});
 return compact.width<=available?{...compact,available,pans:false}:{...full,available,pans:true};
}

function isotonic(targets,weights){
 const blocks=[];
 targets.forEach((v,i)=>{blocks.push({v,w:weights[i],n:1});while(blocks.length>1&&blocks.at(-2).v>blocks.at(-1).v){const b=blocks.pop(),a=blocks.pop();blocks.push({v:(a.v*a.w+b.v*b.w)/(a.w+b.w),w:a.w+b.w,n:a.n+b.n});}});
 return blocks.flatMap(b=>Array(b.n).fill(b.v));
}

function layoutWith(nodes,edges,m){
 const ids=nodes.map(n=>n.id),known=new Set(ids);
 const flows=edges.filter(e=>known.has(e.from)&&known.has(e.to)),selfLoops=flows.filter(e=>e.from===e.to),drawn=flows.filter(e=>e.from!==e.to);

 // 1. Break cycles with a depth-first search in declared order. A DAG has no backward flows.
 const out=new Map(ids.map(id=>[id,[]]));for(const e of drawn)out.get(e.from).push(e);
 const seen=new Map(),backward=new Set();
 const visit=id=>{seen.set(id,1);for(const e of out.get(id)){const s=seen.get(e.to);if(s===1)backward.add(e);else if(!s)visit(e.to);}seen.set(id,2);};
 for(const id of ids)if(!seen.get(id))visit(id);
 const oriented=drawn.map(e=>backward.has(e)?{edge:e,from:e.to,to:e.from,back:true}:{edge:e,from:e.from,to:e.to,back:false});

 // 2. Rank by longest path; a module with no inbound flow sits just left of its nearest successor.
 const rank=new Map(ids.map(id=>[id,0])),indegree=new Map(ids.map(id=>[id,0]));
 for(const o of oriented)indegree.set(o.to,indegree.get(o.to)+1);
 const queue=ids.filter(id=>!indegree.get(id));
 while(queue.length){const id=queue.shift();for(const o of oriented)if(o.from===id){rank.set(o.to,Math.max(rank.get(o.to),rank.get(id)+1));indegree.set(o.to,indegree.get(o.to)-1);if(!indegree.get(o.to))queue.push(o.to);}}
 for(const id of ids)if(!oriented.some(o=>o.to===id)){const next=oriented.filter(o=>o.from===id).map(o=>rank.get(o.to));if(next.length)rank.set(id,Math.min(...next)-1);}
 const ranks=Math.max(0,...rank.values())+1,columns=2*ranks-1,col=[...Array(columns)].map(()=>[]);
 const add=item=>{item.prev=[];item.next=[];col[item.col].push(item);return item;};
 const nodeItem=new Map(ids.map(id=>[id,add({kind:'node',id,col:2*rank.get(id),w:m.nodeWidth,h:m.nodeHeight})]));

 // 3. One chain per flow. Its label box sits in the label column nearest the middle of its span.
 const chains=oriented.map(o=>{
  const a=2*rank.get(o.from),b=2*rank.get(o.to),mid=(a+b)/2,labelCol=mid%2?mid:mid-1,lines=wrapLabel(o.edge.label,m.wrap);
  const seq=[nodeItem.get(o.from)];
  for(let c=a+1;c<b;c++)seq.push(add(c===labelCol?{kind:'label',col:c,lines,w:Math.ceil(Math.max(...lines.map(l=>l.length))*m.char+2*m.labelPadX),h:lines.length*m.lineHeight+2*m.labelPadY}:{kind:'pass',col:c,w:0,h:2}));
  seq.push(nodeItem.get(o.to));
  const chain={...o,seq,exitY:[],entryY:[]};
  for(let k=0;k+1<seq.length;k++){seq[k].next.push({item:seq[k+1],chain,k});seq[k+1].prev.push({item:seq[k],chain,k});}
  return chain;
 });

 // 4. Order each column by barycentre sweeps, keeping the order with the fewest crossings.
 const number=()=>col.forEach(c=>c.forEach((it,i)=>it.order=i));number();
 const crossings=()=>{let n=0;for(let c=0;c+1<columns;c++){const s=col[c].flatMap(it=>it.next.map(l=>[it.order,l.item.order]));for(let i=0;i<s.length;i++)for(let j=i+1;j<s.length;j++)if((s[i][0]-s[j][0])*(s[i][1]-s[j][1])<0)n++;}return n;};
 let best=col.map(c=>[...c]),fewest=crossings();
 for(let pass=0;pass<8&&fewest;pass++){
  const down=pass%2===0;
  for(let i=1;i<columns;i++){const c=down?i:columns-1-i,key=it=>{const ns=down?it.prev:it.next;return ns.length?ns.reduce((s,l)=>s+l.item.order,0)/ns.length:it.order;};col[c].sort((x,y)=>key(x)-key(y)||x.order-y.order);col[c].forEach((it,k)=>it.order=k);}
  const n=crossings();if(n<fewest){fewest=n;best=col.map(c=>[...c]);}
 }
 best.forEach((c,i)=>col[i]=c);number();

 // 5. Vertical positions. Ports spread each module side by the order of what they connect to; every box
 // is pulled toward the attachments of its neighbours, then stacked without overlap (isotonic fit).
 let rounded=false;
 const ports=()=>{for(const it of nodeItem.values()){const top=it.y-it.h/2,at=(i,n)=>rounded?Math.round(top+it.h*(i+1)/(n+1)):top+it.h*(i+1)/(n+1);
  const right=[...it.next].sort((p,q)=>p.item.y-q.item.y||p.item.order-q.item.order);right.forEach((l,i)=>l.chain.exitY[l.k]=at(i,right.length));
  const left=[...it.prev].sort((p,q)=>p.item.y-q.item.y||p.item.order-q.item.order);left.forEach((l,i)=>l.chain.entryY[l.k]=at(i,left.length));}
  for(const ch of chains)ch.seq.forEach((it,k)=>{if(it.kind==='node')return;ch.entryY[k-1]=it.y;ch.exitY[k]=it.y;});};
 const place=c=>{
  const items=col[c];if(!items.length)return;
  const want=items.map(it=>{const pulls=[...it.prev.map(l=>l.chain.exitY[l.k]-(l.chain.entryY[l.k]-it.y)),...it.next.map(l=>l.chain.entryY[l.k]-(l.chain.exitY[l.k]-it.y))];return pulls.length?pulls.reduce((s,v)=>s+v,0)/pulls.length:it.y;});
  const offset=[0];for(let i=1;i<items.length;i++)offset.push(offset[i-1]+(items[i-1].h+items[i].h)/2+m.gap);
  const fit=isotonic(want.map((v,i)=>v-offset[i]),items.map(it=>it.kind==='node'?2:1));
  items.forEach((it,i)=>it.y=fit[i]+offset[i]);
 };
 for(const c of col){let y=0;for(const it of c){it.y=y+it.h/2;y+=it.h+m.gap;}}
 for(let pass=0;pass<24;pass++)for(let i=0;i<columns;i++){ports();place(pass%2?columns-1-i:i);}
 // Straighten on whole pixels. A label or pass-through slot moves onto the nearer of its two
 // attachments; a module with no straight flow shifts by its smallest offset. Moves keep column spacing.
 const fits=(it,y)=>{const c=col[it.col],i=c.indexOf(it),a=c[i-1],b=c[i+1];return(!a||y-it.h/2-(a.y+a.h/2)>=m.gap)&&(!b||b.y-b.h/2-(y+it.h/2)>=m.gap);};
 const top=Math.min(...col.flat().map(it=>it.y-it.h/2));for(const it of col.flat())it.y=Math.round(it.y-top+m.margin);
 rounded=true;ports();
 for(let pass=0;pass<8;pass++){let moved=false;
  for(const it of col.flat()){
   const links=[...it.prev.map(l=>[l.chain.exitY[l.k],l.chain.entryY[l.k]]),...it.next.map(l=>[l.chain.entryY[l.k],l.chain.exitY[l.k]])];
   if(!links.length||links.some(([other,own])=>other===own))continue;
   const shift=links.map(([other,own])=>other-own).filter(d=>it.kind!=='node'||Math.abs(d)<=12).sort((a,b)=>Math.abs(a)-Math.abs(b)||a-b).find(d=>fits(it,it.y+d));
   if(shift!==undefined){it.y+=shift;ports();moved=true;}}
  if(!moved)break;}
 // A jog of a few pixels left at a module is removed by nudging that module's port (ports stay well apart).
 for(const ch of chains)ch.seq.slice(0,-1).forEach((it,k)=>{const d=ch.entryY[k]-ch.exitY[k];if(!d||Math.abs(d)>3)return;if(ch.seq[k+1].kind==='node')ch.entryY[k]=ch.exitY[k];else if(it.kind==='node')ch.exitY[k]=ch.entryY[k];});

 // 6. Channels. Every bent segment gets its own vertical track; tracks are ordered so a stub never runs
 // along another segment's stub at the same height.
 const channels=[];
 for(let c=0;c+1<columns;c++){
  const segs=chains.flatMap(ch=>ch.seq.slice(0,-1).map((it,k)=>({ch,k,it})).filter(s=>s.it.col===c)).map(s=>({...s,y1:s.ch.exitY[s.k],y2:s.ch.entryY[s.k]}));
  const bent=segs.filter(s=>s.y1!==s.y2);
  const down=bent.filter(s=>s.y2>s.y1).sort((p,q)=>q.y1-p.y1||p.y2-q.y2),up=bent.filter(s=>s.y2<s.y1).sort((p,q)=>p.y1-q.y1||q.y2-p.y2),order=[...down,...up];
  for(let guard=0;guard<order.length*order.length;guard++){let moved=false;
   for(let i=0;i<order.length&&!moved;i++)for(let j=0;j<i&&!moved;j++)if(Math.abs(order[i].y1-order[j].y2)<3){order.splice(j,0,order.splice(i,1)[0]);moved=true;}
   if(!moved)break;}
  order.forEach((s,i)=>s.track=i);
  channels.push({segs,order,width:order.length?Math.max(m.minChannel,2*m.stub+(order.length-1)*m.track):m.minChannel});
 }

 // 7. Columns left to right, boxes centred in their column.
 const colW=col.map((c,i)=>Math.max(i%2?0:m.nodeWidth,...c.map(it=>it.w))),colX=[];let x=m.margin;
 for(let c=0;c<columns;c++){colX[c]=x;x+=colW[c];if(c+1<columns){channels[c].x=x;x+=channels[c].width;}}
 const width=Math.ceil(x+m.margin);
 for(const c of col)for(const it of c)it.x=colX[it.col]+(colW[it.col]-it.w)/2;
 const height=Math.ceil(Math.max(m.margin,...col.flat().map(it=>it.y+it.h/2))+m.margin);

 // 8. Routes: a point list per chain, reversed for a backward flow so it starts on its declared source.
 const routes=chains.map(ch=>{
  const pts=[{x:ch.seq[0].x+ch.seq[0].w,y:ch.exitY[0]}];
  ch.seq.slice(1).forEach((it,i)=>{const s=channels[ch.seq[i].col].segs.find(s=>s.ch===ch&&s.k===i),y=ch.entryY[i];
   if(s.track!==undefined){const t=channels[ch.seq[i].col].x+m.stub+s.track*m.track;pts.push({x:t,y:ch.exitY[i]},{x:t,y});}
   if(it.kind==='node'){pts.push({x:it.x,y});return;}
   pts.push({x:colX[it.col],y});if(it.kind==='label')pts.push({x:it.x,y},{x:it.x+it.w,y});pts.push({x:colX[it.col]+colW[it.col],y});});
  const points=ch.back?pts.reverse():pts,label=ch.seq.find(it=>it.kind==='label');
  return{id:ch.edge.id,edge:ch.edge,from:ch.edge.from,to:ch.edge.to,back:ch.back,points,d:pathOf(points,m.corner),label:label?{x:label.x,y:label.y-label.h/2,w:label.w,h:label.h,lines:label.lines}:null};
 });
 const positions=new Map([...nodeItem].map(([id,it])=>[id,{x:it.x+it.w/2,y:it.y,left:it.x,top:it.y-it.h/2,w:it.w,h:it.h,rank:rank.get(id)}]));
 return{width,height,positions,edges:routes,backward:drawn.filter(e=>backward.has(e)),selfLoops,metrics:m};
}

// Orthogonal polyline to an SVG path with small rounded corners. Collinear points stay as plain L
// commands so the path keeps an explicit vertex at each label edge.
const num=v=>Math.round(v*10)/10;
export function pathOf(points,radius=6){
 const pts=points.filter((p,i)=>!i||p.x!==points[i-1].x||p.y!==points[i-1].y);
 let d=`M${num(pts[0].x)} ${num(pts[0].y)}`;
 for(let i=1;i<pts.length;i++){const a=pts[i-1],p=pts[i],b=pts[i+1];
  const turns=b&&((a.x===p.x)!==(p.x===b.x));
  if(!turns){d+=` L${num(p.x)} ${num(p.y)}`;continue;}
  const r=Math.min(radius,Math.hypot(p.x-a.x,p.y-a.y)/2,Math.hypot(b.x-p.x,b.y-p.y)/2),toward=(q,len)=>{const l=Math.hypot(q.x-p.x,q.y-p.y);return{x:p.x+(q.x-p.x)/l*len,y:p.y+(q.y-p.y)/l*len};};
  const s=toward(a,r),e=toward(b,r);
  d+=` L${num(s.x)} ${num(s.y)} C${num(p.x)} ${num(p.y)} ${num(p.x)} ${num(p.y)} ${num(e.x)} ${num(e.y)}`;
 }
 return d;
}
