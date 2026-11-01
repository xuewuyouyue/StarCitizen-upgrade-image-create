import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readdirSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';

const data=mkdtempSync(join(tmpdir(),'upgrade-studio-accounts-')),base='http://127.0.0.1:4193';
const adminPassword='admin-test-password-123456',alicePassword='alice-test-password-123456',bobPassword='bob-test-password-123456';
const boundaryPasswords=['x'.repeat(8),'z'.repeat(11),'y'.repeat(128)];
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const legacyId='00000000-0000-4000-8000-000000000003',legacyImage=legacyId+'.png';
const legacySettings={shop:'旧管理员店铺',logo:'',template:'mono',type:'CCU',order:'from-top',separator:'→',account:'旧管理员账号'};
const defaults={shop:'我的店铺',logo:'',template:'ember',type:'WBCCU',order:'to-top',separator:' → ',account:'',title:'',size:1600};
let processHandle,logs='',adminCookie,alice,bob,aliceSettings,bobSettings;

mkdirSync(join(data,'images'));
writeFileSync(join(data,'images',legacyImage),Buffer.from(image.split(',')[1],'base64'));
const legacyDb=new DatabaseSync(join(data,'studio.sqlite'));
legacyDb.exec("CREATE TABLE ships(id TEXT PRIMARY KEY,name TEXT NOT NULL,en TEXT NOT NULL DEFAULT '',manufacturer TEXT NOT NULL DEFAULT '',image TEXT NOT NULL,priceCents INTEGER,version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,updatedAt TEXT NOT NULL); CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0);");
legacyDb.prepare('INSERT INTO ships(id,name,en,manufacturer,image,priceCents,version,updatedAt) VALUES(?,?,?,?,?,?,?,?)').run(legacyId,'旧舰船','Legacy','Original',legacyImage,14000,7,'2026-10-01T00:00:00.000Z');
legacyDb.prepare('INSERT INTO settings VALUES(1,?,3)').run(JSON.stringify(legacySettings));
legacyDb.close();

async function start({production=false,secure=false}={}){
  processHandle=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,NODE_ENV:production?'production':'test',HOST:'127.0.0.1',PORT:'4193',DATA_DIR:data,APP_PASSWORD:adminPassword,COOKIE_SECURE:String(secure),SMTP_HOST:'',SMTP_PORT:'',SMTP_FROM:'',SMTP_SECURE:'false',SMTP_USER:'',SMTP_PASS:'',SMTP_PASSWORD:''}});
  processHandle.stdout.on('data',d=>logs+=d);processHandle.stderr.on('data',d=>logs+=d);
  for(let i=0;i<100;i++){
    if(processHandle.exitCode!==null)throw Error('Account test server exited before becoming healthy');
    try{const response=await fetch(base+'/health');if(response.ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw Error('Account test server did not become healthy');
}
async function stop(){if(!processHandle||processHandle.exitCode!==null)return;const ended=once(processHandle,'exit');processHandle.kill();await ended;}
async function req(path,method='GET',value,cookie='',headers={}){
  return fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(value!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:value!==undefined?JSON.stringify(value):undefined});
}
function cookieOf(response){const value=response.headers.get('set-cookie');assert.ok(value?.includes('studio_session='),'Successful authentication sets a session cookie');assert.match(value,/HttpOnly/i);assert.match(value,/SameSite=Lax/i);return value.split(';')[0];}
async function register(email,password){const response=await req('/api/auth/register','POST',{email,password,role:'admin'});assert.equal(response.status,201);const result=await response.json();assert.equal(result.user.role,'user');assert.deepEqual(Object.keys(result.user).sort(),['email','id','role']);return {...result.user,cookie:cookieOf(response)};}
async function login(email,password){const response=await req('/api/auth/login','POST',{email,password});assert.equal(response.status,200);return cookieOf(response);}
async function settings(cookie){const response=await req('/api/settings','GET',undefined,cookie);assert.equal(response.status,200);return response.json();}

before(start);
after(async()=>{
  await stop();for(const secret of [adminPassword,alicePassword,bobPassword,...boundaryPasswords])assert.equal(logs.includes(secret),false,'Server logs do not contain passwords');
  assert.ok(data.startsWith(tmpdir()));rmSync(data,{recursive:true,force:true});
});

test('迁移先备份，保留旧舰船、图片与管理员配置，旧口令入口兼容',async()=>{
  const status=await(await req('/api/auth/status')).json();assert.equal(status.user,null);assert.equal(status.registrationAvailable,true);
  assert.equal((await req('/api/ships')).status,401);
  const loginResponse=await req('/api/login','POST',{password:adminPassword});assert.equal(loginResponse.status,200);adminCookie=cookieOf(loginResponse);
  const ships=await(await req('/api/ships','GET',undefined,adminCookie)).json();
  assert.deepEqual(ships,[{id:legacyId,name:'旧舰船',en:'Legacy',manufacturer:'Original',priceUsd:140,imageUrl:'/media/'+legacyImage,thumbnailUrl:'/thumbnails/'+legacyImage+'.webp',version:7,updatedAt:'2026-10-01T00:00:00.000Z'}]);
  assert.deepEqual(await settings(adminCookie),{version:3,value:legacySettings});
  assert.deepEqual(readFileSync(join(data,'images',legacyImage)),Buffer.from(image.split(',')[1],'base64'));
  const snapshots=readdirSync(join(data,'backups')).filter(name=>name.endsWith('.sqlite'));assert.ok(snapshots.length>0,'Account schema migration creates a SQLite snapshot');
  let foundLegacySnapshot=false;
  for(const name of snapshots){const snapshot=new DatabaseSync(join(data,'backups',name),{readOnly:true});try{if(!snapshot.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get()){assert.equal(snapshot.prepare('SELECT version FROM ships WHERE id=?').get(legacyId).version,7);assert.equal(snapshot.prepare('SELECT version FROM settings WHERE id=1').get().version,3);foundLegacySnapshot=true;}}finally{snapshot.close();}}
  assert.equal(foundLegacySnapshot,true,'A snapshot predates the account tables');
});

test('邮箱密码直接注册不依赖SMTP，规范化邮箱并限制密码8至128字符',async()=>{
  assert.equal((await req('/api/auth/register','POST',{email:'not-an-email',password:alicePassword})).status,400);
  for(const password of ['','x'.repeat(7),'x'.repeat(129)])assert.equal((await req('/api/auth/register','POST',{email:'alice@example.test',password})).status,400);
  alice=await register(' Alice@Example.test ',alicePassword);assert.equal(alice.email.trim().toLowerCase(),'alice@example.test');
  const current=await(await req('/api/auth/status','GET',undefined,alice.cookie)).json();assert.equal(current.user.id,alice.id);assert.equal(current.user.role,'user');
  assert.equal((await req('/api/auth/register','POST',{email:'ALICE@example.test',password:bobPassword})).status,409);
  for(let index=0;index<boundaryPasswords.length;index++){const email=`password-boundary-${index}@example.test`;await register(email,boundaryPasswords[index]);await login(email,boundaryPasswords[index]);}
  assert.equal((await req('/api/auth/login','POST',{email:'alice@example.test',password:'wrong-password'})).status,403);
  assert.equal((await req('/api/auth/login','POST',{email:'unknown@example.test',password:'wrong-password'})).status,403);
  alice.cookie=await login(' ALICE@example.test ',alicePassword);
});

test('同邮箱并发注册仅一次成功，随机盐与密码散列存储不泄露到用户响应',async()=>{
  const email='concurrent@example.test',responses=await Promise.all([req('/api/auth/register','POST',{email,password:alicePassword}),req('/api/auth/register','POST',{email:'CONCURRENT@example.test',password:alicePassword})]);
  assert.deepEqual(responses.map(response=>response.status).sort(),[201,409]);
  const db=new DatabaseSync(join(data,'studio.sqlite'),{readOnly:true});
  try{
    const rows=db.prepare('SELECT * FROM users WHERE emailKey=?').all(email),aliceRow=db.prepare('SELECT * FROM users WHERE emailKey=?').get('alice@example.test');
    assert.equal(rows.length,1);assert.ok(rows[0].passwordSalt);assert.ok(rows[0].passwordHash);assert.notEqual(rows[0].passwordHash,alicePassword);
    assert.notEqual(rows[0].passwordSalt,aliceRow.passwordSalt);assert.notEqual(rows[0].passwordHash,aliceRow.passwordHash);
    assert.equal(db.prepare('SELECT count(*) AS count FROM user_settings WHERE userId=?').get(rows[0].id).count,1);
  }finally{db.close();}
});

test('两个账号独立保存常用配置，版本冲突与伪造userId不会覆盖他人或管理员',async()=>{
  bob=await register('bob@example.test',bobPassword);assert.deepEqual(await settings(alice.cookie),{version:0,value:defaults});assert.deepEqual(await settings(bob.cookie),{version:0,value:defaults});
  aliceSettings={...defaults,shop:'Alice Shop',template:'tech',type:'CCU',order:'from-top',separator:' → ',title:'Alice saved title',upgradeText:'ALICE UPGRADE',upgradeArrow:'solid',upgradeMode:'arrow',upgradeColor:'#d4af37',size:2000};
  bobSettings={...defaults,shop:'Bob Shop',template:'mono',title:'Bob saved title',upgradeText:'升级至新舰船',upgradeArrow:'double',upgradeMode:'label',upgradeColor:'#419aff',size:1600};
  let response=await req('/api/settings','PUT',{version:0,value:aliceSettings,userId:bob.id},alice.cookie);assert.equal(response.status,200);assert.deepEqual(await response.json(),{version:1,value:aliceSettings});
  assert.deepEqual(await settings(bob.cookie),{version:0,value:defaults});
  response=await req('/api/settings','PUT',{version:0,value:bobSettings},bob.cookie);assert.equal(response.status,200);
  assert.equal((await req('/api/settings','PUT',{version:0,value:{...aliceSettings,shop:'Stale overwrite'}},alice.cookie)).status,409);
  assert.deepEqual(await settings(alice.cookie),{version:1,value:aliceSettings});assert.deepEqual(await settings(bob.cookie),{version:1,value:bobSettings});
  assert.deepEqual(await(await req('/api/settings?userId='+bob.id,'GET',undefined,alice.cookie)).json(),{version:1,value:aliceSettings});
  assert.deepEqual(await settings(adminCookie),{version:3,value:legacySettings});
});

test('普通用户共用图库但不能维护舰船，跨站修改被拒绝，登出立即撤销会话',async()=>{
  assert.equal((await req('/api/ships','GET',undefined,alice.cookie)).status,200);assert.equal((await req('/media/'+legacyImage,'GET',undefined,alice.cookie)).status,200);
  assert.equal((await req('/api/ships','POST',{name:'Unauthorized',priceUsd:175,image,role:'admin'},alice.cookie)).status,403);
  assert.equal((await req('/api/ships/'+legacyId,'PUT',{version:7,name:'Unauthorized',priceUsd:175},alice.cookie)).status,403);
  assert.equal((await req('/api/ships/'+legacyId,'DELETE',{version:7},alice.cookie)).status,403);
  const evil={Origin:'https://evil.example'};
  for(const [path,value]of [['/api/auth/register',{email:'cross-site@example.test',password:alicePassword}],['/api/auth/login',{email:alice.email,password:alicePassword}]])assert.equal((await req(path,'POST',value,'',evil)).status,403);
  assert.equal((await req('/api/settings','PUT',{version:1,value:aliceSettings},alice.cookie,evil)).status,403);
  const oldCookie=alice.cookie;assert.equal((await req('/api/auth/logout','POST',{},oldCookie)).status,200);assert.equal((await req('/api/settings','GET',undefined,oldCookie)).status,401);
  assert.equal((await(await req('/api/auth/status','GET',undefined,oldCookie)).json()).user,null);
  alice.cookie=await login('alice@example.test',alicePassword);
});

test('重启保留账号与个人配置，无SMTP仍允许注册且不会重复迁移',async()=>{
  const snapshotsBefore=readdirSync(join(data,'backups')).filter(name=>name.endsWith('.sqlite')).sort(),oldCookie=alice.cookie;
  await stop();await start();assert.equal((await(await req('/api/auth/status')).json()).registrationAvailable,true);
  assert.equal((await req('/api/settings','GET',undefined,oldCookie)).status,401);
  alice.cookie=await login('alice@example.test',alicePassword);bob.cookie=await login('bob@example.test',bobPassword);
  assert.deepEqual(await settings(alice.cookie),{version:1,value:aliceSettings});assert.deepEqual(await settings(bob.cookie),{version:1,value:bobSettings});
  const afterRestart=await register('after-restart@example.test',alicePassword);assert.deepEqual(await settings(afterRestart.cookie),{version:0,value:defaults});
  const adminLogin=await req('/api/login','POST',{password:adminPassword});assert.equal(adminLogin.status,200);adminCookie=cookieOf(adminLogin);assert.deepEqual(await settings(adminCookie),{version:3,value:legacySettings});
  assert.deepEqual(readdirSync(join(data,'backups')).filter(name=>name.endsWith('.sqlite')).sort(),snapshotsBefore);
});

test('普通账号成功登录不能清空同IP的管理员失败窗口',async()=>{
  const headers={'X-Real-IP':'198.51.100.80'};
  for(let attempt=0;attempt<9;attempt++)assert.equal((await req('/api/login','POST',{password:'incorrect-admin-password'},'',headers)).status,403);
  assert.equal((await req('/api/auth/login','POST',{email:'alice@example.test',password:alicePassword},'',headers)).status,200);
  assert.equal((await req('/api/login','POST',{password:'incorrect-admin-password'},'',headers)).status,403);
  assert.equal((await req('/api/auth/login','POST',{email:'alice@example.test',password:alicePassword},'',headers)).status,429);
  assert.equal((await req('/api/login','POST',{password:adminPassword},'',headers)).status,429);
});

test('每IP每小时最多20次注册尝试，重复邮箱失败也不能绕过配额',async()=>{
  const headers={'X-Real-IP':'198.51.100.81'};
  for(let attempt=0;attempt<20;attempt++)assert.equal((await req('/api/auth/register','POST',{email:'alice@example.test',password:alicePassword},'',headers)).status,409);
  assert.equal((await req('/api/auth/register','POST',{email:'after-register-limit@example.test',password:alicePassword},'',headers)).status,429);
});

test('生产环境邮箱认证要求Secure Cookie，HTTPS配置允许直接注册与登录',async()=>{
  await stop();await start({production:true,secure:false});
  assert.equal((await(await req('/api/auth/status')).json()).registrationAvailable,false);
  assert.equal((await req('/api/auth/login','POST',{email:'alice@example.test',password:alicePassword})).status,503);
  assert.equal((await req('/api/auth/register','POST',{email:'production-insecure@example.test',password:alicePassword})).status,503);
  assert.equal((await req('/api/login','POST',{password:adminPassword})).status,200);
  await stop();await start({production:true,secure:true});
  assert.equal((await(await req('/api/auth/status')).json()).registrationAvailable,true);
  const response=await req('/api/auth/login','POST',{email:'alice@example.test',password:alicePassword});assert.equal(response.status,200);
  assert.match(response.headers.get('set-cookie'),/;\s*Secure(?:;|$)/i);assert.deepEqual(await settings(cookieOf(response)),{version:1,value:aliceSettings});
  const registration=await req('/api/auth/register','POST',{email:'production-secure@example.test',password:alicePassword});assert.equal(registration.status,201);
  assert.match(registration.headers.get('set-cookie'),/;\s*Secure(?:;|$)/i);assert.equal((await registration.json()).user.role,'user');
});
