/* RouteLab: deterministic, discrete-event educational routing simulator. */
export const PROTOCOLS = ['RIP', 'OSPF', 'EIGRP'];
export const defaults = { duration: 60, rate: 30, size: 1024, seed: 42, failure: true, failureAt: 20, failureLink: 'l3', source: 'PC1', target: 'PC2', queueLimit: 32 };
export function sampleTopology() {
  return { nodes: [
    {id:'PC1',type:'host',x:95,y:230}, {id:'R1',type:'router',x:245,y:230},
    {id:'R2',type:'router',x:410,y:110}, {id:'R3',type:'router',x:410,y:355},
    {id:'R4',type:'router',x:600,y:110}, {id:'R5',type:'router',x:600,y:355},
    {id:'R6',type:'router',x:770,y:230}, {id:'PC2',type:'host',x:920,y:230}
  ], links: [
    {id:'l1',a:'PC1',b:'R1',bandwidth:100,delay:1,up:true},
    {id:'l2',a:'R1',b:'R2',bandwidth:100,delay:2,up:true},
    {id:'l3',a:'R2',b:'R4',bandwidth:100,delay:3,up:true},
    {id:'l4',a:'R4',b:'R6',bandwidth:100,delay:2,up:true},
    {id:'l5',a:'R1',b:'R3',bandwidth:10,delay:8,up:true},
    {id:'l6',a:'R3',b:'R5',bandwidth:10,delay:8,up:true},
    {id:'l7',a:'R5',b:'R6',bandwidth:10,delay:8,up:true},
    {id:'l8',a:'R2',b:'R3',bandwidth:50,delay:4,up:true},
    {id:'l9',a:'R4',b:'R5',bandwidth:50,delay:4,up:true},
    {id:'l10',a:'R6',b:'PC2',bandwidth:100,delay:1,up:true}
  ] };
}
export function validateTopology(t) {
  if (!t || !Array.isArray(t.nodes) || !Array.isArray(t.links)) throw Error('Expected nodes and links arrays.');
  if(t.nodes.length<2 || t.nodes.length>30 || t.links.length>80) throw Error('Use 2–30 devices and at most 80 links.');
  const ids=new Set();
  for(const n of t.nodes){if(!/^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(n.id)||ids.has(n.id)||!['router','host'].includes(n.type)||!Number.isFinite(n.x)||!Number.isFinite(n.y))throw Error('Invalid device or duplicate device ID.');ids.add(n.id);}
  const lids=new Set(), pairs=new Set();
  for(const l of t.links){const pair=[l.a,l.b].sort().join('|');if(!ids.has(l.a)||!ids.has(l.b)||l.a===l.b||lids.has(l.id)||pairs.has(pair)||typeof l.id!=='string'||!Number.isFinite(l.bandwidth)||l.bandwidth<0.01||l.bandwidth>10000||!Number.isFinite(l.delay)||l.delay<0||l.delay>1000||typeof l.up!=='boolean')throw Error('Invalid link, capacity, delay, or duplicate connection.');lids.add(l.id);pairs.add(pair);}
  for(const n of t.nodes.filter(n=>n.type==='host'))if(t.links.filter(l=>l.a===n.id||l.b===n.id).length>1)throw Error('End hosts can have only one connection.');
  return true;
}
class Heap {
  constructor(){this.q=[];this.seq=0;}
  push(time,fn){const x={time,fn,seq:this.seq++};let i=this.q.length;this.q.push(x);while(i){let p=(i-1)>>1;if(this.less(this.q[p],x))break;this.q[i]=this.q[p];i=p;}this.q[i]=x;}
  less(a,b){return a.time<b.time||(a.time===b.time&&a.seq<b.seq);}
  pop(){if(!this.q.length)return null;const a=this.q[0],x=this.q.pop();if(this.q.length){let i=0;while(2*i+1<this.q.length){let j=2*i+1;if(j+1<this.q.length&&this.less(this.q[j+1],this.q[j]))j++;if(this.less(x,this.q[j]))break;this.q[i]=this.q[j];i=j;}this.q[i]=x;}return a;}
}
export function simulate(topology, protocol, input={}) {
  validateTopology(topology);if(!PROTOCOLS.includes(protocol))throw Error('Unknown protocol.');
  const c={...defaults,...input}, t=structuredClone(topology);
  if(!Number.isFinite(c.duration)||c.duration<5||c.duration>180||!Number.isFinite(c.rate)||c.rate<1||c.rate>500||!Number.isInteger(c.size)||c.size<64||c.size>1500||!Number.isInteger(c.seed)||!Number.isInteger(c.queueLimit)||c.queueLimit<1||c.queueLimit>1024||!Number.isFinite(c.failureAt)||c.failureAt<0)throw Error('Invalid experiment parameters.');
  if(!t.nodes.some(n=>n.id===c.source)||!t.nodes.some(n=>n.id===c.target)||c.source===c.target)throw Error('Choose two different devices.');
  if(c.failure&&(!t.links.some(l=>l.id===c.failureLink&&l.up)||c.failureAt>=c.duration))throw Error('Choose an active failure link and a failure time within the run.');
  const heap=new Heap(), nodes=new Map(t.nodes.map(n=>[n.id,n])), routers=t.nodes.filter(n=>n.type==='router').map(n=>n.id), routerSet=new Set(routers);
  const tables=Object.fromEntries(routers.map(r=>[r,{}])), neighbors={}, lsdb={}, vectors={}, seq={}, pending={}, logs=[], changes=[], packets=[], ctrlPackets=[];
  let now=0, controlBytes=0, controlMessages=0, processed=0, state=(c.seed>>>0)||1;
  const rand=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
  const linksFor=r=>t.links.filter(l=>l.up&&(l.a===r||l.b===r));
  const other=(l,r)=>l.a===r?l.b:l.a;
  const findLink=(a,b)=>t.links.find(l=>l.up&&((l.a===a&&l.b===b)||(l.b===a&&l.a===b)));
  const log=(type,device,message)=>{if(logs.length<18000)logs.push({time:now,type,device,message});};
  const snapshot=()=>Object.fromEntries(routers.map(r=>[r,structuredClone(tables[r])]));
  const signature=table=>JSON.stringify(Object.entries(table).sort().map(([d,v])=>[d,v.next,Math.round(v.metric*1e6)/1e6]));
  const queues=new Map();
  function transmit(a,b,size,callback,control=false){
    const l=findLink(a,b);if(!l)return false;
    const key=l.id+':'+a;const q=(queues.get(key)||[]).filter(end=>end>now);
    if(q.length>=c.queueLimit){queues.set(key,q);return false;}
    const start=Math.max(now,q.at(-1)||now), end=start+size*8/(l.bandwidth*1e6);q.push(end);queues.set(key,q);
    if(control){controlBytes+=size;controlMessages++;ctrlPackets.push({time:now,bytes:size});}
    heap.push(end+l.delay/1000,()=>{if(l.up)callback();else if(!control)callback('Link failed in transit');});return true;
  }
  function setTable(r,newTable){if(signature(tables[r])!==signature(newTable)){tables[r]=newTable;changes.push({time:now,router:r});log('route',r,`Routing table changed · ${Object.keys(newTable).length} destinations`);return true;}return false;}
  function direct(r){const d={[r]:{next:r,metric:0,path:[r],bw:Infinity,delay:0}};for(const l of linksFor(r)){const n=other(l,r);if(!routerSet.has(n))d[n]={next:n,metric:protocol==='RIP'?1:protocol==='OSPF'?Math.max(1,100/l.bandwidth):256*(10000/l.bandwidth+l.delay*100),path:[r,n],bw:l.bandwidth,delay:l.delay};}return d;}
  function dijkstra(r,db){const graph={};for(const [origin,entry]of Object.entries(db)){graph[origin]=entry.edges;}
    const dist={[r]:0}, paths={[r]:[r]}, seen=new Set();
    while(true){let u=null;for(const k of Object.keys(dist))if(!seen.has(k)&&(u===null||dist[k]<dist[u]))u=k;if(u===null)break;seen.add(u);
      for(const e of graph[u]||[]){if(routerSet.has(e.to)&&!(graph[e.to]||[]).some(x=>x.to===u))continue;const cost=Math.max(1,100/e.bandwidth), nd=dist[u]+cost;if(nd<(dist[e.to]??Infinity)){dist[e.to]=nd;paths[e.to]=[...paths[u],e.to];}}}
    return Object.fromEntries(Object.keys(dist).map(d=>[d,{next:paths[d][1]||r,metric:dist[d],path:paths[d]}]));
  }
  function originate(r){seq[r]++;const entry={seq:seq[r],edges:linksFor(r).map(l=>({to:other(l,r),bandwidth:l.bandwidth}))};lsdb[r][r]=entry;setTable(r,dijkstra(r,lsdb[r]));flood(r,r,entry,null);log('control',r,`LSA #${seq[r]} originated · SPF recalculated`);}
  function flood(from,origin,entry,except){for(const l of linksFor(from)){const to=other(l,from);if(!routerSet.has(to)||to===except)continue;transmit(from,to,64+entry.edges.length*12,()=>{if((lsdb[to][origin]?.seq??-1)>=entry.seq)return;lsdb[to][origin]=structuredClone(entry);heap.push(now+0.01,()=>{setTable(to,dijkstra(to,lsdb[to]));flood(to,origin,entry,from);});},true);}}
  function advertise(r,toOnly){for(const l of linksFor(r)){const to=other(l,r);if(!routerSet.has(to)||(toOnly&&to!==toOnly))continue;
    const vector=structuredClone(tables[r]);if(protocol==='RIP')for(const v of Object.values(vector))if(v.next===to)v.metric=16;
    transmit(r,to,protocol==='RIP'?32+20*Object.keys(vector).length:40+32*Object.keys(vector).length,()=>{vectors[to][r]={table:vector,received:now};recompute(to);},true);
  }log('control',r,protocol==='RIP'?'RIPv2 response · poisoned reverse':'EIGRP modeled update · distance vector');}
  function scheduleUpdate(r){if(pending[r])return;pending[r]=true;heap.push(now+(protocol==='RIP'?1+rand()*4:0.03),()=>{pending[r]=false;advertise(r);});}
  function recompute(r,loss=false){let next=direct(r);const candidates={};
    for(const l of linksFor(r)){const n=other(l,r), v=vectors[r][n];if(!routerSet.has(n)||!v||now-v.received>180)continue;
      for(const [dest,route]of Object.entries(v.table)){if(dest===r)continue;if(protocol==='EIGRP'&&route.path.includes(r))continue;
        const bw=Math.min(l.bandwidth,route.bw??Infinity), delay=l.delay+(route.delay||0);
        const metric=protocol==='RIP'?route.metric+1:256*(10000/bw+delay*100);if(protocol==='RIP'&&metric>=16)continue;
        (candidates[dest]??=[]).push({next:n,metric,path:[r,...route.path],bw,delay,rd:route.metric});
      }
    }
    for(const [dest,list]of Object.entries(candidates)){list.sort((a,b)=>a.metric-b.metric||a.next.localeCompare(b.next));const best=list[0];if(!next[dest]||best.metric<next[dest].metric)next[dest]=best;}
    if(protocol==='EIGRP'&&loss){const old=tables[r];for(const [dest,route]of Object.entries(old)){if(route.next===r||findLink(r,route.next))continue;const fs=(candidates[dest]||[]).find(v=>v.rd<route.metric);if(fs){next[dest]=fs;log('control',r,`Feasible successor for ${dest}: ${fs.next} (RD < FD)`);}else{delete next[dest];log('control',r,`ACTIVE ${dest} · modeled query/reply wait`);for(const l of linksFor(r)){const n=other(l,r);if(routerSet.has(n))transmit(r,n,48,()=>{transmit(n,r,48,()=>{},true);},true);}heap.push(now+0.15,()=>{recompute(r);});}}}
    if(setTable(r,next))scheduleUpdate(r);
  }
  for(const r of routers){neighbors[r]={};lsdb[r]={};vectors[r]={};seq[r]=0;tables[r]=direct(r);}
  if(protocol==='OSPF')for(const r of routers)heap.push(0,()=>originate(r));else for(const r of routers)heap.push(0,()=>advertise(r));
  if(protocol==='RIP')for(let time=30;time<c.duration;time+=30)for(const r of routers)heap.push(time+rand()*0.1,()=>advertise(r));
  else if(protocol==='OSPF'||protocol==='EIGRP'){const period=protocol==='OSPF'?10:5;for(let time=period;time<c.duration;time+=period)for(const r of routers)heap.push(time,()=>{for(const l of linksFor(r)){const n=other(l,r);if(routerSet.has(n))transmit(r,n,protocol==='OSPF'?64:40,()=>{},true);}});}
  let beforeFailure=null;
  if(c.failure)heap.push(c.failureAt,()=>{beforeFailure=snapshot();const l=t.links.find(l=>l.id===c.failureLink);l.up=false;log('failure',`${l.a} ↔ ${l.b}`,'Link down · immediate carrier-loss detection');for(const r of [l.a,l.b].filter(x=>routerSet.has(x))){if(protocol==='OSPF')originate(r);else{delete vectors[r][other(l,r)];recompute(r,true);}}});
  function hop(packet,current,ttl){if(packet.done)return;if(current===c.target){packet.status='delivered';packet.arrived=now;packet.done=true;packet.delay=(now-packet.sent)*1000;return;}
    if(ttl<=0){drop(packet,'TTL exceeded');return;}let next;
    if(nodes.get(current).type==='host')next=linksFor(current)[0]&&other(linksFor(current)[0],current);else next=tables[current][c.target]?.next;
    if(!next||next===current){drop(packet,'No route to destination');return;}
    packet.hops.push({from:current,to:next,depart:now});const h=packet.hops.at(-1);
    if(!transmit(current,next,c.size,error=>{h.arrive=now;if(error){drop(packet,error);return;}packet.path.push(next);hop(packet,next,ttl-1);})){drop(packet,findLink(current,next)?'Output queue full':'Next-hop link unavailable');}
  }
  function drop(p,reason){p.status='dropped';p.reason=reason;p.arrived=now;p.done=true;}
  const count=Math.floor(c.duration*c.rate);
  for(let i=0;i<count;i++){const at=(i+rand()*0.6)/c.rate;heap.push(at,()=>{const p={id:i+1,sent:now,status:'in-flight',path:[c.source],hops:[],done:false};packets.push(p);hop(p,c.source,32);});}
  let event;const end=c.duration+5;
  while((event=heap.pop())){if(event.time>end)break;now=event.time;event.fn();if(++processed>2000000)throw Error('Event limit reached. Reduce traffic or topology size.');}
  for(const p of packets)if(!p.done)drop(p,'Run drain timeout');
  const delivered=packets.filter(p=>p.status==='delivered'), delays=delivered.map(p=>p.delay).sort((a,b)=>a-b), total=packets.length;
  const mean=delays.length?delays.reduce((a,b)=>a+b,0)/delays.length:null;
  const jitter=delivered.length>1?delivered.slice(1).reduce((s,p,i)=>s+Math.abs(p.delay-delivered[i].delay),0)/(delivered.length-1):null;
  const initialChanges=changes.filter(e=>!c.failure||e.time<c.failureAt), afterChanges=changes.filter(e=>c.failure&&e.time>=c.failureAt);
  const initialConvergence=initialChanges.at(-1)?.time??0, recovery=c.failure?(afterChanges.at(-1)?.time??c.failureAt)-c.failureAt:null;
  const bins=Array.from({length:Math.ceil(c.duration)},(_,i)=>{const ps=packets.filter(p=>p.sent>=i&&p.sent<i+1),ds=ps.filter(p=>p.status==='delivered');return{time:i,sent:ps.length,delivered:ds.length,loss:ps.length-ds.length,throughput:ds.length*c.size*8/1e6,delay:ds.length?ds.reduce((s,p)=>s+p.delay,0)/ds.length:0};});
  const metrics={sent:total,delivered:delivered.length,lost:total-delivered.length,delivery:total?delivered.length/total*100:0,loss:total?(total-delivered.length)/total*100:0,meanDelay:mean,p95Delay:delays.length?delays[Math.min(delays.length-1,Math.ceil(delays.length*.95)-1)]:null,jitter,throughput:delivered.length*c.size*8/c.duration/1e6,controlBytes,controlMessages,initialConvergence,recovery,routeChanges:changes.length,meanHops:delivered.length?delivered.reduce((s,p)=>s+p.hops.length,0)/delivered.length:null};
  const routes=snapshot();
  return {protocol,config:c,topology:structuredClone(topology),metrics,packets,logs,changes,bins,routes,beforeFailure,processed,model:'educational-v1',failureAt:c.failure?c.failureAt:null};
}
export function scoreRun(run){const m=run.metrics,c=run.config;const delivery=m.delivery,latency=m.meanDelay===null?0:100/(1+m.meanDelay/50),convergence=100/(1+(c.failure?m.recovery:m.initialConvergence)/2),payload=m.delivered*c.size,overhead=payload?100*payload/(payload+m.controlBytes):0;return{delivery,latency,convergence,overhead,total:.4*delivery+.2*latency+.25*convergence+.15*overhead};}
