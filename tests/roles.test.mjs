import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {request} from 'node:http';
import {randomBytes,scryptSync} from 'node:crypto';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';

const data=mkdtempSync(join(tmpdir(),'upgrade-studio-roles-')),freshData=mkdtempSync(join(tmpdir(),'upgrade-studio-first-role-')),cliData=mkdtempSync(join(tmpdir(),'upgrade-studio-initial-role-')),base='http://127.0.0.1:4196';
const ownerPassword='owner-role-test-password-123456',userPassword='user-role-test-password-123456',initialPassword='testpass10';
const alphaId='00000000-0000-4000-8000-000000000041',betaId='00000000-0000-4000-8000-000000000042',legacyShipId='00000000-0000-4000-8000-000000000043';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const defaults={shop:'我的店铺',logo:'',template:'ember',type:'WBCCU',order:'to-top',separator:' → ',account:'',title:'',size:1600};
const ownerSettings={...defaults,shop:'Owner Legacy',title:'Owner only'},alphaSettings={...defaults,shop:'Alpha Personal',title:'Alpha saved',size:1000},betaSettings={...defaults,shop:'Beta Personal',title:'Beta saved',size:2000};
const oldUsers=[{id:alphaId,email:'Alpha@Example.test',emailKey:'alpha@example.test',salt:randomBytes(16).toString('hex')},{id:betaId,email:'Beta@Example.test',emailKey:'beta@example.test',salt:randomBytes(16).toString('hex')}];
let processHandle,logs='',ownerCookie,alphaCookie,betaCookie,betaAdminCookie,registered,createdShip,alphaSaved;

mkdirSync(join(data,'images'));
writeFileSync(join(data,'images',legacyShipId+'.png'),Buffer.from(image.split(',')[1],'base64'));
const legacyDb=new DatabaseSync(join(data,'studio.sqlite'));
legacyDb.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE ships(id TEXT PRIMARY KEY,name TEXT NOT NULL,en TEXT NOT NULL DEFAULT '',manufacturer TEXT NOT NULL DEFAULT '',image TEXT NOT NULL,priceCents INTEGER,version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,updatedAt TEXT NOT NULL);
CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL,emailKey TEXT NOT NULL UNIQUE,passwordSalt TEXT NOT NULL,passwordHash TEXT NOT NULL,createdAt TEXT NOT NULL);
CREATE TABLE user_settings(userId TEXT PRIMARY KEY REFERENCES users(id),value TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0);`);
legacyDb.prepare('INSERT INTO ships(id,name,en,manufacturer,image,priceCents,version,updatedAt) VALUES(?,?,?,?,?,?,?,?)').run(legacyShipId,'旧图库舰船','Legacy Ship','Original',legacyShipId+'.png',14000,9,'2026-10-01T00:00:00.000Z');
legacyDb.prepare('INSERT INTO settings VALUES(1,?,2)').run(JSON.stringify(ownerSettings));
for(const user of oldUsers){user.hash=scryptSync(userPassword,Buffer.from(user.salt,'hex'),64,{N:131072,r:8,p:1,maxmem:192*1024*1024}).toString('hex');legacyDb.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(user.id,user.email,user.emailKey,user.salt,user.hash,'2026-10-18T00:00:00.000Z');}
legacyDb.prepare('INSERT INTO user_settings VALUES(?,?,4)').run(alphaId,JSON.stringify(alphaSettings));
legacyDb.prepare('INSERT INTO user_settings VALUES(?,?,6)').run(betaId,JSON.stringify(betaSettings));legacyDb.close();

async function start(directory=data,{production=false,secure=false}={}){
  processHandle=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,NODE_ENV:production?'production':'test',HOST:'127.0.0.1',PORT:'4196',DATA_DIR:directory,APP_PASSWORD:ownerPassword,COOKIE_SECURE:String(secure),SMTP_HOST:'',SMTP_USER:'',SMTP_PASS:''}});
  processHandle.stdout.on('data',chunk=>logs+=chunk);processHandle.stderr.on('data',chunk=>logs+=chunk);
  for(let attempt=0;attempt<100;attempt++){if(processHandle.exitCode!==null)throw Error('Role test server exited before becoming healthy');try{if((await fetch(base+'/health')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
  throw Error('Role test server did not become healthy');
}
async function stop(){if(!processHandle||processHandle.exitCode!==null)return;const ended=once(processHandle,'exit');processHandle.kill();await ended;}
async function req(path,method='GET',value,cookie='',headers={}){return fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(value!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:value!==undefined?JSON.stringify(value):undefined});}
function cookieOf(response){const header=response.headers.get('set-cookie');assert.ok(header?.includes('studio_session='));return header.split(';')[0];}
function publicUser(value){assert.deepEqual(Object.keys(value).sort(),['email','id','role']);assert.ok(['admin','user'].includes(value.role));return value;}
async function login(email,password=userPassword){const response=await req('/api/auth/login','POST',{email,password});assert.equal(response.status,200);const value=await response.json();publicUser(value.user);return {cookie:cookieOf(response),user:value.user};}
async function ownerLogin(){const response=await req('/api/login','POST',{password:ownerPassword});assert.equal(response.status,200);assert.equal((await response.json()).user.id,'local-admin');return cookieOf(response);}
async function lookup(email,cookie){const response=await req('/api/admin/users?email='+encodeURIComponent(email),'GET',undefined,cookie);assert.equal(response.status,200);return publicUser((await response.json()).user);}
async function change(email,role,cookie){const response=await req('/api/admin/role','POST',{email,role},cookie);assert.equal(response.status,200);return publicUser((await response.json()).user);}
async function settings(cookie){const response=await req('/api/settings','GET',undefined,cookie);assert.equal(response.status,200);return response.json();}
function withDb(read,directory=data){const db=new DatabaseSync(join(directory,'studio.sqlite'),{readOnly:true});try{return read(db);}finally{db.close();}}
function audit(){return withDb(db=>db.prepare('SELECT * FROM role_changes ORDER BY rowid').all());}
function auditSummary(){return audit().map(row=>({userId:row.userId,actorId:row.actorId,fromRole:row.fromRole,toRole:row.toRole}));}
async function pausedRoleChange(cookie,value){
  const raw=JSON.stringify(value),client=request(base+'/api/admin/role',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw),Expect:'100-continue'}});
  client.setTimeout(5000,()=>client.destroy(Error('Paused role request timed out')));
  const response=new Promise((resolve,reject)=>{client.on('response',message=>{message.resume();message.on('end',()=>resolve(message.statusCode));});client.on('error',reject);});
  client.flushHeaders();await once(client,'continue');client.write(raw.slice(0,-1));
  return ()=>{client.end(raw.slice(-1));return response;};
}
async function createInitialAdmin(value){
  const child=spawn(process.execPath,['scripts/create-initial-admin.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATA_DIR:cliData},stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);const ended=once(child,'exit');child.stdin.end(JSON.stringify(value)+'\n');const [code]=await ended;
  assert.equal((stdout+stderr).includes(value.password),false,'Initial administrator CLI never echoes a password');
  return {code,stdout,stderr};
}

before(()=>start());
after(async()=>{await stop();for(const secret of [ownerPassword,userPassword,initialPassword])assert.equal(logs.includes(secret),false,'Logs do not contain account passwords');for(const directory of [data,freshData,cliData]){assert.ok(directory.startsWith(tmpdir()));rmSync(directory,{recursive:true,force:true});}});

test('旧用户迁移前创建角色备份，默认user且原密码、配置和图库保持不变',async()=>{
  const snapshots=readdirSync(join(data,'backups')).filter(name=>/^schema-before-user-roles-.*\.sqlite$/.test(name));assert.equal(snapshots.length,1);
  const snapshot=new DatabaseSync(join(data,'backups',snapshots[0]),{readOnly:true});try{assert.equal(snapshot.prepare('PRAGMA table_info(users)').all().some(column=>column.name==='role'),false);assert.equal(snapshot.prepare('SELECT count(*) AS count FROM users').get().count,2);for(const user of oldUsers)assert.equal(snapshot.prepare('SELECT passwordHash FROM users WHERE id=?').get(user.id).passwordHash,user.hash);}finally{snapshot.close();}
  withDb(db=>{for(const user of oldUsers){const row=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);assert.equal(row.role,'user');assert.equal(row.passwordSalt,user.salt);assert.equal(row.passwordHash,user.hash);}assert.equal(db.prepare('SELECT version FROM ships WHERE id=?').get(legacyShipId).version,9);assert.equal(db.prepare('SELECT count(*) AS count FROM role_changes').get().count,0);});
  ownerCookie=await ownerLogin();assert.deepEqual(await settings(ownerCookie),{version:2,value:ownerSettings});
  alphaCookie=(await login('alpha@example.test')).cookie;betaCookie=(await login('beta@example.test')).cookie;
  assert.deepEqual(await settings(alphaCookie),{version:4,value:alphaSettings});assert.deepEqual(await settings(betaCookie),{version:6,value:betaSettings});
  assert.deepEqual(readFileSync(join(data,'images',legacyShipId+'.png')),Buffer.from(image.split(',')[1],'base64'));
});

test('首页隐藏维护口令入口，独立owner页面可用，匿名和普通用户不能管理角色',async()=>{
  const home=await req('/');assert.equal(home.status,200);const html=await home.text();
  assert.doesNotMatch(html,/data-auth-(?:mode|panel)=["']admin["']/i);assert.doesNotMatch(html,/id=["']login-form["']/i);assert.doesNotMatch(html,/href=["']\/(?:owner|admin)(?:[/?#"'])/i);
  const owner=await req('/owner');assert.equal(owner.status,200);assert.match(await owner.text(),/访问口令/);
  assert.equal((await req('/api/admin/users?email=alpha@example.test')).status,401);assert.equal((await req('/api/admin/role','POST',{email:'alpha@example.test',role:'admin'})).status,401);
  for(const cookie of [alphaCookie,betaCookie]){assert.equal((await req('/api/admin/users?email=alpha@example.test','GET',undefined,cookie)).status,403);assert.equal((await req('/api/admin/role','POST',{email:'alpha@example.test',role:'admin'},cookie)).status,403);}
  const response=await req('/api/auth/register','POST',{email:'registered@example.test',password:userPassword,role:'admin',id:'local-admin'});assert.equal(response.status,201);registered={...publicUser((await response.json()).user),cookie:cookieOf(response)};assert.equal(registered.role,'user');
  assert.equal((await req('/api/ships','POST',{name:'Forged admin',priceUsd:175,image},registered.cookie)).status,403);
  assert.equal((await req('/api/admin/users?email=missing@example.test','GET',undefined,ownerCookie)).status,404);
  assert.equal((await req('/api/admin/role','POST',{email:'alpha@example.test',role:'owner'},ownerCookie)).status,400);
  assert.equal((await req('/api/admin/role','POST',{email:'alpha@example.test',role:'admin'},ownerCookie,{Origin:'https://evil.example'})).status,403);assert.equal(audit().length,0);
});

test('owner按指定邮箱授权，既有Cookie立即获得权限但仍使用个人配置',async()=>{
  const granted=await change(' ALPHA@EXAMPLE.TEST ','admin',ownerCookie);assert.deepEqual(granted,{id:alphaId,email:'Alpha@Example.test',role:'admin'});
  assert.equal((await(await req('/api/auth/status','GET',undefined,alphaCookie)).json()).user.role,'admin');assert.equal((await lookup('beta@example.test',alphaCookie)).role,'user');
  const response=await req('/api/ships','POST',{name:'Admin-created ship',en:'Admin Ship',priceUsd:175,image},alphaCookie);assert.equal(response.status,201);createdShip=await response.json();
  assert.deepEqual(await settings(alphaCookie),{version:4,value:alphaSettings});
  alphaSaved={...alphaSettings,shop:'Alpha Admin Personal',title:'Still personal',size:1600};assert.equal((await req('/api/settings','PUT',{version:4,value:alphaSaved},alphaCookie)).status,200);
  assert.deepEqual(await settings(alphaCookie),{version:5,value:alphaSaved});assert.deepEqual(await settings(ownerCookie),{version:2,value:ownerSettings});assert.deepEqual(await settings(betaCookie),{version:6,value:betaSettings});
  assert.deepEqual(auditSummary(),[{userId:alphaId,actorId:'local-admin',fromRole:'user',toRole:'admin'}]);
  await change('alpha@example.test','admin',ownerCookie);assert.equal(audit().length,1,'An unchanged role does not create an audit event');
});

test('邮箱管理员可授权和撤销，登录为admin的会话也立即撤权且个人配置不切换',async()=>{
  await change('beta@example.test','admin',alphaCookie);assert.equal((await lookup('alpha@example.test',betaCookie)).role,'admin');
  const betaLogin=await login('beta@example.test');assert.equal(betaLogin.user.role,'admin');betaAdminCookie=betaLogin.cookie;
  const status=(await(await req('/api/auth/status','GET',undefined,betaAdminCookie)).json()).user;assert.equal(status.id,betaId);assert.equal(status.role,'admin');assert.deepEqual(await settings(betaAdminCookie),{version:6,value:betaSettings});
  await change('alpha@example.test','user',alphaCookie);assert.equal((await req('/api/admin/users?email=beta@example.test','GET',undefined,alphaCookie)).status,403);assert.equal((await req('/api/ships/'+createdShip.id,'PUT',{version:createdShip.version,name:'Revoked edit'},alphaCookie)).status,403);
  assert.equal((await(await req('/api/auth/status','GET',undefined,alphaCookie)).json()).user.role,'user');assert.deepEqual(await settings(alphaCookie),{version:5,value:alphaSaved});
  assert.equal((await req('/api/admin/role','POST',{email:'alpha@example.test',role:'admin'},alphaCookie)).status,403);
  assert.deepEqual(auditSummary(),[{userId:alphaId,actorId:'local-admin',fromRole:'user',toRole:'admin'},{userId:betaId,actorId:alphaId,fromRole:'user',toRole:'admin'},{userId:alphaId,actorId:alphaId,fromRole:'admin',toRole:'user'}]);
});

test('最后邮箱管理员不能被自己或owner降级，有接替者后可撤销并立即失权',async()=>{
  for(const cookie of [betaAdminCookie,ownerCookie])assert.equal((await req('/api/admin/role','POST',{email:'beta@example.test',role:'user'},cookie)).status,409);
  assert.equal((await lookup('beta@example.test',ownerCookie)).role,'admin');assert.equal(audit().length,3);
  await change('alpha@example.test','admin',betaAdminCookie);await change('beta@example.test','user',betaAdminCookie);
  for(const cookie of [betaCookie,betaAdminCookie]){assert.equal((await req('/api/admin/users?email=alpha@example.test','GET',undefined,cookie)).status,403);assert.equal((await req('/api/ships/'+createdShip.id,'DELETE',{version:createdShip.version},cookie)).status,403);assert.deepEqual(await settings(cookie),{version:6,value:betaSettings});}
  assert.equal((await lookup('beta@example.test',alphaCookie)).role,'user');assert.equal(audit().length,5);
});

test('角色请求读完异步body后重新确认权限，等待期间被撤权的旧请求不能继续授权',{timeout:15000},async()=>{
  await change('beta@example.test','admin',ownerCookie);
  const complete=await pausedRoleChange(alphaCookie,{email:registered.email,role:'admin'});
  await change('alpha@example.test','user',ownerCookie);assert.equal(await complete(),403);
  assert.equal((await lookup(registered.email,ownerCookie)).role,'user');assert.equal(audit().length,7);
});

test('角色和审计重启后保留，迁移不重复，管理员仍读写自己的配置',async()=>{
  const snapshotsBefore=readdirSync(join(data,'backups')).filter(name=>name.startsWith('schema-before-user-roles-')).sort(),events=audit();
  for(const event of events){assert.ok(typeof event.id==='string'&&event.id);assert.ok(Number.isFinite(Date.parse(event.createdAt)));assert.ok(['user','admin'].includes(event.fromRole));assert.ok(['user','admin'].includes(event.toRole));assert.notEqual(event.fromRole,event.toRole);}
  await stop();await start();assert.equal((await req('/api/admin/users?email=beta@example.test','GET',undefined,betaAdminCookie)).status,401);
  const alpha=await login('alpha@example.test'),beta=await login('beta@example.test');assert.equal(alpha.user.role,'user');assert.equal(beta.user.role,'admin');alphaCookie=alpha.cookie;betaCookie=beta.cookie;
  assert.equal((await lookup('alpha@example.test',betaCookie)).role,'user');assert.deepEqual(await settings(alphaCookie),{version:5,value:alphaSaved});assert.deepEqual(await settings(betaCookie),{version:6,value:betaSettings});
  ownerCookie=await ownerLogin();assert.deepEqual(await settings(ownerCookie),{version:2,value:ownerSettings});assert.deepEqual(audit(),events);
  assert.deepEqual(readdirSync(join(data,'backups')).filter(name=>name.startsWith('schema-before-user-roles-')).sort(),snapshotsBefore);
});

test('空数据库首个注册账号仍为普通用户，owner可显式引导首个邮箱管理员',async()=>{
  await stop();await start(freshData);
  const response=await req('/api/auth/register','POST',{email:'first@example.test',password:userPassword,role:'admin'});assert.equal(response.status,201);const user=publicUser((await response.json()).user),cookie=cookieOf(response);assert.equal(user.role,'user');
  assert.equal((await req('/api/admin/users?email=first@example.test','GET',undefined,cookie)).status,403);
  const owner=await ownerLogin();assert.equal((await lookup('first@example.test',owner)).role,'user');await change('first@example.test','admin',owner);
  assert.equal((await lookup('first@example.test',cookie)).role,'admin');assert.deepEqual(await settings(cookie),{version:0,value:defaults});assert.deepEqual(await settings(owner),{version:0,value:{}});
  withDb(db=>{assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(user.id).role,'admin');const entry=db.prepare('SELECT * FROM role_changes').get();assert.equal(entry.actorId,'local-admin');assert.equal(entry.userId,user.id);},freshData);
});

test('服务器CLI先备份后创建初始邮箱管理员，10字符密码可登录且拒绝覆盖既有账号',async()=>{
  await stop();await start(cliData);
  const existingResponse=await req('/api/auth/register','POST',{email:'existing@example.test',password:userPassword});assert.equal(existingResponse.status,201);const existing=publicUser((await existingResponse.json()).user);assert.equal(existing.role,'user');await stop();
  const existingHash=withDb(db=>db.prepare('SELECT passwordHash FROM users WHERE id=?').get(existing.id).passwordHash,cliData);
  const overwrite=await createInitialAdmin({email:'existing@example.test',password:initialPassword});assert.notEqual(overwrite.code,0);assert.equal(withDb(db=>db.prepare('SELECT passwordHash FROM users WHERE id=?').get(existing.id).passwordHash,cliData),existingHash);
  const before=new Set(readdirSync(join(cliData,'backups')).filter(name=>name.endsWith('.sqlite'))),created=await createInitialAdmin({email:'Initial@Example.test',password:initialPassword});assert.equal(created.code,0);const result=JSON.parse(created.stdout),user=publicUser(result.user);assert.equal(result.ok,true);assert.equal(user.role,'admin');assert.equal(user.email.toLowerCase(),'initial@example.test');
  const snapshots=readdirSync(join(cliData,'backups')).filter(name=>name.endsWith('.sqlite')&&!before.has(name));assert.ok(snapshots.length>0,'Initial administrator creation saves a SQLite snapshot');assert.ok(snapshots.some(name=>join(cliData,'backups',name)===result.backup));
  let foundBefore=false;for(const name of snapshots){const snapshot=new DatabaseSync(join(cliData,'backups',name),{readOnly:true});try{if(!snapshot.prepare('SELECT id FROM users WHERE emailKey=?').get('initial@example.test')){assert.equal(snapshot.prepare('SELECT count(*) AS count FROM users').get().count,1);foundBefore=true;}}finally{snapshot.close();}}assert.equal(foundBefore,true);
  withDb(db=>{const row=db.prepare('SELECT * FROM users WHERE emailKey=?').get('initial@example.test');assert.equal(row.role,'admin');assert.ok(row.passwordSalt);assert.notEqual(row.passwordHash,initialPassword);assert.equal(created.stdout.includes(row.passwordSalt),false);assert.equal(created.stdout.includes(row.passwordHash),false);assert.deepEqual(JSON.parse(db.prepare('SELECT value FROM user_settings WHERE userId=?').get(row.id).value),defaults);assert.equal(db.prepare('SELECT count(*) AS count FROM users WHERE role=?').get('admin').count,1);const event=db.prepare('SELECT * FROM role_changes WHERE userId=?').get(row.id);assert.equal(event.actorId,'server-bootstrap');assert.equal(event.fromRole,'user');assert.equal(event.toRole,'admin');},cliData);
  assert.notEqual((await createInitialAdmin({email:'another@example.test',password:initialPassword})).code,0);assert.notEqual((await createInitialAdmin({email:'initial@example.test',password:userPassword})).code,0);
  await start(cliData);const loggedIn=await login('initial@example.test',initialPassword);assert.equal(loggedIn.user.role,'admin');assert.equal(loggedIn.user.id,user.id);assert.deepEqual(await settings(loggedIn.cookie),{version:0,value:defaults});assert.equal((await login('existing@example.test')).user.role,'user');
});

test('生产HTTP允许邮箱管理员和owner维护，普通用户仅在Secure配置后可登录注册',async()=>{
  await stop();await start(cliData,{production:true,secure:false});assert.equal((await(await req('/api/auth/status')).json()).registrationAvailable,false);
  const errors=[];for(const email of ['initial@example.test','existing@example.test','unknown@example.test']){const response=await req('/api/auth/login','POST',{email,password:'incorrect-role-password'});assert.equal(response.status,403);errors.push(await response.json());}assert.deepEqual(errors[0],errors[1]);assert.deepEqual(errors[1],errors[2]);
  const admin=await login('initial@example.test',initialPassword);assert.equal(admin.user.role,'admin');assert.equal((await lookup('existing@example.test',admin.cookie)).role,'user');assert.deepEqual(await settings(admin.cookie),{version:0,value:defaults});await ownerLogin();
  assert.equal((await req('/api/auth/login','POST',{email:'existing@example.test',password:userPassword})).status,503);assert.equal((await req('/api/auth/register','POST',{email:'insecure@example.test',password:userPassword})).status,503);
  await stop();await start(cliData,{production:true,secure:true});assert.equal((await(await req('/api/auth/status')).json()).registrationAvailable,true);
  for(const [email,password]of [['initial@example.test',initialPassword],['existing@example.test',userPassword]]){const response=await req('/api/auth/login','POST',{email,password});assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/;\s*Secure(?:;|$)/i);publicUser((await response.json()).user);}
  const response=await req('/api/auth/register','POST',{email:'secure-user@example.test',password:userPassword,role:'admin'});assert.equal(response.status,201);assert.equal(publicUser((await response.json()).user).role,'user');assert.match(response.headers.get('set-cookie'),/;\s*Secure(?:;|$)/i);
});
