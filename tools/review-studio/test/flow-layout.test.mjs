import test from 'node:test';
import assert from 'node:assert/strict';
import {flowLayout,wrapLabel} from '../ui/flow-layout.mjs';

// Route-level controls for the pure system-map layout. The rendered-SVG controls live in
// system-graph.test.mjs; these check what the SVG sampler cannot: two arrows drawn on top of each other.

const flows=rows=>rows.map(([from,to,label],i)=>({id:'flow-'+i,from,to,label}));
const modules=rows=>rows.map(([id,title])=>({id,title}));
// examples/stack/prepare-pr18.mjs, as published.
const pr18={nodes:modules([['git','Git adapter'],['snapshot','Change snapshot'],['cache','System map cache'],['judgment','Source judgment'],['checks','Execution evidence'],['review','Human review'],['handoff','Review handoff'],['cli','Docviz PR review'],['contracts','Contract assessment'],['verdict','PR verdict']]),
 edges:flows([['git','snapshot','source + diff'],['snapshot','cache','component model'],['snapshot','judgment','claim + code'],['snapshot','checks','check snapshot'],['cache','review','map context'],['judgment','review','assessment'],['checks','review','test outcomes'],['review','handoff','review record'],['cli','contracts','profile + changed paths + trusted head'],['contracts','verdict','contract statuses'],['contracts','checks','coverage record (fingerprinted)']])};
// examples/stack/prepare-pr1.mjs, as published.
const pr1={nodes:modules([['background','Card actions'],['helper','Helper call'],['ledger','Spend ledger'],['sidepanel','Side panel']]),
 edges:flows([['background','helper','card request'],['helper','ledger','reported usage'],['background','sidepanel','card records → page total'],['ledger','sidepanel','spend totals (shown separately)']])};
// Not published: two flows between the same modules, one that skips two ranks, and fan-in.
const parallel={nodes:modules([['a','Source'],['b','Middle'],['c','Later'],['d','Sink']]),
 edges:flows([['a','b','request'],['a','b','retry request'],['b','c','result'],['c','d','record'],['a','d','audit copy'],['b','d','usage']])};

const segments=pts=>pts.slice(1).map((q,i)=>[pts[i],q]);
function collinear(a,b){
 const found=[];
 for(const[p,q]of segments(a.points))for(const[r,s]of segments(b.points)){
  const span=(u,v,w,z)=>Math.min(Math.max(u,v),Math.max(w,z))-Math.max(Math.min(u,v),Math.min(w,z));
  if(p.y===q.y&&r.y===s.y&&p.y===r.y&&span(p.x,q.x,r.x,s.x)>0.5)found.push(`y=${p.y}`);
  if(p.x===q.x&&r.x===s.x&&p.x===r.x&&span(p.y,q.y,r.y,s.y)>0.5)found.push(`x=${p.x}`);
 }
 return found;
}
const orthogonal=e=>segments(e.points).every(([p,q])=>p.x===q.x||p.y===q.y);

for(const[name,graph]of[['PR1',pr1],['PR18',pr18],['parallel and skipping flows',parallel]])for(const available of[1270,988,320])
 test(`${name} at ${available}px: no two arrows share a run, and every route is orthogonal`,()=>{
  const l=flowLayout(graph.nodes,graph.edges,{available}),shared=[];
  assert.equal(l.edges.length,graph.edges.length);
  for(const e of l.edges)assert(orthogonal(e),`${e.edge.label} has a diagonal run`);
  for(let i=0;i<l.edges.length;i++)for(let j=i+1;j<l.edges.length;j++)for(const at of collinear(l.edges[i],l.edges[j]))shared.push(`${l.edges[i].edge.label} / ${l.edges[j].edge.label} at ${at}`);
  assert.deepEqual(shared,[]);
 });

test('two flows between the same modules keep their own ports and labels',()=>{
 const l=flowLayout(parallel.nodes,parallel.edges),[a,b]=l.edges;
 assert.notEqual(a.points[0].y,b.points[0].y);
 assert.notEqual(a.points.at(-1).y,b.points.at(-1).y);
 assert(a.label.y+a.label.h<=b.label.y||b.label.y+b.label.h<=a.label.y,'labels stacked apart');
});

test('the same graph always gets the same drawing',()=>{
 const one=flowLayout(pr18.nodes,pr18.edges,{available:1270}),two=flowLayout(pr18.nodes,pr18.edges,{available:1270});
 assert.deepEqual(one.edges.map(e=>e.d),two.edges.map(e=>e.d));
 assert.deepEqual([...one.positions],[...two.positions]);
});

test('PR18 fits the 1676px desktop flow area; narrower views pan at full size and say so',()=>{
 const desk=flowLayout(pr18.nodes,pr18.edges,{available:1270});
 assert(desk.width<=1270&&!desk.pans,`PR18 is ${desk.width}px wide`);
 for(const available of[988,320]){const l=flowLayout(pr18.nodes,pr18.edges,{available});assert.equal(l.pans,l.width>available);if(l.pans)assert.equal(l.metrics.nodeWidth,140,'a panned map keeps full-size modules');}
});

test('labels wrap only at spaces, so the wrapped lines read as the declared label',()=>{
 for(const label of pr18.edges.map(e=>e.label).concat(['a-very-long-unbroken-identifier.with.dots','']))assert.equal(wrapLabel(label,13).join(' '),label);
});

test('a cycle keeps its declared direction and a self-reference is reported rather than routed',()=>{
 const l=flowLayout(modules([['a','Planner'],['b','Executor'],['c','Reviewer']]),flows([['a','b','plan'],['b','c','result'],['c','a','revision request'],['b','b','retry']]));
 assert.deepEqual(l.backward.map(e=>e.label),['revision request']);
 assert.deepEqual(l.selfLoops.map(e=>e.label),['retry']);
 const back=l.edges.find(e=>e.back),from=l.positions.get('c'),to=l.positions.get('a');
 assert.equal(back.points[0].x,from.left,'starts on the Reviewer box');
 assert.equal(back.points.at(-1).x,to.left+to.w,'ends on the Planner box');
});
