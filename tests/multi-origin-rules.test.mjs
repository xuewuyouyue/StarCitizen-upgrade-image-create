import test from 'node:test';
import assert from 'node:assert/strict';
import {originIds,resolveOrigins,routeError,originSelectionError,canSelectShip} from '../public/route-rules.js';
const ship=(id,priceUsd=140)=>({id,priceUsd});

test('legacy and multiple origin IDs resolve in order without dropping missing ships',()=>{
  const a=ship('a'),b=ship('b'),ships=[a,b],ids=['b','missing','a'];
  assert.deepEqual(originIds(null),[]);assert.deepEqual(originIds(undefined),[]);
  assert.deepEqual(originIds('a'),['a']);assert.deepEqual(originIds(ids),ids);assert.notEqual(originIds(ids),ids);
  assert.deepEqual(resolveOrigins({from:'a'},ships),[a]);
  assert.deepEqual(resolveOrigins({from:ids},ships),[b,undefined,a]);
  assert.deepEqual(resolveOrigins({from:[null,7]},ships),[undefined,undefined]);
  assert.ok(routeError(resolveOrigins({from:['a','missing']},ships),ship('to',175)));
});

test('one to three equal-priced distinct origins are valid without mutating selections',()=>{
  const a=ship('a'),b=ship('b'),c=ship('c'),to=ship('to',175),origins=Object.freeze([a,b,c]);
  assert.equal(routeError(a,to),'');
  for(let count=1;count<=3;count++)assert.equal(routeError(origins.slice(0,count),to),'');
  assert.deepEqual(origins,[a,b,c]);
  assert.match(routeError([...origins,ship('d')],to),/最多.*3/);
  assert.match(routeError([],to),/选择/);
});

test('multiple origins reject duplicates, mixed prices, missing prices and invalid IDs',()=>{
  const a=ship('a'),to=ship('to',175);
  assert.match(routeError([a,a],to),/重复/);
  assert.match(routeError([a,ship('a')],to),/重复/);
  assert.match(routeError([a,ship('b',140.01)],to),/价格必须相同/);
  for(const price of [null,undefined,NaN,Infinity,-1])assert.ok(routeError([a,{id:'b',priceUsd:price}],to));
  assert.match(routeError([a,undefined],to),/选择/);
  assert.match(routeError([a,ship('to')],to),/同一艘/);
});

test('equal origin values and strict upgrade comparisons use integer cents',()=>{
  assert.equal(routeError([ship('a',0),ship('b',0)],ship('to',.01)),'');
  assert.equal(routeError([ship('a',.3),ship('b',.1+.2)],ship('to',.31)),'');
  assert.match(routeError([ship('a',.3),ship('b',.1+.2)],ship('to',.3)),/严格低于/);
  for(const price of [0,139,140])assert.ok(routeError([ship('a'),ship('b')],ship('to',price)));
  assert.match(routeError([ship('a'),ship('b')],ship('to',null)),/美元价格/);
});

test('adding origins allows an empty endpoint but enforces same price, uniqueness and capacity',()=>{
  const a=ship('a'),b=ship('b'),c=ship('c');
  assert.equal(originSelectionError(a,[],null),'');
  assert.equal(originSelectionError(b,[a],null),'');
  assert.equal(originSelectionError(c,[a,b],ship('to',175)),'');
  assert.match(originSelectionError(ship('d'),[a,b,c],ship('to',175)),/最多.*3/);
  assert.match(originSelectionError(a,[a],null),/重复/);
  assert.match(originSelectionError(ship('d',145),[a],null),/价格必须相同/);
  assert.match(originSelectionError(ship('d',null),[],null),/美元价格/);
  assert.match(originSelectionError(b,[a],ship('to',140)),/严格低于/);
  assert.match(originSelectionError(b,[a],ship('to',null)),/美元价格/);
});

test('endpoint picker validates every selected origin and allows only valid higher-priced candidates',()=>{
  const origins=[ship('a'),ship('b'),ship('c')];
  for(const candidate of [ship('low',100),ship('equal',140),ship('unknown',null),ship('a',175)])assert.equal(canSelectShip('to',candidate,origins),false);
  assert.equal(canSelectShip('to',ship('higher',175),origins),true);
  assert.equal(canSelectShip('to',ship('known',0),[]),true);
  assert.equal(canSelectShip('to',ship('higher',175),[origins[0],undefined]),false);
  assert.equal(canSelectShip('to',ship('higher',175),[origins[0],ship('mixed',145)]),false);
  assert.equal(canSelectShip('to',ship('higher',175),[...origins,ship('d')]),false);
});
