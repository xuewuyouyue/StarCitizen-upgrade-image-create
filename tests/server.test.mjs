import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readdirSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
const data=mkdtempSync(join(tmpdir(),'upgrade-studio-test-')),base='http://127.0.0.1:4191';
let processHandle,cookie='',created;
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const legacyId='00000000-0000-4000-8000-000000000001',legacyImage=legacyId+'.png';
mkdirSync(join(data,'images'));
writeFileSync(join(data,'images',legacyImage),Buffer.from(image.split(',')[1],'base64'));
const legacyDb=new DatabaseSync(join(data,'studio.sqlite'));
legacyDb.exec("CREATE TABLE ships(id TEXT PRIMARY KEY,name TEXT NOT NULL,en TEXT NOT NULL DEFAULT '',manufacturer TEXT NOT NULL DEFAULT '',image TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,updatedAt TEXT NOT NULL); CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0);");
legacyDb.prepare('INSERT INTO ships(id,name,en,manufacturer,image,version,updatedAt) VALUES(?,?,?,?,?,?,?)').run(legacyId,'旧舰船','Legacy','Original',legacyImage,7,'2026-10-01T00:00:00.000Z');
legacyDb.prepare('INSERT INTO settings VALUES(1,?,0)').run(JSON.stringify({shop:'旧店铺'}));legacyDb.close();
async function start(){processHandle=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:'4191',DATA_DIR:data,APP_PASSWORD:'test-password-123456'}});let output='';processHandle.stdout.on('data',d=>output+=d);processHandle.stderr.on('data',d=>output+=d);for(let i=0;i<100;i++){try{const r=await fetch(base+'/health');if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error(output||'Server did not start');}
async function stop(){const ended=once(processHandle,'exit');processHandle.kill();await ended;}
async function req(path,method='GET',body,extra={}){return fetch(base+path,{method,headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{}),...extra},body:body?JSON.stringify(body):undefined});}
before(start);after(async()=>{await stop();assert.ok(data.startsWith(tmpdir()));rmSync(data,{recursive:true,force:true});});
test('私有图库拒绝未登录访问，登录后才能读写',async()=>{
  assert.equal((await req('/api/ships')).status,401);
  assert.equal((await req('/api/login','POST',{password:'wrong'})).status,403);
  const r=await req('/api/login','POST',{password:'test-password-123456'});assert.equal(r.status,200);
  cookie=r.headers.get('set-cookie').split(';')[0];
  assert.deepEqual((await(await req('/api/ships')).json()).map(s=>s.id),[legacyId]);
});
test('旧数据库增列前备份，原舰船和设置保持不变',async()=>{
  const s=(await(await req('/api/ships')).json())[0];
  assert.deepEqual(s,{id:legacyId,name:'旧舰船',en:'Legacy',manufacturer:'Original',priceUsd:null,imageUrl:'/media/'+legacyImage,thumbnailUrl:'/thumbnails/'+legacyImage+'.webp',version:7,updatedAt:'2026-10-01T00:00:00.000Z'});
  assert.equal((await(await req('/api/settings')).json()).value.shop,'旧店铺');
  assert.deepEqual(readFileSync(join(data,'images',legacyImage)),Buffer.from(image.split(',')[1],'base64'));
  const snapshots=readdirSync(join(data,'backups')).filter(n=>n.startsWith('schema-before-price-')&&n.endsWith('.sqlite'));
  assert.equal(snapshots.length,1);
  const beforeDb=new DatabaseSync(join(data,'backups',snapshots[0]),{readOnly:true});
  assert.equal(beforeDb.prepare('PRAGMA table_info(ships)').all().some(c=>c.name==='priceCents'),false);
  assert.equal(beforeDb.prepare('SELECT version FROM ships WHERE id=?').get(legacyId).version,7);beforeDb.close();
});
test('上传价格与图片后，刷新读取一致',async()=>{
  const r=await req('/api/ships','POST',{name:'测试起点',en:'Origin',manufacturer:'Test',priceUsd:140,image});assert.equal(r.status,201);created=await r.json();
  assert.equal(created.priceUsd,140);assert.equal((await req(created.imageUrl)).status,200);
  const fresh=(await(await req('/api/ships')).json()).find(s=>s.id===created.id);
  assert.equal(fresh.name,'测试起点');assert.equal(fresh.priceUsd,140);
});
test('跨设备编辑冲突返回409，旧客户端缺少价格字段时保留原值',async()=>{
  const r=await req('/api/ships/'+created.id,'PUT',{version:created.version,name:'测试改名',en:'Origin',manufacturer:'Test'});assert.equal(r.status,200);
  assert.equal((await req('/api/ships/'+created.id,'PUT',{version:created.version,name:'过期覆盖'})).status,409);
  created=await r.json();assert.equal(created.priceUsd,140);
  assert.ok(readdirSync(join(data,'backups')).some(n=>n.includes('ship-updated')));
});
test('负数、超范围、多余小数和非数值价格被拒绝且不修改记录',async()=>{
  const filesBefore=readdirSync(join(data,'images')).length;
  for(const priceUsd of [-1,9999999,1.001,'175',true,{}]){
    assert.equal((await req('/api/ships/'+created.id,'PUT',{version:created.version,name:'测试改名',en:'Origin',manufacturer:'Test',priceUsd})).status,400);
  }
  assert.equal((await req('/api/ships','POST',{name:'无效价格',image,priceUsd:-1})).status,400);
  assert.equal(readdirSync(join(data,'images')).length,filesBefore);
  assert.deepEqual((await(await req('/api/ships')).json()).find(s=>s.id===created.id),created);
});
test('价格允许0、清空及两位小数，服务器精确保留金额',async()=>{
  for(const priceUsd of [0,null,175.25]){
    const r=await req('/api/ships/'+created.id,'PUT',{version:created.version,name:created.name,en:created.en,manufacturer:created.manufacturer,priceUsd});
    assert.equal(r.status,200);created=await r.json();assert.equal(created.priceUsd,priceUsd);
  }
});
test('拒绝跨站修改与伪造图片',async()=>{
  assert.equal((await req('/api/ships','POST',{name:'跨站',image},{Origin:'https://evil.example'})).status,403);
  assert.equal((await req('/api/ships','POST',{name:'无效',image:'data:image/png;base64,'+Buffer.from('not-an-image-at-all').toString('base64')})).status,400);
  assert.equal((await req('/.env')).status,404);
});
test('设置和价格重启后仍在，数据库迁移不会重复执行',async()=>{
  const value={shop:'测试店铺',account:'测试账号',logo:'',template:'mono',type:'CCU',order:'from-top',separator:'→'};
  assert.equal((await req('/api/settings','PUT',{version:0,value})).status,200);
  assert.equal((await req('/api/settings','PUT',{version:0,value})).status,409);
  await stop();await start();assert.equal((await req('/api/ships')).status,401);
  const login=await req('/api/login','POST',{password:'test-password-123456'});cookie=login.headers.get('set-cookie').split(';')[0];
  const ships=await(await req('/api/ships')).json();assert.equal(ships.find(s=>s.id===created.id).priceUsd,175.25);assert.equal(ships.find(s=>s.id===legacyId).version,7);
  assert.equal((await(await req('/api/settings')).json()).value.shop,'测试店铺');
  assert.equal(readdirSync(join(data,'backups')).filter(n=>n.startsWith('schema-before-price-')&&n.endsWith('.sqlite')).length,1);
});
test('删除保留带价格的备份、图片和非目标舰船',async()=>{
  assert.equal((await req('/api/ships/'+created.id,'DELETE',{version:created.version})).status,200);
  const remaining=await(await req('/api/ships')).json();assert.deepEqual(remaining.map(s=>s.id),[legacyId]);assert.equal(remaining[0].version,7);
  const snapshot=readdirSync(join(data,'backups')).find(n=>n.includes('ship-deleted'));
  assert.equal(JSON.parse(readFileSync(join(data,'backups',snapshot),'utf8')).priceCents,17525);
  assert.equal((await req(created.imageUrl)).status,200);
});
test('旧页面的样例创建请求被拒绝，重复和并发请求不新增舰船或图片',async()=>{
  const before=await(await req('/api/ships')).json(),files=readdirSync(join(data,'images')).sort();
  for(const [name,en,priceUsd]of [['弩炮 · 示例','Ballista',140],['财富 · 示例','Fortune',175]]){
    const payload={name,en,priceUsd,manufacturer:'参考图样例 · 可替换',image};
    const replies=await Promise.all([req('/api/ships','POST',payload),req('/api/ships','POST',payload)]);
    for(const reply of replies){assert.equal(reply.status,409);assert.match((await reply.json()).error,/刷新/);}
  }
  assert.deepEqual(await(await req('/api/ships')).json(),before);assert.deepEqual(readdirSync(join(data,'images')).sort(),files);
});

test('中框文案和箭头随配置保存，旧页面遗漏字段不抹除，类型兼容旧CCU',async()=>{
  let current=await(await req('/api/settings')).json();
  for(const type of ['WBCCU','涨价CCU','CCU']){
    const response=await req('/api/settings','PUT',{version:current.version,value:{...current.value,type,upgradeText:'升级至新舰船',upgradeArrow:'solid'}});
    assert.equal(response.status,200);current=await response.json();assert.equal(current.value.type,type);assert.equal(current.value.upgradeText,'升级至新舰船');assert.equal(current.value.upgradeArrow,'solid');
  }
  const {upgradeText,upgradeArrow,...legacy}=current.value,oldVersion=current.version;
  const saved=await req('/api/settings','PUT',{version:oldVersion,value:{...legacy,shop:'旧页面保存'}});assert.equal(saved.status,200);current=await saved.json();
  assert.equal(current.value.upgradeText,upgradeText);assert.equal(current.value.upgradeArrow,upgradeArrow);
  assert.equal((await req('/api/settings','PUT',{version:oldVersion,value:{...legacy,upgradeText:'过期覆盖',upgradeArrow:'none'}})).status,409);
  await stop();await start();const login=await req('/api/login','POST',{password:'test-password-123456'});cookie=login.headers.get('set-cookie').split(';')[0];
  assert.deepEqual(await(await req('/api/settings')).json(),current);
});

test('中框配置允许清空及40字符，拒绝超长、非文本和未知箭头且不改变已存配置',async()=>{
  let current=await(await req('/api/settings')).json();
  for(const [upgradeText,upgradeArrow] of [['中'.repeat(40),'line'],['','solid'],['   ','double'],['中文 / CUSTOM','none']]){
    const response=await req('/api/settings','PUT',{version:current.version,value:{...current.value,upgradeText,upgradeArrow}});
    assert.equal(response.status,200);current=await response.json();assert.equal(current.value.upgradeText,upgradeText.trim());assert.equal(current.value.upgradeArrow,upgradeArrow);
  }
  for(const fields of [{upgradeText:'中'.repeat(41)},{upgradeText:null},{upgradeText:123},{upgradeArrow:null},{upgradeArrow:'random'},{type:'unknown'}]){
    const response=await req('/api/settings','PUT',{version:current.version,value:{...current.value,...fields}});assert.equal(response.status,400);
    assert.deepEqual(await(await req('/api/settings')).json(),current);
  }
});

test('中框模式保存兼容旧配置，独立箭头不丢文案且none归一为细线',async()=>{
  let current=await(await req('/api/settings')).json();assert.equal(Object.hasOwn(current.value,'upgradeMode'),false);
  for(const [upgradeMode,upgradeArrow] of [['label','none'],['arrow','none'],['arrow','solid'],['arrow','double'],['label','line']]){
    const response=await req('/api/settings','PUT',{version:current.version,value:{...current.value,upgradeMode,upgradeArrow,upgradeText:'切换后保留'}});
    assert.equal(response.status,200);current=await response.json();assert.equal(current.value.upgradeMode,upgradeMode);assert.equal(current.value.upgradeArrow,upgradeMode==='arrow'&&upgradeArrow==='none'?'line':upgradeArrow);assert.equal(current.value.upgradeText,'切换后保留');
  }
  let response=await req('/api/settings','PUT',{version:current.version,value:{...current.value,upgradeMode:'arrow',upgradeArrow:'double'}});assert.equal(response.status,200);current=await response.json();
  const {upgradeMode,upgradeText,...legacy}=current.value;
  response=await req('/api/settings','PUT',{version:current.version,value:{...legacy,upgradeArrow:'none'}});assert.equal(response.status,200);current=await response.json();
  assert.equal(current.value.upgradeMode,'arrow');assert.equal(current.value.upgradeArrow,'line');assert.equal(current.value.upgradeText,'切换后保留');
  for(const upgradeMode of [null,'',false,'unknown']){assert.equal((await req('/api/settings','PUT',{version:current.version,value:{...current.value,upgradeMode}})).status,400);assert.deepEqual(await(await req('/api/settings')).json(),current);}
  await stop();await start();const login=await req('/api/login','POST',{password:'test-password-123456'});cookie=login.headers.get('set-cookie').split(';')[0];assert.deepEqual(await(await req('/api/settings')).json(),current);
});

test('独立箭头颜色兼容旧配置，保存归一化、清空、模式保留和重启持久，非法值不写入',async()=>{
  const stored=new DatabaseSync(join(data,'studio.sqlite'),{readOnly:true});
  const beforeRead=stored.prepare('SELECT value,version FROM settings WHERE id=1').get();
  let current=await(await req('/api/settings')).json();assert.equal(Object.hasOwn(current.value,'upgradeColor'),false);
  assert.deepEqual(stored.prepare('SELECT value,version FROM settings WHERE id=1').get(),beforeRead);stored.close();
  let response=await req('/api/settings','PUT',{version:current.version,value:{...current.value,upgradeMode:'label'}});assert.equal(response.status,200);current=await response.json();
  assert.equal(Object.hasOwn(current.value,'upgradeColor'),false);
  for(const [upgradeMode,upgradeColor]of [['arrow','#A1B2C3'],['label','#09Ff10'],['arrow',''],['arrow','#Ff3300']]){
    response=await req('/api/settings','PUT',{version:current.version,value:{...current.value,upgradeMode,upgradeColor}});assert.equal(response.status,200);current=await response.json();
    assert.equal(current.value.upgradeColor,upgradeColor.toLowerCase());assert.equal(current.value.upgradeMode,upgradeMode);
  }
  const {upgradeColor,...legacy}=current.value;
  response=await req('/api/settings','PUT',{version:current.version,value:{...legacy,shop:'旧页面保留颜色',upgradeMode:'label'}});assert.equal(response.status,200);current=await response.json();
  assert.equal(current.value.upgradeColor,upgradeColor);assert.equal(current.value.upgradeMode,'label');
  const filesBefore=readdirSync(join(data,'backups')).sort();
  for(const upgradeColor of [null,123,true,{},[],'red','#fff','#12345678','123456','#12gg34',' #123456','#123456 ','#123456\n','#123456\r']){
    assert.equal((await req('/api/settings','PUT',{version:current.version,value:{...current.value,upgradeColor}})).status,400);
    assert.deepEqual(await(await req('/api/settings')).json(),current);
  }
  assert.deepEqual(readdirSync(join(data,'backups')).sort(),filesBefore);
  await stop();await start();const login=await req('/api/login','POST',{password:'test-password-123456'});cookie=login.headers.get('set-cookie').split(';')[0];assert.deepEqual(await(await req('/api/settings')).json(),current);
});

test('本地图标以SVG响应，来源与许可随站点发布',async()=>{
  const module=await req('/marker-icons.js');assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/^text\/javascript/);
  for(const name of ['arrow-up','arrow-big-up','chevrons-up']){const response=await req('/assets/icons/lucide/'+name+'.svg');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^image\/svg\+xml/);assert.match(await response.text(),/<path d=/);}
  const license=await req('/assets/icons/lucide/LICENSE.txt');assert.equal(license.status,200);assert.match(await license.text(),/ISC License/);
});

test('外部导入模块仅提供本地静态脚本，不新增批量上传接口',async()=>{
  for(const name of ['batch-export.js','ccu-csv.js','ccu-xlsx.js','local-zip.js','vendor/sheetjs/xlsx.mjs']){const response=await req('/'+name);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^text\/javascript/);}
  const license=await req('/vendor/sheetjs/LICENSE.txt');assert.equal(license.status,200);assert.match(await license.text(),/Apache License/);
  assert.equal((await req('/api/batch','POST',{from:'Ballista',to:'Fortune',saving:0})).status,404);
});
