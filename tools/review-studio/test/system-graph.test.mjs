import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBehaviorView} from '../ui/behavior.js';

// Geometry controls for the rendered system map. They read the SVG the real renderer emits and check
// what a reader relies on: each arrow leaves its declared source and ends on its declared target, never
// crosses an unrelated module, and its label sits on that arrow alone. They say nothing about beauty.

const edgeList=rows=>rows.map(([from,to,label],index)=>({id:'flow-'+index,from,to,label,basis:'source-interpretation'}));
// examples/stack/prepare-pr1.mjs, nodes and edges as published.
const pr1={nodes:[['background','Card actions'],['helper','Helper call'],['ledger','Spend ledger'],['sidepanel','Side panel']],changed:['background','ledger'],
 edges:edgeList([['background','helper','card request'],['helper','ledger','reported usage'],['background','sidepanel','card records → page total'],['ledger','sidepanel','spend totals (shown separately)']])};
// examples/stack/prepare-pr18.mjs, 10 modules and 11 flows as published.
const pr18={nodes:[['git','Git adapter'],['snapshot','Change snapshot'],['cache','System map cache'],['judgment','Source judgment'],['checks','Execution evidence'],['review','Human review'],['handoff','Review handoff'],['cli','Docviz PR review'],['contracts','Contract assessment'],['verdict','PR verdict']],changed:['git','snapshot','cache','judgment','checks','review','handoff','cli','contracts'],
 edges:edgeList([['git','snapshot','source + diff'],['snapshot','cache','component model'],['snapshot','judgment','claim + code'],['snapshot','checks','check snapshot'],['cache','review','map context'],['judgment','review','assessment'],['checks','review','test outcomes'],['review','handoff','review record'],['cli','contracts','profile + changed paths + trusted head'],['contracts','verdict','contract statuses'],['contracts','checks','coverage record (fingerprinted)']])};
const stored=JSON.parse(readFileSync(new URL('../examples/stack/docviz.json',import.meta.url),'utf8'));
const history={nodes:stored.nodes.map(n=>[n.id,n.title]),changed:[],edges:stored.edges};
// Not a published graph: a cycle and a self-reference, to check the fallback stays legible and honest.
const cyclic={nodes:[['a','Planner'],['b','Executor'],['c','Reviewer'],['d','Archive']],changed:['b'],
 edges:edgeList([['a','b','plan'],['b','c','result'],['c','a','revision request'],['c','d','approved record'],['b','b','retry']])};

function render(graph,width){
 const head='b'.repeat(40),base='a'.repeat(40);
 const stack={id:'graph',target:base,tip:head,kind:'pr-checkpoints',layers:[{id:'initial',title:'Initial',parent:base,head,changedNodes:graph.changed}],
  nodes:graph.nodes.map(([id,title])=>({id,title,inputs:[],outputs:['output of '+id],sources:[{commit:head,path:id+'.mjs',from:1,to:2}]})),edges:graph.edges,scenarios:[],captures:[]};
 const dialog={open:false,innerHTML:'',showModal(){this.open=true;},close(){this.open=false;}};
 const code={isConnected:true,innerHTML:'',textContent:''};
 const host={innerHTML:'',getBoundingClientRect(){return{width};},querySelector(s){return s==='#behavior-dialog'?dialog:s==='#behavior-code'?code:null;}};
 const view=createBehaviorView({api:async()=>({path:'x',commit:head,blob:head,text:'a\nb'}),onProperty(){},onAgents(){},onReview(){},onFiles(){}});
 view.mount(host,stack,{repository:{name:'graph'},properties:[],evidence:[],findings:[]});
 return{host,dialog,view,stack,html:host.innerHTML};
}

const attr=(tag,name)=>{const m=tag.match(new RegExp(`\\s${name}="([^"]*)"`));return m?m[1]:null;};
const num=(tag,name)=>Number(attr(tag,name));
const unesc=s=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
const CHAR=6;// conservative width of one 11px sans-serif character
function samplePath(d){
 const tokens=d.match(/[MLC]|-?\d*\.?\d+(?:e-?\d+)?/g),points=[];let i=0,cmd=null,at=null;
 const n=()=>Number(tokens[i++]);
 while(i<tokens.length){if(/[MLC]/.test(tokens[i]))cmd=tokens[i++];
  if(cmd==='M'||cmd==='L'){const p={x:n(),y:n()};if(cmd==='L'&&at)for(let t=1;t<=20;t++)points.push({x:at.x+(p.x-at.x)*t/20,y:at.y+(p.y-at.y)*t/20});else points.push(p);at=p;}
  else if(cmd==='C'){const c1={x:n(),y:n()},c2={x:n(),y:n()},p={x:n(),y:n()};for(let t=1;t<=40;t++){const u=t/40,v=1-u;points.push({x:v*v*v*at.x+3*v*v*u*c1.x+3*v*u*u*c2.x+u*u*u*p.x,y:v*v*v*at.y+3*v*v*u*c1.y+3*v*u*u*c2.y+u*u*u*p.y});}at=p;}
  else throw new Error('Unsupported path command in '+d);}
 return points;
}
function parse(html){
 const svgTag=html.match(/<svg class="behavior-flow"[^>]*>/)[0],[,, W,H]=attr(svgTag,'viewBox').split(' ').map(Number);
 const modules=new Map([...html.matchAll(/<foreignObject([^>]*)>\s*<button([^>]*)>/g)].map(([,tag,btn])=>[attr(btn,'data-id'),{x:num(tag,'x'),y:num(tag,'y'),w:num(tag,'width'),h:num(tag,'height'),cls:attr(btn,'class')}]));
 const edges=new Map([...html.matchAll(/<g class="flow-edge[^"]*"[^>]*>[\s\S]*?<\/g>/g)].map(([g])=>{
  const open=g.match(/^<g[^>]*>/)[0],visible=[...g.matchAll(/<path(?![^>]*flow-edge-hit)[^>]*>/g)].map(m=>attr(m[0],'d'));
  const rect=g.match(/<rect[^>]*class="flow-edge-label"[^>]*>/)?.[0]||g.match(/<rect[^>]*>/)?.[0];
  const text=g.match(/<text[^>]*>([\s\S]*?)<\/text>/),lines=text?(text[1].includes('<tspan')?[...text[1].matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(m=>unesc(m[1])):[unesc(text[1])]):[];
  const label=rect?{x:num(rect,'x'),y:num(rect,'y'),w:num(rect,'width'),h:num(rect,'height')}:text?(()=>{const t=text[0],w=lines[0].length*CHAR;return{x:num(t,'x')-w/2,y:num(t,'y')-11,w,h:14};})():null;
  return[attr(open,'data-id'),{open,points:samplePath(visible.join(' ')),label,lines,aria:unesc(attr(open,'aria-label')||'')}];}));
 return{svgTag,W,H,modules,edges};
}
const inside=(p,r,inset=1)=>p.x>r.x+inset&&p.x<r.x+r.w-inset&&p.y>r.y+inset&&p.y<r.y+r.h-inset;
const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
const onBoundary=(p,r,tol=1.5)=>!inside(p,r,tol)&&p.x>=r.x-tol&&p.x<=r.x+r.w+tol&&p.y>=r.y-tol&&p.y<=r.y+r.h+tol;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

function checkGeometry(graph,width){
 const r=render(graph,width),g=parse(r.html),titles=new Map(graph.nodes),problems=[];
 const drawn=graph.edges.filter(e=>e.from!==e.to);
 assert.equal(g.modules.size,graph.nodes.filter(([id])=>graph.edges.some(e=>e.from===id||e.to===id)).length,'every connected module is drawn once');
 for(const e of drawn){
  const edge=g.edges.get(e.id);if(!edge){problems.push(`${e.id} is not drawn`);continue;}
  const a=g.modules.get(e.from),b=g.modules.get(e.to),first=edge.points[0],last=edge.points.at(-1),name=`${titles.get(e.from)} → ${titles.get(e.to)} (${e.label})`;
  if(!onBoundary(first,a))problems.push(`${name} does not start on ${titles.get(e.from)}: starts at ${first.x.toFixed(0)},${first.y.toFixed(0)}`);
  if(!onBoundary(last,b))problems.push(`${name} does not end on ${titles.get(e.to)}: ends at ${last.x.toFixed(0)},${last.y.toFixed(0)}`);
  for(const[id,m]of g.modules)if(edge.points.some(p=>inside(p,m)))problems.push(`${name} crosses module ${titles.get(id)}`);
  if(edge.lines.join(' ')!==e.label)problems.push(`${name} label reads "${edge.lines.join(' ')}"`);
  const l=edge.label;
  if(l.w<Math.max(...edge.lines.map(s=>s.length))*CHAR)problems.push(`${name} label box is narrower than its text`);
  if(!edge.points.some(p=>inside(p,l,0)))problems.push(`${name} label is not on its own arrow`);
  for(const[id,m]of g.modules)if(overlap(l,m))problems.push(`${name} label overlaps module ${titles.get(id)}`);
  if(l.x<0||l.y<0||l.x+l.w>g.W||l.y+l.h>g.H||edge.points.some(p=>p.x<0||p.y<0||p.x>g.W||p.y>g.H))problems.push(`${name} leaves the drawing`);
  if(!edge.aria.includes(titles.get(e.from))||!edge.aria.includes(titles.get(e.to))||!edge.aria.includes(e.label))problems.push(`${name} accessible name omits its declared modules`);
  if(!/role="button"/.test(edge.open)||!/tabindex="0"/.test(edge.open))problems.push(`${name} is not keyboard reachable`);
 }
 for(const e of drawn)for(const f of drawn){if(e.id>=f.id)continue;const a=g.edges.get(e.id),b=g.edges.get(f.id);if(!a||!b)continue;
  if(overlap(a.label,b.label))problems.push(`labels "${e.label}" and "${f.label}" collide`);
  if(b.points.some(p=>inside(p,a.label)))problems.push(`arrow "${f.label}" runs under label "${e.label}"`);
  if(a.points.some(p=>inside(p,b.label)))problems.push(`arrow "${e.label}" runs under label "${f.label}"`);
  if(e.from===f.from&&dist(a.points[0],b.points[0])<6)problems.push(`"${e.label}" and "${f.label}" leave ${titles.get(e.from)} from one point`);
  if(e.to===f.to&&dist(a.points.at(-1),b.points.at(-1))<6)problems.push(`"${e.label}" and "${f.label}" arrive at ${titles.get(e.to)} on one point`);}
 for(const[id,m]of g.modules)for(const[other,n]of g.modules)if(id<other&&overlap(m,n))problems.push(`modules ${titles.get(id)} and ${titles.get(other)} overlap`);
 return{r,g,problems};
}

for(const[name,graph]of[['PR1',pr1],['PR18',pr18],['reconstructed history',history],['cyclic fallback',cyclic]])for(const width of[1676,1280,390])
 test(`${name} system map at ${width}px: arrows run between their declared modules and labels sit on their own arrow`,()=>{
  const{problems,g,r}=checkGeometry(graph,width);
  assert.deepEqual(problems,[]);
  assert.equal(attr(g.svgTag,'width'),String(g.W),'drawn at its own size so 11px labels are not scaled down');
  const available=width-68;
  if(g.W>available)assert.match(r.html,/class="flow-pan-cue"[^>]*>[^<]*scroll/i,'a wider-than-view map says it pans');
  else assert.doesNotMatch(r.html,/flow-pan-cue/);
  r.view.dispose();
 });

test('PR1: the direct card records flow does not pass through the helper or the ledger',()=>{
 const{g}=checkGeometry(pr1,1676),direct=g.edges.get('flow-2');
 for(const id of['helper','ledger'])assert(!direct.points.some(p=>inside(p,g.modules.get(id))),`passes through ${id}`);
 assert(!overlap(direct.label,g.edges.get('flow-1').label),'page-total label sits apart from reported usage');
});

test('changed and context overlays survive the routed map',()=>{
 const{g}=checkGeometry(pr18,1676);
 for(const[id]of pr18.nodes)assert.equal(/\bchanged\b/.test(g.modules.get(id).cls),pr18.changed.includes(id),id);
});

test('a cycle is drawn with its backward arrow named, and a self-reference stays inspectable',async()=>{
 const{r}=checkGeometry(cyclic,1280);
 assert.match(r.html,/class="flow-cycle-note"[^>]*>[^<]*Reviewer → Planner/);
 assert.match(r.html,/data-behavior-action="edge" data-id="flow-4"[^>]*>[^<]*Executor → Executor/);
 await r.host.onclick({target:{closest(){return{dataset:{behaviorAction:'edge',id:'flow-4'}};}}});
 assert.match(r.dialog.innerHTML,/Executor → <strong>retry<\/strong> → Executor/);
 r.view.dispose();
});

test('Enter on a routed flow opens that flow with both declared modules',async()=>{
 const r=render(pr1,1676);let prevented=0;
 await r.host.onkeydown({key:'Enter',preventDefault(){prevented++;},target:{matches:()=>true,closest:()=>({dataset:{behaviorAction:'edge',id:'flow-2'}})}});
 assert.equal(prevented,1);
 assert.match(r.dialog.innerHTML,/Card actions → <strong>card records → page total<\/strong> → Side panel/);
 r.view.dispose();
});
