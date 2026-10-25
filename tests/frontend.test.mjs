import test from "node:test";
import assert from "node:assert/strict";
import { scores, topologySVG, esc } from "../dist/ui.js";
test("scores distinguish unobserved convergence from zero-second convergence", () => {
  const base = {
    delivery: 100,
    meanDelay: 0,
    initialConvergence: 0,
    routeConvergence: null,
    dataBytes: 1000,
    controlBytes: 0,
  };
  assert.equal(scores(base, false).total, 100);
  assert.equal(scores(base, true).total, 75);
});
test("score uses egress data and control bytes at the same boundary", () => {
  assert.equal(
    scores(
      {
        delivery: 100,
        meanDelay: 50,
        initialConvergence: 2,
        dataBytes: 900,
        controlBytes: 100,
      },
      false,
    ).overhead,
    90,
  );
});
test("imported identifiers are escaped in generated SVG", () => {
  const svg = topologySVG({
    nodes: [{ id: "<unsafe>", type: "router", x: 100, y: 100 }],
    links: [],
  });
  assert.ok(!svg.includes('data-node="<unsafe>"'));
  assert.ok(svg.includes("&lt;unsafe&gt;"));
});

import { simulationFinished, progressCopy, devicePosition } from "../dist/workflow.js";
test("guided navigation only finishes the job started here with a new completed result", () => {
  const pending = {job: "mine", before: ["old"]};
  const snap = {job:"mine", busy:false, phase:"ready", results:[{id:"old",status:"completed"},{id:"new",status:"completed"}]};
  assert.equal(simulationFinished(pending,snap), true);
  for (const change of [{job:"other"},{busy:true},{phase:"cancelled"},{error:"Failed"},{results:[{id:"old",status:"completed"},{id:"new",status:"cancelled"}]}])
    assert.equal(simulationFinished(pending,{...snap,...change}), false);
  assert.equal(simulationFinished(null,snap), false);
});
test("progress describes route learning and a failed link without inventing completion", () => {
  assert.match(progressCopy({phase:"converging", message:"OSPF: startup 4s"}).title,/OSPF/);
  assert.match(progressCopy({phase:"running",lab:{protocol:"RIP"},live:{failure:0}}).detail,/link is down/);
  assert.match(progressCopy({phase:"running",live:{failure:null}}).detail,/UDP/);
});
test("device drops stay within the editable canvas and tracing has no editable ports", () => {
  assert.deepEqual(devicePosition(-200,900),{x:42,y:545});
  const top={nodes:[{id:"R1",type:"router",x:200,y:100}],links:[]};
  assert.match(topologySVG(top),/data-port="R1"/);
  assert.ok(!topologySVG(top,{editable:false}).includes('data-port='));
});

import { routingPopover } from "../dist/routing.js";
test("router popup uses the selected run's own native protocol table", () => {
  const base = {trial:1,topology:{nodes:[{id:"R1",type:"router"}]},routes:{R1:[]}};
  const ospf = {...base,protocol:"OSPF",routingTables:{R1:{protocol:"OSPF",text:"O 10.0.9.0/30 [110/150] via 10.0.2.2"}}};
  const rip = {...base,protocol:"RIP",routingTables:{R1:{protocol:"RIP",text:"R 10.0.9.0/30 [120/3] via 10.0.4.2"}}};
  assert.match(routingPopover(ospf,"R1"),/110\/150/);
  assert.ok(!routingPopover(rip,"R1").includes("110/150"));
  assert.match(routingPopover(rip,"R1"),/120\/3/);
  assert.match(routingPopover(ospf,"R1"),/end of the selected run/);
});
test("old snapshots never present Linux route priority as the protocol metric", () => {
  const run = {protocol:"OSPF",trial:1,topology:{nodes:[{id:"R1",type:"router"}]},routes:{R1:[{dst:"10.0.9.0/30",metric:20,protocol:"ospf",nexthops:[{gateway:"10.0.2.2",dev:"a2"},{gateway:"10.0.4.2",dev:"a4"}]}]}};
  const html = routingPopover(run,"R1");
  assert.match(html,/Linux route priority is not the OSPF metric/);
  assert.match(html,/10.0.2.2/);
  assert.match(html,/10.0.4.2/);
  assert.ok(!html.includes('<td>20</td>'));
  run.routingTables={R1:{protocol:"RIP",text:"wrong protocol"}};
  assert.ok(!routingPopover(run,"R1").includes("wrong protocol"));
});
test("router popup escapes recorded output and is unavailable on hosts", () => {
  const run={protocol:"EIGRP",trial:1,topology:{nodes:[{id:"R1",type:"router"},{id:"PC1",type:"host"}]},routingTables:{R1:{protocol:"EIGRP",text:'<script>alert("x")</script>'}}};
  assert.ok(!routingPopover(run,"R1").includes("<script>"));
  assert.match(routingPopover(run,"R1"),/&lt;script&gt;/);
  assert.equal(routingPopover(run,"PC1"),"");
});
