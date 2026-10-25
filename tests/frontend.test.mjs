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
