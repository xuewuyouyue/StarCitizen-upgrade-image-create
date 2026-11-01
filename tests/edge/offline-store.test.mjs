import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

if(!process.env.EDGE_TEST_DIR)throw new Error('Run through npm run test:edge so tests use a fresh extension build');
const root=resolve(process.env.EDGE_TEST_DIR);
const {createOfflineApi}=await import(pathToFileURL(resolve(root,'offline-store.js')).href);

const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222',manual='33333333-3333-4333-8333-333333333333';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const manifest={schemaVersion:1,ships:[{id:first,name:'弩炮',en:'Ballista',manufacturer:'',priceUsd:140,file:first+'.jpg',thumbnailFile:first+'.jpg.webp'},{id:second,name:'财富',en:'Fortune',manufacturer:'',priceUsd:175,file:second+'.jpg',thumbnailFile:second+'.jpg.webp'}]};
function fixture(options={}){const indexedDB=new IDBFactory();let loads=0;const create=()=>createOfflineApi({indexedDB,dbName:'test',loadManifest:async()=>{loads++;return structuredClone(manifest);},newId:()=>manual,...options});return {indexedDB,create,get loads(){return loads;}};}
const fields=ship=>({name:ship.name,en:ship.en,manufacturer:ship.manufacturer,priceUsd:ship.priceUsd,version:ship.version});

test('内置图库只读清单一次，使用扩展相对路径且不把包内记录写入数据库',async()=>{
  const fixtureStore=fixture(),api=fixtureStore.create();
  const ships=await api('/api/ships');await api('/api/ships');await api('/api/settings');assert.equal(fixtureStore.loads,1);
  assert.equal(ships[0].imageUrl,'./assets/ships/images/'+first+'.jpg');assert.equal(ships[0].thumbnailUrl,'./assets/ships/thumbnails/'+first+'.jpg.webp');
  assert.equal(ships[0].version,1);assert.deepEqual(await api('/api/settings'),{version:0,value:{}});
  const db=await new Promise(resolve=>{const request=fixtureStore.indexedDB.open('test');request.onsuccess=()=>resolve(request.result);});
  const count=await new Promise(resolve=>{const request=db.transaction('ships').objectStore('ships').count();request.onsuccess=()=>resolve(request.result);});assert.equal(count,0);db.close();
});

test('重开标签页保留自定义名称、价格、完整配置和软删除，不会恢复内置旧资料',async()=>{
  const store=fixture(),firstTab=store.create(),ships=await firstTab('/api/ships');
  const edited=await firstTab('/api/ships/'+first,'PUT',{...fields(ships[0]),name:'我的弩炮',priceUsd:145});assert.equal(edited.version,2);
  await firstTab('/api/ships/'+second,'DELETE',{version:1});
  const value={shop:'我的店铺',from:first,to:second,format:'jpeg',crop:{from:{x:10,y:40,zoom:1.2},to:{x:60,y:50,zoom:1}},upgradeColor:'#e3bd77'};
  await firstTab('/api/settings','PUT',{version:0,value});
  const reopened=store.create(),saved=await reopened('/api/ships');assert.equal(saved.length,1);assert.equal(saved[0].name,'我的弩炮');assert.equal(saved[0].priceUsd,145);
  assert.deepEqual(await reopened('/api/settings'),{version:1,value});
  await assert.rejects(reopened('/api/ships/'+second,'PUT',{...fields(ships[1]),name:'不能恢复'}),error=>error.status===404);
});

test('多标签页同时修改舰船时只有一份旧版本写入成功',async()=>{
  const store=fixture(),left=store.create(),right=store.create(),ship=(await left('/api/ships'))[0];await right('/api/ships');
  const results=await Promise.allSettled([left('/api/ships/'+first,'PUT',{...fields(ship),name:'甲'}),right('/api/ships/'+first,'PUT',{...fields(ship),name:'乙'})]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);const rejected=results.find(result=>result.status==='rejected');assert.equal(rejected.reason.status,409);
  const saved=(await right('/api/ships'))[0];assert.equal(saved.version,2);assert.ok(['甲','乙'].includes(saved.name));
});

test('多标签页保存设置时检查事务内的最新版本',async()=>{
  const store=fixture(),left=store.create(),right=store.create();await Promise.all([left('/api/settings'),right('/api/settings')]);
  const results=await Promise.allSettled([left('/api/settings','PUT',{version:0,value:{shop:'甲'}}),right('/api/settings','PUT',{version:0,value:{shop:'乙'}})]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.find(result=>result.status==='rejected').reason.status,409);
  assert.equal((await right('/api/settings')).version,1);
});

test('手动添加图片与内置图片替换只保存本机，重开仍可读取',async()=>{
  const store=fixture(),api=store.create();
  const added=await api('/api/ships','POST',{name:'自定义船',en:'Custom',manufacturer:'',priceUsd:199,image:png});assert.equal(added.id,manual);assert.equal(added.imageUrl,png);assert.equal(added.thumbnailUrl,png);
  const ship=(await api('/api/ships'))[0];await api('/api/ships/'+first,'PUT',{...fields(ship),image:png});
  const reopened=store.create(),saved=await reopened('/api/ships');assert.equal(saved.find(ship=>ship.id===manual).imageUrl,png);assert.equal(saved[0].imageUrl,png);assert.equal(saved[0].thumbnailUrl,png);
  await reopened('/api/ships/'+manual,'DELETE',{version:1});assert.equal((await store.create()('/api/ships')).length,2);
});

test('无效图片、恶意路径、未知编号与无效价格不会写入图库',async()=>{
  const store=fixture(),api=store.create(),ship=(await api('/api/ships'))[0];
  for(const image of ['https://example.com/ship.jpg','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,aGVsbG8='])await assert.rejects(api('/api/ships','POST',{name:'拒绝',priceUsd:1,image}),error=>error.status===400);
  await assert.rejects(api('/api/ships/'+manual,'DELETE',{version:1}),error=>error.status===404);
  await assert.rejects(api('/api/ships/../escape','DELETE',{version:1}),error=>error.status===404);
  for(const priceUsd of [-1,NaN,Infinity,3.1415,'1'])await assert.rejects(api('/api/ships/'+first,'PUT',{...fields(ship),priceUsd}),error=>error.status===400);
  assert.equal((await api('/api/ships')).length,2);assert.equal((await api('/api/ships'))[0].version,1);
  const corrupted=fixture({loadManifest:async()=>({schemaVersion:1,ships:[{...manifest.ships[0],file:'../private.jpg'}]})}).create();await assert.rejects(corrupted('/api/ships'),error=>error.status===400);
});

test('IndexedDB 不可用时给出中文故障提示，不回退到远程接口',async()=>{
  const api=createOfflineApi({indexedDB:null,loadManifest:async()=>manifest});await assert.rejects(api('/api/ships'),error=>error.status===503&&error.message.includes('本机数据库不可用'));
});
