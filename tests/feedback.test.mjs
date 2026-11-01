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

const directory=mkdtempSync(join(tmpdir(),'upgrade-studio-feedback-')),base='http://127.0.0.1:4198';
const ownerPassword='feedback-owner-password-123456',userPassword='feedback-user-password-123456';
const users=[{id:'00000000-0000-4000-8000-000000000081',email:'Alpha@Example.test',role:'user'},{id:'00000000-0000-4000-8000-000000000082',email:'Beta@Example.test',role:'user'},{id:'00000000-0000-4000-8000-000000000083',email:'Admin@Example.test',role:'admin'}];
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',imageName='00000000-0000-4000-8000-000000000084.png';
const coreTables=['ships','settings','users','user_settings','role_changes'];
const readCore=db=>Object.fromEntries(coreTables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
let child,logs='',ownerCookie,alphaCookie,betaCookie,adminCookie,firstAlpha,firstBeta;
mkdirSync(join(directory,'images'));
writeFileSync(join(directory,'images',imageName),Buffer.from(image.split(',')[1],'base64'));
const seed=new DatabaseSync(join(directory,'studio.sqlite'));
seed.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE ships(id TEXT PRIMARY KEY,name TEXT NOT NULL,en TEXT NOT NULL DEFAULT '',manufacturer TEXT NOT NULL DEFAULT '',image TEXT NOT NULL,priceCents INTEGER,version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,updatedAt TEXT NOT NULL);
CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL,emailKey TEXT NOT NULL UNIQUE,passwordSalt TEXT NOT NULL,passwordHash TEXT NOT NULL,createdAt TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')));
CREATE TABLE user_settings(userId TEXT PRIMARY KEY REFERENCES users(id),value TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE role_changes(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),actorId TEXT NOT NULL,fromRole TEXT NOT NULL,toRole TEXT NOT NULL,createdAt TEXT NOT NULL);`);
seed.prepare('INSERT INTO ships(id,name,en,manufacturer,image,priceCents,version,updatedAt) VALUES(?,?,?,?,?,?,?,?)').run(imageName.slice(0,-4),'旧舰船','Legacy','Original',imageName,17500,7,'2026-10-01T00:00:00.000Z');
seed.prepare('INSERT INTO settings VALUES(1,?,4)').run(JSON.stringify({shop:'Owner original'}));
for(let index=0;index<users.length;index++){
  const user=users[index],salt=randomBytes(16).toString('hex'),hash=scryptSync(userPassword,Buffer.from(salt,'hex'),64,{N:131072,r:8,p:1,maxmem:192*1024*1024}).toString('hex');
  seed.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(user.id,user.email,user.email.toLowerCase(),salt,hash,'2026-10-01T00:00:00.000Z',user.role);
  seed.prepare('INSERT INTO user_settings VALUES(?,?,?)').run(user.id,JSON.stringify({shop:user.email,title:'Original personal title'}),index+2);
}
seed.prepare('INSERT INTO role_changes VALUES(?,?,?,?,?,?)').run('initial-role',users[2].id,'server-bootstrap','user','admin','2026-10-01T00:00:00.000Z');
const original=readCore(seed);seed.close();

function dbRead(action){const db=new DatabaseSync(join(directory,'studio.sqlite'));try{return action(db);}finally{db.close();}}
function messages(){return dbRead(db=>db.prepare('SELECT * FROM feedback ORDER BY createdAt DESC,id DESC').all());}
async function start(){
  child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,NODE_ENV:'test',HOST:'127.0.0.1',PORT:'4198',DATA_DIR:directory,APP_PASSWORD:ownerPassword,COOKIE_SECURE:'false'}});
  let ready=false;child.stdout.on('data',chunk=>{logs+=chunk;if(String(chunk).includes('http://127.0.0.1:4198'))ready=true;});child.stderr.on('data',chunk=>logs+=chunk);
  for(let attempt=0;attempt<100;attempt++){if(child.exitCode!==null)throw Error('Feedback test server exited before listening');if(ready){try{if((await fetch(base+'/health')).ok)return;}catch{}}await new Promise(resolve=>setTimeout(resolve,50));}
  throw Error('Feedback test server did not become healthy');
}
async function stop(){if(!child||child.exitCode!==null)return;const ended=once(child,'exit');child.kill();await ended;}
async function req(path,method='GET',value,cookie='',headers={}){return fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(value!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:value!==undefined?JSON.stringify(value):undefined});}
function cookieOf(response){const cookie=response.headers.get('set-cookie');assert.ok(cookie?.includes('studio_session='));return cookie.split(';')[0];}
async function login(email){const response=await req('/api/auth/login','POST',{email,password:userPassword});assert.equal(response.status,200);return cookieOf(response);}
async function ownerLogin(){const response=await req('/api/login','POST',{password:ownerPassword});assert.equal(response.status,200);return cookieOf(response);}
async function list(cookie,query=''){const response=await req('/api/feedback'+query,'GET',undefined,cookie);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^application\/json/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');return response.json();}
function backdate(userId){dbRead(db=>db.prepare('UPDATE feedback SET createdAt=? WHERE userId=?').run(new Date(Date.now()-61000).toISOString(),userId));}
async function pausedPost(cookie,content){
  const raw=JSON.stringify({content}),split=raw.length-1,client=request(base+'/api/feedback',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw),Expect:'100-continue'}});
  client.setTimeout(5000,()=>client.destroy(Error('Paused feedback request timed out')));
  const response=new Promise((resolve,reject)=>{client.on('response',message=>{message.resume();message.on('end',()=>resolve(message.statusCode));});client.on('error',reject);});
  client.flushHeaders();await once(client,'continue');client.write(raw.slice(0,split));return ()=>{client.end(raw.slice(split));return response;};
}

before(start);
after(async()=>{await stop();for(const password of [ownerPassword,userPassword])assert.equal(logs.includes(password),false);assert.ok(directory.startsWith(tmpdir()));rmSync(directory,{recursive:true,force:true});});

test('新增留言表前完整备份，既有五表及图片不改变',async()=>{
  const snapshots=readdirSync(join(directory,'backups')).filter(name=>/^schema-before-feedback-.*\.sqlite$/.test(name));assert.equal(snapshots.length,1);
  const backup=new DatabaseSync(join(directory,'backups',snapshots[0]),{readOnly:true});try{assert.equal(backup.prepare("SELECT 1 FROM sqlite_master WHERE name='feedback'").get(),undefined);assert.deepEqual(readCore(backup),original);}finally{backup.close();}
  assert.deepEqual(dbRead(readCore),original);assert.deepEqual(readFileSync(join(directory,'images',imageName)),Buffer.from(image.split(',')[1],'base64'));
  ownerCookie=await ownerLogin();alphaCookie=await login(users[0].email);betaCookie=await login(users[1].email);adminCookie=await login(users[2].email);
});

test('匿名拒绝访问，普通账号只读本人，管理员含邮箱查看全体且不能发表',async()=>{
  assert.equal((await req('/api/feedback')).status,401);assert.equal((await req('/api/feedback','POST',{content:'anonymous'})).status,401);
  let response=await req('/api/feedback','POST',{content:' \n建议优化选船\n ',userId:users[1].id,email:users[1].email},alphaCookie);assert.equal(response.status,201);firstAlpha=(await response.json()).message;
  assert.deepEqual(Object.keys(firstAlpha).sort(),['content','createdAt','id']);assert.equal(firstAlpha.content,'建议优化选船');assert.ok(Number.isFinite(Date.parse(firstAlpha.createdAt)));
  const xss='<img src=x onerror=alert(1)><script>alert(2)</script>';
  response=await req('/api/feedback','POST',{content:xss},betaCookie);assert.equal(response.status,201);firstBeta=(await response.json()).message;assert.equal(firstBeta.content,xss);
  const alpha=await list(alphaCookie),beta=await list(betaCookie);assert.deepEqual(alpha,{messages:[firstAlpha],hasMore:false});assert.deepEqual(beta,{messages:[firstBeta],hasMore:false});
  assert.deepEqual(await list(alphaCookie,'?userId='+users[1].id),alpha);
  for(const cookie of [adminCookie,ownerCookie]){const all=await list(cookie);assert.equal(all.messages.length,2);for(const row of all.messages)assert.deepEqual(Object.keys(row).sort(),['content','createdAt','email','id']);assert.equal(all.messages.find(row=>row.id===firstAlpha.id).email,users[0].email);assert.equal(all.messages.find(row=>row.id===firstBeta.id).email,users[1].email);assert.equal((await req('/api/feedback','POST',{content:'admin cannot post'},cookie)).status,403);}
});

test('留言trim后校验1至1000字符，非法与跨站请求不写入也不消耗名额',async()=>{
  const before=messages();
  for(const content of [undefined,null,123,true,[],{},'',' \n\t ','中'.repeat(1001)])assert.equal((await req('/api/feedback','POST',content===undefined?{}:{content},alphaCookie)).status,400);
  assert.equal((await req('/api/feedback','POST',{content:'cross-site'},alphaCookie,{Origin:'https://evil.example'})).status,403);
  assert.equal((await req('/api/feedback','POST',{content:'wrong content type'},alphaCookie,{'Content-Type':'text/plain'})).status,415);assert.deepEqual(messages(),before);
  backdate(users[0].id);let response=await req('/api/feedback','POST',{content:' '+('中'.repeat(1000))+' '},alphaCookie);assert.equal(response.status,201);assert.equal((await response.json()).message.content,'中'.repeat(1000));
  backdate(users[1].id);response=await req('/api/feedback','POST',{content:' a '},betaCookie);assert.equal(response.status,201);assert.equal((await response.json()).message.content,'a');
});

test('每账号60秒一条，连续和并发提交最多一次成功',async()=>{
  let response=await req('/api/feedback','POST',{content:'too soon'},alphaCookie);assert.equal(response.status,429);assert.match((await response.json()).error,/秒.*再试/);
  backdate(users[0].id);const before=messages().length,responses=await Promise.all([req('/api/feedback','POST',{content:'concurrent one'},alphaCookie),req('/api/feedback','POST',{content:'concurrent two'},alphaCookie)]);
  assert.deepEqual(responses.map(value=>value.status).sort(),[201,429]);assert.equal(messages().length,before+1);
});

test('列表限制50条，时间与ID稳定倒序，个人分页不泄露其他账号',async()=>{
  dbRead(db=>{const insert=db.prepare('INSERT INTO feedback(id,userId,content,createdAt) VALUES(?,?,?,?)');for(let index=0;index<70;index++)insert.run('10000000-0000-4000-8000-'+String(index).padStart(12,'0'),users[0].id,'page '+index,'2020-01-01T00:00:00.000Z');});
  const expected=messages().map(row=>row.id),first=await list(adminCookie),second=await list(adminCookie,'?offset=50&limit=50');assert.equal(first.messages.length,50);assert.equal(first.hasMore,true);assert.equal(second.hasMore,false);assert.deepEqual([...first.messages,...second.messages].map(row=>row.id),expected);
  const ownExpected=messages().filter(row=>row.userId===users[0].id).map(row=>row.id),ownFirst=await list(alphaCookie),ownSecond=await list(alphaCookie,'?offset=50');assert.deepEqual([...ownFirst.messages,...ownSecond.messages].map(row=>row.id),ownExpected);for(const row of [...ownFirst.messages,...ownSecond.messages])assert.equal(Object.hasOwn(row,'email'),false);
  assert.equal((await list(betaCookie)).messages.length,2);assert.deepEqual(await list(alphaCookie,'?offset=1000'),{messages:[],hasMore:false});assert.equal((await list(adminCookie,'?limit=1')).messages[0].id,expected[0]);
  for(const query of ['?limit=0','?limit=51','?limit=-1','?limit=1.5','?limit=','?offset=-1','?offset=1.5','?offset=abc','?offset=0x10','?offset=9007199254740992'])assert.equal((await req('/api/feedback'+query,'GET',undefined,alphaCookie)).status,400);
});

test('读取body期间提升为管理员或注销会话后不能继续发表',{timeout:15000},async()=>{
  let before=messages().length,complete=await pausedPost(alphaCookie,'must not post after promotion');
  assert.equal((await req('/api/admin/role','POST',{email:users[0].email,role:'admin'},ownerCookie)).status,200);assert.equal(await complete(),403);assert.equal(messages().length,before);
  assert.equal((await list(alphaCookie,'?limit=1')).messages[0].email!==undefined,true);
  assert.equal((await req('/api/admin/role','POST',{email:users[0].email,role:'user'},ownerCookie)).status,200);
  complete=await pausedPost(alphaCookie,'must not post after logout');assert.equal((await req('/api/auth/logout','POST',{},alphaCookie)).status,200);assert.equal(await complete(),401);assert.equal(messages().length,before);alphaCookie=await login(users[0].email);
});

test('留言和限流重启后保留，迁移快照不重复创建',async()=>{
  const before=messages(),snapshots=readdirSync(join(directory,'backups')).filter(name=>name.startsWith('schema-before-feedback-')).sort(),oldCookie=alphaCookie;
  await stop();await start();assert.equal((await req('/api/feedback','GET',undefined,oldCookie)).status,401);alphaCookie=await login(users[0].email);adminCookie=await login(users[2].email);ownerCookie=await ownerLogin();
  assert.deepEqual(messages(),before);assert.equal((await list(adminCookie)).messages.length,50);assert.equal((await req('/api/feedback','POST',{content:'restart must not reset cooldown'},alphaCookie)).status,429);assert.deepEqual(readdirSync(join(directory,'backups')).filter(name=>name.startsWith('schema-before-feedback-')).sort(),snapshots);
});

test('发表和读取不改变舰船、图片或个人配置，既有账号散列保持不变',()=>{
  const current=dbRead(readCore);for(const table of ['ships','settings','users','user_settings'])assert.deepEqual(current[table],original[table]);assert.deepEqual(current.role_changes.slice(0,original.role_changes.length),original.role_changes);assert.equal(current.role_changes.length,original.role_changes.length+2);
  assert.deepEqual(readFileSync(join(directory,'images',imageName)),Buffer.from(image.split(',')[1],'base64'));
});
