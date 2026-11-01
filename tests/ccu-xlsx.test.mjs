import test from 'node:test';
import assert from 'node:assert/strict';
import {read,utils,write} from '../public/vendor/sheetjs/xlsx.mjs';
import {readUpgradeXlsx} from '../public/ccu-xlsx.js';
import {matchUpgradeRows} from '../public/ccu-csv.js';
import {LocalZip} from '../public/local-zip.js';

const headers=['起始船(英)','起始船(中)','终点船(英)','终点船(中)','节约($)'];
const ships=[{id:'a',en:'Ballista',name:'弩炮',priceUsd:140},{id:'b',en:'Gladiator',name:'角斗士',priceUsd:165},{id:'c',en:'Fortune',name:'财富',priceUsd:175}];
const dataRow=(saving=0)=>['Ballista','弩炮','Fortune','财富',saving];
function workbook(rows,{sheetName='Upgrade Report',secondSheet}={}){
  const book=utils.book_new();utils.book_append_sheet(book,utils.aoa_to_sheet(rows),sheetName);
  if(secondSheet)utils.book_append_sheet(book,utils.aoa_to_sheet(secondSheet),'Ignored');
  return write(book,{type:'array',bookType:'xlsx',compression:true});
}
const report=(rows,options)=>workbook([['星河避难所升级列表'],headers,...rows],options);
const matched=(buffer,catalog=ships,choices={})=>matchUpgradeRows(readUpgradeXlsx(buffer),catalog,choices,{allowChinese:true});

async function workbookWithoutDimensions(){
  const zip=new LocalZip(),xml=new Map([
    ['[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml','<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>']
  ]);
  const textCell=(address,text)=>`<c r="${address}" t="inlineStr"><is><t>${text}</t></is></c>`;
  xml.set('xl/worksheets/sheet1.xml','<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+
    '<row r="1">'+textCell('A1','星河避难所升级列表')+'</row>'+
    '<row r="2">'+headers.map((name,index)=>textCell(String.fromCharCode(65+index)+'2',name)).join('')+'</row>'+
    '<row r="3">'+textCell('A3','Ballista')+textCell('C3','Fortune')+'<c r="E3"><v>0</v></c></row>'+
    '<row r="7">'+textCell('B7','弩炮')+textCell('D7','财富')+'<c r="E7"><v>15</v></c></row>'+
    '</sheetData></worksheet>');
  for(const [name,content] of xml)await zip.add(name,new Blob([content]));
  return zip.finish().arrayBuffer();
}

test('XLSX reads second-row report headers, prioritizes English names and ignores other fields/sheets',()=>{
  const rows=[['导出标题，不是表头'],['数量','终点船(中)','节约($)','起始船(英)','终点船(英)','起始船(中)','其他字段'],[999,'故意不同',0,'Ballista','Fortune','故意不同','ignored']];
  const buffer=workbook(rows,{secondSheet:[['from','to','saving'],['ignored','ignored',999]]});
  assert.deepEqual(readUpgradeXlsx(buffer),[{rowNumber:3,fromName:'Ballista',toName:'Fortune',rawSaving:0}]);
  const [entry]=matched(buffer);
  assert.equal(entry.fromId,'a');assert.equal(entry.toId,'c');assert.equal(entry.saving,0);assert.equal(entry.type,'CCU');assert.equal(entry.error,'');
});

test('XLSX classifies numeric zero and every finite nonzero saving without expanding count',()=>{
  const entries=matched(report([dataRow(0),dataRow(10),dataRow(-5),dataRow(0.25),dataRow('0.00'),dataRow('1e2')]));
  assert.deepEqual(entries.map(entry=>[entry.saving,entry.type]),[[0,'CCU'],[10,'WBCCU'],[-5,'WBCCU'],[0.25,'WBCCU'],[0,'CCU'],[100,'WBCCU']]);
  assert.ok(entries.every(entry=>entry.error===''));
});

test('XLSX falls back to Chinese for absent, empty and whitespace English values',()=>{
  const rows=[[null,'弩炮',undefined,'财富',0],['','弩炮','','财富',10],['   ','弩炮','\t','财富',15],['Ballista','错误中文','Fortune','错误中文',20]];
  const records=readUpgradeXlsx(report(rows)),entries=matched(report(rows));
  assert.deepEqual(records.map(row=>[row.fromName,row.toName]),[['弩炮','财富'],['弩炮','财富'],['弩炮','财富'],['Ballista','Fortune']]);
  assert.ok(entries.every(entry=>entry.fromId==='a'&&entry.toId==='c'&&entry.error===''));
});

test('XLSX supports Chinese-only and generic report headers plus normalized full-width punctuation',()=>{
  for(const rowHeaders of [['起始船(中)','终点船(中)','节约($)'],['起始船','终点船','节约'],[' 起始船（中） ',' 终点船（中） ',' 节约（＄） ']]){
    const [entry]=matched(workbook([['标题'],rowHeaders,['弩炮','财富',0]]));
    assert.equal(entry.error,'');assert.equal(entry.type,'CCU');assert.equal(entry.fromId,'a');assert.equal(entry.toId,'c');
  }
});

test('XLSX retains physical row numbers and repeated records while skipping blank rows',()=>{
  const buffer=report([dataRow(0),[],['   ',null,'\t'],dataRow(10),dataRow(10)]),records=readUpgradeXlsx(buffer);
  assert.deepEqual(records.map(row=>row.rowNumber),[3,6,7]);
  assert.deepEqual(records[1],{rowNumber:6,fromName:'Ballista',toName:'Fortune',rawSaving:10});
  assert.equal(records.length,3);assert.ok(matched(buffer).every(entry=>entry.error===''));
});

test('XLSX reads cell coordinates when worksheet XML omits dimensions',async()=>{
  const buffer=await workbookWithoutDimensions();
  assert.deepEqual(readUpgradeXlsx(buffer),[{rowNumber:3,fromName:'Ballista',toName:'Fortune',rawSaving:0},{rowNumber:7,fromName:'弩炮',toName:'财富',rawSaving:15}]);
  assert.ok(matched(buffer).every(entry=>entry.error===''));
});

test('XLSX rejects invalid archives, missing second-row headers and duplicate relevant headers',()=>{
  for(const buffer of [new ArrayBuffer(0),new TextEncoder().encode('from,to,saving\nBallista,Fortune,0'),new Uint8Array([0x50,0x4b,0,0])])assert.throws(()=>readUpgradeXlsx(buffer),/XLSX/);
  for(const rows of [[],[['标题']],[headers,dataRow(0)],[['标题'],['起始船(英)','终点船(英)'],['Ballista','Fortune']],[['标题'],['起始船(英)','节约($)'],['Ballista',0]]])assert.throws(()=>readUpgradeXlsx(workbook(rows)),/第二行.*必需列/);
  for(const duplicated of ['起始船(英)','终点船(英)','节约($)','起始船(中)','终点船(中)']){
    const rowHeaders=[...headers,duplicated];
    assert.throws(()=>readUpgradeXlsx(workbook([['标题'],rowHeaders,[...dataRow(0),'duplicate']])),/第二行表头重复/);
  }
});

test('XLSX missing, blank, boolean and invalid saving remain row errors rather than ordinary CCU',()=>{
  const entries=matched(report([dataRow(undefined).slice(0,4),dataRow(null),dataRow(''),dataRow('   '),dataRow(false),dataRow('NaN'),dataRow('Infinity'),dataRow('0x10')]));
  assert.equal(entries.length,8);
  for(const entry of entries){assert.match(entry.error,/saving/);assert.equal(entry.saving,null);assert.equal(entry.type,'');}
  const book=read(report([dataRow(0)]),{type:'array'}),sheet=book.Sheets[book.SheetNames[0]];
  sheet.E3={t:'e',v:7};
  const [errorCell]=matched(write(book,{type:'array',bookType:'xlsx'}));
  assert.match(errorCell.error,/saving/);assert.equal(errorCell.type,'');
});

test('XLSX name matching and explicit ambiguity choices cannot bypass saving or route validation',()=>{
  const catalog=[...ships,{id:'a-demo',en:'Ballista',name:'弩炮样例',priceUsd:140}],buffer=report([dataRow(0),dataRow(null)]);
  const ambiguous=matched(buffer,catalog);
  assert.match(ambiguous[0].error,/歧义/);assert.equal(ambiguous[0].fromOptions.length,2);
  const selected=matched(buffer,catalog,{'3:from':'a-demo','4:from':'a'});
  assert.equal(selected[0].error,'');assert.equal(selected[0].fromId,'a-demo');assert.match(selected[1].error,/saving/);
  assert.match(matched(buffer,catalog,{'3:from':'c'})[0].error,/选择无效/);
  for(const price of [140,130,null])assert.match(matched(report([dataRow(0)]),[ships[0],{...ships[2],priceUsd:price}])[0].error,/价格/);
  const [same]=matched(report([['Ballista','弩炮','Ballista','弩炮',0]]));assert.match(same.error,/同一/);
  const [missing]=matched(report([['Unknown','弩炮','Fortune','财富',0]]));assert.match(missing.error,/未匹配/);
});

test('XLSX permits exactly 5000 report rows and rejects 5001 before exposing truncated data',()=>{
  const rows=Array.from({length:5000},()=>dataRow(0)),buffer=report(rows),records=readUpgradeXlsx(buffer);
  assert.equal(records.length,5000);assert.equal(records.at(-1).rowNumber,5002);
  assert.throws(()=>readUpgradeXlsx(report([...rows,dataRow(0)])),/最多读取 5000 行/);
  assert.throws(()=>readUpgradeXlsx(report([...rows,...Array.from({length:20},()=>dataRow(0))])),/最多读取 5000 行/);
});
