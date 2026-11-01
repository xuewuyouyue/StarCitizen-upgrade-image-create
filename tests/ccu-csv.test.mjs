import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUpgradeCsv,matchUpgradeRows} from '../public/ccu-csv.js';

const ship=(id,en,priceUsd,name=en)=>({id,en,priceUsd,name});
const ships=[ship('a','Ballista',140,'弩炮'),ship('b','Gladiator',165,'角斗士'),ship('c','Fortune',175,'财富')];

test('CSV reads only required columns and classifies zero, positive and negative saving',()=>{
  const text='\uFEFF"count"," FROM ","To","insurance","saving","title"\r\n4,"Ballista","Gladiator",120,0,"ignored"\r\n1,Ballista,Fortune,,10,title\r\n9,Ballista,Fortune,,-2.5,title\r\n';
  const entries=parseUpgradeCsv(text,ships);
  assert.equal(entries.length,3);
  assert.deepEqual(entries.map(entry=>[entry.rowNumber,entry.fromId,entry.toId,entry.saving,entry.type,entry.error]),[[2,'a','b',0,'CCU',''],[3,'a','c',10,'WBCCU',''],[4,'a','c',-2.5,'WBCCU','']]);
  assert.equal(entries[0].fromName,'Ballista');assert.equal(entries[0].toName,'Gladiator');
});

test('CSV handles quoted commas, escaped quotes, multiline fields and physical row numbers',()=>{
  const text='from,to,saving,title\r\nBallista,Gladiator,0,"a, b and ""quotes""\r\nnext line"\r\n\r\nBallista,Fortune,1,done';
  const entries=parseUpgradeCsv(text,ships);
  assert.deepEqual(entries.map(entry=>entry.rowNumber),[2,5]);
  assert.ok(entries.every(entry=>entry.error===''));
  const named=[ship('x','Ship, "One"',10),ship('y','Ship Two',20)];
  assert.equal(parseUpgradeCsv('from,to,saving\n"Ship, ""One""",Ship Two,0',named)[0].fromId,'x');
});

test('CSV rejects missing or duplicate required headers and malformed quotes',()=>{
  for(const text of ['', 'from,to\na,b', 'from,to,saving, FROM\na,b,0,a'])assert.throws(()=>parseUpgradeCsv(text,ships),/表头|必需列/);
  for(const text of ['from,to,saving\n"Ballista,Fortune,0','from,to,saving\nBall"ista,Fortune,0','from,to,saving\n"Ballista"x,Fortune,0','from,to,saving\n"Ballista" ,Fortune,0'])assert.throws(()=>parseUpgradeCsv(text,ships),/引号/);
});

test('CSV rejects missing and non-decimal or non-finite saving without treating blanks as zero',()=>{
  for(const value of ['', ' ', 'NaN', 'Infinity', '-Infinity', 'hello', '0x10', '1e999']){
    const entry=parseUpgradeCsv(`from,to,saving\nBallista,Fortune,${value}`,ships)[0];
    assert.match(entry.error,/saving/);assert.equal(entry.saving,null);assert.equal(entry.type,'');
  }
  assert.match(parseUpgradeCsv('from,to,saving\nBallista,Fortune',ships)[0].error,/saving/);
  for(const value of ['-0','0.00','+0','0e3'])assert.equal(parseUpgradeCsv(`from,to,saving\nBallista,Fortune,${value}`,ships)[0].type,'CCU');
  assert.equal(parseUpgradeCsv('from,to,saving\nBallista,Fortune,1e2',ships)[0].saving,100);
});

test('CSV name matching normalizes case, spacing, width and common typographic punctuation',()=>{
  const named=[ship('x',"F7C-M O'Brien",10),ship('y','Ship "Two"',20)];
  const entry=parseUpgradeCsv('from,to,saving\n"  Ｆ７Ｃ–Ｍ   O’Brien ","SHIP “Two”",0',named)[0];
  assert.equal(entry.error,'');assert.equal(entry.fromId,'x');assert.equal(entry.toId,'y');
  assert.equal(parseUpgradeCsv('from,to,saving\nBallista,Fortune,0',[...ships.map(s=>({...s,en:''}))])[0].fromId,null);
  assert.equal(parseUpgradeCsv('from,to,saving\nBallista,Fortune,0',ships.map(s=>({...s,en:'',name:s.en})))[0].error,'');
});

test('CSV reports unmatched and ambiguous names but repeated records with one ID are unambiguous',()=>{
  assert.match(parseUpgradeCsv('from,to,saving\nBallista,Fortune,0',[...ships,ship('other','BALLISTA',140)])[0].error,/歧义/);
  assert.equal(parseUpgradeCsv('from,to,saving\nBallista,Fortune,0',[...ships,ships[0]])[0].error,'');
  assert.match(parseUpgradeCsv('from,to,saving\nBllista,Fortune,0',ships)[0].error,/未匹配/);
  assert.match(parseUpgradeCsv('from,to,saving\n,Fortune,0',ships)[0].error,/起点舰船名称为空/);
  assert.match(parseUpgradeCsv('from,to,saving\nBallista,,0',ships)[0].error,/终点舰船名称为空/);
});

test('CSV applies strict upgrade route validation using catalog prices',()=>{
  for(const [from,to] of [[140,140],[175,140],[null,175],[140,null],[NaN,175],[140,Infinity]]){
    const entry=parseUpgradeCsv('from,to,saving\nBallista,Fortune,0',[ship('a','Ballista',from),ship('c','Fortune',to)])[0];
    assert.match(entry.error,/价格/);
  }
  assert.match(parseUpgradeCsv('from,to,saving\nBallista,Ballista,0',ships)[0].error,/同一/);
  assert.equal(parseUpgradeCsv('from,to,saving\nBallista,Fortune,0',ships)[0].error,'');
});

test('CSV keeps repeated routes as one entry per record, ignores count and never mutates catalog',()=>{
  const catalog=Object.freeze(ships.map(s=>Object.freeze({...s}))),text='"count","from","to","insurance","fromMsrp","toMsrp","pledge","saving","isGiftableCount","isMeltableCount","isGiftedCount","isBuyback","title","accounts","tags"\n4,"Ballista","Gladiator","120",1,999,10,15,4,4,0,false,"Upgrade - Ballista to Gladiator Warbond Edition","ignored",""\n8,"Ballista","Gladiator",,1,999,10,15,8,8,0,false,"ignored","ignored",""';
  const entries=parseUpgradeCsv(text,catalog);
  assert.equal(entries.length,2);assert.deepEqual(entries.map(entry=>entry.rowNumber),[2,3]);
  assert.ok(entries.every(entry=>entry.fromId==='a'&&entry.toId==='b'&&entry.type==='WBCCU'&&entry.error===''));
});

test('CSV skips blank lines but retains incomplete comma records as errors',()=>{
  const entries=parseUpgradeCsv('\nfrom,to,saving\n\n   \n,,\nBallista,Fortune,0\n',ships);
  assert.equal(entries.length,2);assert.equal(entries[0].rowNumber,5);assert.ok(entries[0].error);assert.equal(entries[1].rowNumber,6);
});

test('CSV exposes ambiguous candidates and accepts an explicit matching choice for each side',()=>{
  const catalog=[...ships,ship('a-demo','BALLISTA',140,'弩炮 · 示例'),ship('c-demo','fortune',175,'财富 · 示例')],csv='from,to,saving\nBallista,Fortune,0';
  const unresolved=parseUpgradeCsv(csv,catalog)[0];
  assert.match(unresolved.error,/歧义/);
  assert.deepEqual(unresolved.fromOptions,[{id:'a',name:'弩炮',priceUsd:140},{id:'a-demo',name:'弩炮 · 示例',priceUsd:140}]);
  assert.deepEqual(unresolved.toOptions,[{id:'c',name:'财富',priceUsd:175},{id:'c-demo',name:'财富 · 示例',priceUsd:175}]);
  const selected=parseUpgradeCsv(csv,catalog,{'2:from':'a-demo','2:to':'c'})[0];
  assert.equal(selected.error,'');assert.equal(selected.fromId,'a-demo');assert.equal(selected.toId,'c');
  assert.deepEqual(selected.fromOptions,unresolved.fromOptions);assert.deepEqual(selected.toOptions,unresolved.toOptions);
  const single=parseUpgradeCsv(csv,ships,{'2:from':'a','2:to':'c'})[0];
  assert.equal(single.error,'');assert.deepEqual(single.fromOptions,[]);assert.deepEqual(single.toOptions,[]);
});

test('CSV refuses unrelated, missing and stale choices rather than overriding English matching',()=>{
  const catalog=[...ships,ship('a-demo','Ballista',140,'弩炮 · 示例')],csv='from,to,saving\nBallista,Fortune,0';
  for(const id of ['b','missing','',null]){
    const entry=parseUpgradeCsv(csv,catalog,{'2:from':id})[0];
    assert.match(entry.error,/起点舰船选择无效/);assert.equal(entry.fromId,null);assert.equal(entry.fromOptions.length,2);
  }
  assert.match(parseUpgradeCsv(csv,catalog,{'2:to':'a'})[0].error,/终点舰船选择无效/);
  assert.match(parseUpgradeCsv('from,to,saving\nNot Ballista,Fortune,0',catalog,{'2:from':'a'})[0].error,/未匹配/);
  assert.match(parseUpgradeCsv(csv,catalog,{'3:from':'a'})[0].error,/歧义/);
});

test('CSV choices cannot bypass saving or strict price validation',()=>{
  const catalog=[...ships,ship('a-expensive','Ballista',200,'高价弩炮')];
  const invalidSaving=parseUpgradeCsv('from,to,saving\nBallista,Fortune,',catalog,{'2:from':'a'})[0];
  assert.equal(invalidSaving.fromId,'a');assert.match(invalidSaving.error,/saving/);
  const invalidPrice=parseUpgradeCsv('from,to,saving\nBallista,Fortune,10',catalog,{'2:from':'a-expensive'})[0];
  assert.equal(invalidPrice.fromId,'a-expensive');assert.match(invalidPrice.error,/起点价格必须严格低于终点/);
});

test('shared record matching preserves source rows and accepts typed numeric savings',()=>{
  const records=[{rowNumber:2,fromName:' Ballista ',toName:'Gladiator',rawSaving:0},{rowNumber:7,fromName:'Ballista',toName:'Fortune',rawSaving:-2.5}];
  const entries=matchUpgradeRows(records,ships);
  assert.deepEqual(entries.map(entry=>[entry.rowNumber,entry.fromId,entry.toId,entry.saving,entry.type,entry.error]),[[2,'a','b',0,'CCU',''],[7,'a','c',-2.5,'WBCCU','']]);
  assert.deepEqual(matchUpgradeRows([records[0]],ships),parseUpgradeCsv('from,to,saving\n Ballista ,Gladiator,0',ships));
  assert.equal(records[0].fromName,' Ballista ');
});

test('shared matching accepts exact Chinese and English aliases only when explicitly enabled',()=>{
  const records=[{rowNumber:3,fromName:' 弩炮 ',toName:'Ｆｏｒｔｕｎｅ',rawSaving:0},{rowNumber:4,fromName:'Ballista',toName:'财富',rawSaving:10}];
  assert.ok(matchUpgradeRows(records,ships).every(entry=>/未匹配/.test(entry.error)));
  assert.ok(matchUpgradeRows(records,ships,{},{allowChinese:true}).every(entry=>entry.error===''));
  assert.match(parseUpgradeCsv('from,to,saving\n弩炮,财富,0',ships)[0].error,/未匹配/);
  assert.match(matchUpgradeRows([{...records[0],fromName:'弩 炮'}],ships,{},{allowChinese:true})[0].error,/未匹配/);
});

test('shared aliases deduplicate IDs and preserve ambiguity choices across both languages',()=>{
  const sameAlias=[ship('a','Ballista',140,'BALLISTA'),ship('c','Fortune',175,'Fortune')],record={rowNumber:8,fromName:'Ballista',toName:'Fortune',rawSaving:0};
  const single=matchUpgradeRows([record],sameAlias,{},{allowChinese:true})[0];
  assert.equal(single.error,'');assert.deepEqual(single.fromOptions,[]);assert.deepEqual(single.toOptions,[]);
  const catalog=[...ships,ship('a-demo','Demo Ballista',140,'弩炮')],chinese={...record,fromName:'弩炮',toName:'财富'};
  const ambiguous=matchUpgradeRows([chinese],catalog,{},{allowChinese:true})[0];
  assert.match(ambiguous.error,/歧义/);assert.equal(ambiguous.fromOptions.length,2);
  const selected=matchUpgradeRows([chinese],catalog,{'8:from':'a-demo'},{allowChinese:true})[0];
  assert.equal(selected.error,'');assert.equal(selected.fromId,'a-demo');assert.deepEqual(selected.fromOptions,ambiguous.fromOptions);
  assert.match(matchUpgradeRows([chinese],catalog,{'8:from':'c'},{allowChinese:true})[0].error,/选择无效/);
});

test('shared matching never coerces absent, empty or boolean saving to zero',()=>{
  for(const rawSaving of [undefined,null,'','   ',false]){
    const entry=matchUpgradeRows([{rowNumber:5,fromName:'弩炮',toName:'财富',rawSaving}],ships,{},{allowChinese:true})[0];
    assert.match(entry.error,/saving/);assert.equal(entry.saving,null);assert.equal(entry.type,'');
  }
});
