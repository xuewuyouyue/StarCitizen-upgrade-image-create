import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import {crc32} from 'node:zlib';
import {IDBFactory} from 'fake-indexeddb';
if(!process.env.EDGE_TEST_DIR)throw new Error('Run through npm run test:edge so tests use a fresh extension build');
const root=resolve(process.env.EDGE_TEST_DIR);
const module=path=>import(pathToFileURL(resolve(root,path)).href);
const {createOfflineApi}=await module('offline-store.js');
const {parseUpgradeCsv,matchUpgradeRows}=await module('ccu-csv.js');
const {readUpgradeXlsx}=await module('ccu-xlsx.js');
const {utils,write}=await module('vendor/sheetjs/xlsx.mjs');
const {routeError,canSelectShip,sortPickerShips}=await module('route-rules.js');
const {LocalZip}=await module('local-zip.js');
const source=path=>readFile(resolve(root,path),'utf8');
const manifest=JSON.parse(await source('manifest.json'));
const catalog=JSON.parse(await source('assets/ships/catalog.json'));
const ships=[{id:'a',name:'弩炮',en:'Ballista',priceUsd:140},{id:'b',name:'角斗士',en:'Gladiator',priceUsd:165},{id:'c',name:'财富',en:'Fortune',priceUsd:175}];
test('扩展整棵资源树仅根目录包含一个 manifest.json，避免商店将图库误认作扩展',async()=>{
  const found=[];
  async function walk(directory,prefix=''){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const path=prefix+entry.name;
      if(entry.isDirectory())await walk(resolve(directory,entry.name),path+'/');
      else if(entry.name.toLowerCase()==='manifest.json')found.push(path);
    }
  }
  await walk(root);
  assert.deepEqual(found.sort(),['manifest.json']);
});
async function localFile(path,base=root){
  assert.equal(typeof path,'string');assert.doesNotMatch(path,/^[a-z][a-z\d+.-]*:|^\/\//i);
  const target=path.startsWith('/')?resolve(root,path.slice(1)):resolve(base,path);
  const rel=relative(root,target);assert.ok(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../')&&!rel.startsWith('..\\'),`资源越出扩展目录：${path}`);
  assert.ok((await stat(target)).isFile(),`缺少资源：${path}`);return target;
}

test('点击扩展图标每次都创建一个指向内置生成器的新标签页',async()=>{
  const listeners=[],created=[],requested=[];
  const chrome={action:{onClicked:{addListener:listener=>listeners.push(listener)}},runtime:{getURL:path=>{requested.push(path);return 'chrome-extension://offline-test/'+path;}},tabs:{create:options=>created.push(options)}};
  runInNewContext(await source('background.js'),{chrome});
  assert.equal(listeners.length,1);assert.equal(created.length,0);
  listeners[0]({id:1});listeners[0]({id:2});
  assert.deepEqual(requested,['index.html','index.html']);
  assert.deepEqual(created.map(value=>value.url),['chrome-extension://offline-test/index.html','chrome-extension://offline-test/index.html']);
});

test('Manifest V3 仅请求离线存储权限，不注入网页或访问远程主机',()=>{
  assert.equal(manifest.manifest_version,3);assert.deepEqual(manifest.permissions,['unlimitedStorage']);
  for(const field of ['host_permissions','optional_host_permissions','optional_permissions','content_scripts','externally_connectable','web_accessible_resources','update_url'])assert.equal(manifest[field],undefined,field);
  assert.equal(manifest.action.default_popup,undefined);
  const csp=manifest.content_security_policy.extension_pages;
  for(const directive of ["default-src 'self'","script-src 'self'","connect-src 'self'","object-src 'none'"])assert.ok(csp.split(';').map(value=>value.trim()).includes(directive));
  assert.doesNotMatch(csp,/unsafe-eval|unsafe-inline|https?:|\*/);
});

test('后台、图标与 HTML 运行资源均已打包，脚本没有内联事件或远程来源',async()=>{
  await localFile(manifest.background.service_worker);
  for(const [size,path] of Object.entries({...manifest.icons,...manifest.action.default_icon})){
    const bytes=await readFile(await localFile(path));assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16),Number(size));assert.equal(bytes.readUInt32BE(20),Number(size));
  }
  const html=await source('index.html');assert.doesNotMatch(html,/<[^>]+\son\w+\s*=/i);
  const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];assert.ok(scripts.length);
  for(const [,attributes,body] of scripts){const src=/\bsrc\s*=\s*["']([^"']+)["']/i.exec(attributes);assert.ok(src,'脚本必须通过本地 src 引入');assert.equal(body.trim(),'');await localFile(src[1]);}
  for(const [,path] of html.matchAll(/<(?:img|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi))await localFile(path);
});

test('自身 ES 模块依赖和 Canvas 使用的图像均能在扩展根目录解析',async()=>{
  const files=(await readdir(root)).filter(name=>name.endsWith('.js'));let imports=0;
  for(const name of files){
    const js=await source(name);
    for(const match of js.matchAll(/\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)){
      await localFile(match[1]||match[2],dirname(resolve(root,name)));imports++;
    }
    for(const [,path] of js.matchAll(/\bfile\s*:\s*["']([^"']+\.(?:png|svg))["']/g))await localFile('/assets/'+path);
  }
  assert.ok(imports>=10);
});

test('离线界面只使用本机图库与配置 API，不包含登录、授权或统计服务',async()=>{
  const app=await source('app.js'),html=await source('index.html');
  assert.match(app,/from ['"]\.\/offline-store\.js['"]/);
  assert.doesNotMatch(app,/\/api\/(?:auth|accounts|users|session|feedback)|\bisAdmin\b|\brequireRole\b|\bcurrentUser\b/i);
  assert.doesNotMatch(html,/id=["'](?:login|logout|register|account-dialog|owner-panel|feedback-dialog)["']/i);
  for(const name of (await readdir(root)).filter(name=>name.endsWith('.js'))){
    const js=await source(name);assert.doesNotMatch(js,/\b(?:XMLHttpRequest|WebSocket|EventSource)\b|\bsendBeacon\s*\(|google-analytics|googletagmanager|sentry\.io|telemetry/i,name);
    if(name!=='offline-store.js')assert.doesNotMatch(js,/\bfetch\s*\(/,name);
  }
});

test('默认离线 API 只读取一次包内清单，不把配置和图库操作发到网络',async()=>{
  const originalFetch=globalThis.fetch,requests=[];
  globalThis.fetch=async url=>{requests.push(String(url));return {ok:true,json:async()=>structuredClone(catalog)};};
  try{
    const api=createOfflineApi({indexedDB:new IDBFactory(),dbName:'package-network-check'});
    assert.equal((await api('/api/ships')).length,256);
    const settings=await api('/api/settings');await api('/api/settings','PUT',{version:settings.version,value:{shop:'本机测试'}});
    await api('/api/ships');assert.equal((await api('/api/settings')).value.shop,'本机测试');
    assert.equal(requests.length,1);assert.equal(requests[0],pathToFileURL(resolve(root,'assets/ships/catalog.json')).href);
  }finally{globalThis.fetch=originalFetch;}
});

test('256 艘舰船各自的原图与缩略图完整，512 个文件的 SHA-256 与清单一致',async()=>{
  assert.equal(catalog.schemaVersion,1);assert.equal(catalog.ships.length,256);
  const ids=new Set(),originals=new Set(),thumbs=new Set();
  for(const ship of catalog.ships){
    assert.ok(!ids.has(ship.id));ids.add(ship.id);assert.ok(ship.name&&ship.en);assert.ok(ship.priceUsd===null||Number.isFinite(ship.priceUsd));
    assert.equal(ship.thumbnailFile,ship.file+'.webp');originals.add(ship.file);thumbs.add(ship.thumbnailFile);
    for(const [directory,file,digest] of [['images',ship.file,ship.sha256],['thumbnails',ship.thumbnailFile,ship.thumbnailSha256]]){
      const bytes=await readFile(await localFile('assets/ships/'+directory+'/'+file));
      assert.equal(createHash('sha256').update(bytes).digest('hex'),digest,`${ship.en} ${directory}`);
      if(directory==='thumbnails')assert.equal(bytes.toString('ascii',0,4),'RIFF');
    }
  }
  assert.equal(originals.size,256);assert.equal(thumbs.size,256);
  assert.deepEqual((await readdir(resolve(root,'assets/ships/images'))).sort(),[...originals].sort());
  assert.deepEqual((await readdir(resolve(root,'assets/ships/thumbnails'))).sort(),[...thumbs].sort());
});

test('CSV 只读取所需字段，数字零为普通 CCU，非零为 WBCCU',()=>{
  const rows=parseUpgradeCsv('\uFEFFcount, FROM ,To,saving,note\r\n99,Ballista,Gladiator,0,ignored\r\n1,Ballista,Fortune,10,"quoted, value"\r\n1,Ballista,Fortune,-2.5,ignored',ships);
  assert.deepEqual(rows.map(row=>[row.fromId,row.toId,row.type,row.error]),[['a','b','CCU',''],['a','c','WBCCU',''],['a','c','WBCCU','']]);
});

test('CSV 不把空值和无效数字误当零，并拒绝损坏的表头或引号',()=>{
  for(const saving of ['','NaN','Infinity','0x10']){const [row]=parseUpgradeCsv(`from,to,saving\nBallista,Fortune,${saving}`,ships);assert.match(row.error,/saving/);assert.equal(row.type,'');}
  for(const text of ['from,to\na,b','from,to,saving,from\na,b,0,a','from,to,saving\n"Ballista,Fortune,0'])assert.throws(()=>parseUpgradeCsv(text,ships));
});

test('CSV 对同名舰船要求明确选择，并严格阻止同价或降级',()=>{
  const duplicate=[...ships,{...ships[0],id:'alternate'}];
  const text='from,to,saving\nBallista,Fortune,0';assert.match(parseUpgradeCsv(text,duplicate)[0].error,/歧义/);
  assert.equal(parseUpgradeCsv(text,duplicate,{'2:from':'alternate'})[0].fromId,'alternate');
  assert.match(parseUpgradeCsv('from,to,saving\nFortune,Ballista,0',ships)[0].error,/严格低于/);
  assert.match(parseUpgradeCsv(text,ships.map(ship=>({...ship,priceUsd:140})))[0].error,/严格低于/);
});

function workbook(rows){const book=utils.book_new();utils.book_append_sheet(book,utils.aoa_to_sheet(rows),'导出');return write(book,{type:'array',bookType:'xlsx',compression:true});}
test('星河避难所 XLSX 跳过标题行，匹配英中舰船名并按节约分类',()=>{
  const buffer=workbook([['星河避难所升级列表'],['起始船(英)','起始船(中)','终点船(英)','终点船(中)','节约($)'],['Ballista','弩炮','Fortune','财富',0],['','弩炮','','财富',15]]);
  const records=readUpgradeXlsx(buffer);assert.deepEqual(records.map(row=>row.rowNumber),[3,4]);
  const rows=matchUpgradeRows(records,ships,{},{allowChinese:true});
  assert.deepEqual(rows.map(row=>[row.fromId,row.toId,row.type,row.error]),[['a','c','CCU',''],['a','c','WBCCU','']]);
});

test('XLSX 对无效文件、表头缺失或重复明确报错',()=>{
  assert.throws(()=>readUpgradeXlsx(new TextEncoder().encode('not an XLSX')),/XLSX/);
  for(const headers of [['起始船','终点船'],['起始船','终点船','节约','节约']])assert.throws(()=>readUpgradeXlsx(workbook([['标题'],headers,['弩炮','财富',0,0]])),/必需列|重复/);
});

test('舰船选择遵循价格严格递增，排序稳定且不修改原数组',()=>{
  assert.equal(routeError(ships[0],ships[2]),'');assert.equal(canSelectShip('from',ships[2],ships[0]),false);assert.equal(canSelectShip('to',ships[0],ships[2]),false);
  assert.equal(canSelectShip('from',{...ships[0],priceUsd:null},null),false);
  const original=[ships[2],ships[0],ships[1]],copy=[...original];
  assert.deepEqual(sortPickerShips(original,'price-asc').map(ship=>ship.id),['a','b','c']);assert.deepEqual(sortPickerShips(original,'price-desc').map(ship=>ship.id),['c','b','a']);
  assert.deepEqual(sortPickerShips(original,'default'),copy);assert.deepEqual(original,copy);
});

test('浏览器本地 ZIP 包保留 UTF-8 中文路径、原始字节及标准 CRC32',async()=>{
  const zip=new LocalZip(),payload=Uint8Array.from([0,1,2,128,255]);
  await zip.add('升级商品图/弩炮 → 财富.png',new Blob([payload]));await zip.add('settings.txt',new Blob(['offline']));
  const blob=zip.finish();assert.equal(blob.size,zip.size);assert.equal(zip.count,2);
  const bytes=Buffer.from(await blob.arrayBuffer()),end=bytes.length-22;
  assert.equal(bytes.readUInt32LE(end),0x06054b50);assert.equal(bytes.readUInt16LE(end+10),2);
  const entries=new Map();let cursor=bytes.readUInt32LE(end+16);
  for(let index=0;index<2;index++){
    assert.equal(bytes.readUInt32LE(cursor),0x02014b50);assert.ok(bytes.readUInt16LE(cursor+8)&0x800);
    const size=bytes.readUInt32LE(cursor+20),nameLength=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32),offset=bytes.readUInt32LE(cursor+42);
    const name=bytes.toString('utf8',cursor+46,cursor+46+nameLength);assert.equal(bytes.readUInt32LE(offset),0x04034b50);
    assert.equal(bytes.toString('utf8',offset+30,offset+30+nameLength),name);
    const start=offset+30+bytes.readUInt16LE(offset+26)+bytes.readUInt16LE(offset+28),content=bytes.subarray(start,start+size);
    assert.equal(crc32(content),bytes.readUInt32LE(cursor+16));entries.set(name,content);cursor+=46+nameLength+extra+comment;
  }
  assert.equal(cursor,end);assert.deepEqual(new Uint8Array(entries.get('升级商品图/弩炮 → 财富.png')),payload);
  assert.equal(entries.get('settings.txt').toString('utf8'),'offline');
});

test('本地 ZIP 阻止路径穿越和不支持的条目',async()=>{
  const zip=new LocalZip();for(const name of ['../secret','/absolute','a/../b','a\\b','C:secret'])await assert.rejects(zip.add(name,new Blob(['x'])),/Invalid ZIP entry name/);
  await assert.rejects(zip.add('file.txt','not a Blob'),/Blob/);assert.equal(zip.count,0);
});
