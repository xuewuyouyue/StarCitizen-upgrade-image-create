import test from 'node:test';
import assert from 'node:assert/strict';
import {hasPrice,routeError,canSelectShip,sortPickerShips} from '../public/route-rules.js';
import {render} from '../public/renderer.js';
const ship=(id,priceUsd)=>({id,priceUsd});

test('upgrade requires known prices and strictly increasing integer cents',()=>{
  assert.equal(routeError(ship('a',140),ship('b',175)),'');
  for(const [from,to] of [[140,140],[175,140],[null,175],[140,null],[undefined,175],[NaN,175],[140,Infinity],[-1,175]])assert.ok(routeError(ship('a',from),ship('b',to)));
  assert.equal(routeError(ship('a',0),ship('b',0.01)),'');
  assert.ok(routeError(ship('a',0),ship('b',0)));
  assert.ok(routeError(ship('same',140),ship('same',175)));
  assert.ok(routeError(ship('a',0.3),ship('b',0.1+0.2)));
  assert.equal(hasPrice(ship('a',null)),false);assert.equal(hasPrice(ship('a',0)),true);
  assert.ok(routeError(null,ship('b',175)));
});
test('picker filters both directions, equality, unknown price and first selection',()=>{
  const ships=[ship('zero',0),ship('low',140),ship('equal-1',175),ship('equal-2',175),ship('high',250),ship('unknown',null)];
  assert.deepEqual(ships.filter(s=>canSelectShip('from',s,ship('to',175))).map(s=>s.id),['zero','low']);
  assert.deepEqual(ships.filter(s=>canSelectShip('to',s,ship('from',175))).map(s=>s.id),['high']);
  assert.equal(ships.filter(s=>canSelectShip('from',s,null)).length,5);
  assert.equal(canSelectShip('from',ship('known',140),ship('old-unknown',null)),true);
  assert.equal(canSelectShip('to',ship('unknown',null),null),false);
  assert.equal(canSelectShip('to',ship('same',175),ship('same',175)),false);
});
test('renderer rejects invalid routes before accessing canvas or images',async()=>{
  for(const [from,to] of [[175,175],[250,175],[null,175],[140,null]])await assert.rejects(render(null,{from:'a',to:'b'},[ship('a',from),ship('b',to)]),/价格|低于/);
});
test('picker price ordering preserves default order, equal-price ties, zero and cents',()=>{
  const ships=Object.freeze([ship('high',175.25),ship('same-first',140),ship('zero',0),ship('same-second',140),ship('cent',0.01)]),ids=items=>items.map(s=>s.id);
  assert.deepEqual(ids(sortPickerShips(ships,'price-asc')),['zero','cent','same-first','same-second','high']);
  assert.deepEqual(ids(sortPickerShips(ships,'price-desc')),['high','same-first','same-second','cent','zero']);
  assert.deepEqual(ids(sortPickerShips(ships,'default')),['high','same-first','zero','same-second','cent']);
  assert.deepEqual(ids(ships),['high','same-first','zero','same-second','cent']);
});
test('sorting both picker directions preserves search results and strict upgrade filtering',()=>{
  const ships=[ship('high',250),ship('equal',175),ship('low',140),ship('zero',0),ship('unknown',null),ship('middle',200)];
  for(const order of ['default','price-asc','price-desc']){
    const from=sortPickerShips(ships.filter(s=>canSelectShip('from',s,ship('to',175))),order),to=sortPickerShips(ships.filter(s=>canSelectShip('to',s,ship('from',175))),order);
    assert.deepEqual(new Set(from.map(s=>s.id)),new Set(['low','zero']));assert.deepEqual(new Set(to.map(s=>s.id)),new Set(['high','middle']));
    for(const candidate of from)assert.equal(routeError(candidate,ship('to',175)),'');for(const candidate of to)assert.equal(routeError(ship('from',175),candidate),'');
    assert.deepEqual(sortPickerShips(ships.filter(s=>s.id==='middle'&&canSelectShip('to',s,ship('from',175))),order).map(s=>s.id),['middle']);
  }
  assert.deepEqual(sortPickerShips([],'price-asc'),[]);
});
