import test from 'node:test';
import assert from 'node:assert/strict';
import {scores,topologySVG,esc} from '../dist/ui.js';
test('scores distinguish unobserved convergence from zero-second convergence',()=>{
 const base={delivery:100,meanDelay:0,initialConvergence:0,routeConvergence:null,dataBytes:1000,controlBytes:0};
 assert.equal(scores(base,false).total,100);
 assert.equal(scores(base,true).total,75);
});
test('score uses egress data and control bytes at the same boundary',()=>{
 assert.equal(scores({delivery:100,meanDelay:50,initialConvergence:2,dataBytes:900,controlBytes:100},false).overhead,90);
});
test('imported identifiers are escaped in generated SVG',()=>{
 const svg=topologySVG({nodes:[{id:'<unsafe>',type:'router',x:100,y:100}],links:[]});
 assert.ok(!svg.includes('data-node="<unsafe>"'));assert.ok(svg.includes('&lt;unsafe&gt;'));
});
