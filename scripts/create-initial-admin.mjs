import {DatabaseSync,backup as sqliteBackup} from 'node:sqlite';
import {randomBytes,randomUUID,scrypt} from 'node:crypto';
import {promisify} from 'node:util';
import {resolve,join} from 'node:path';
import {mkdirSync} from 'node:fs';
import {createInterface} from 'node:readline';
import validator from 'validator';
import {defaultSettings} from '../accounts.mjs';

const input=createInterface({input:process.stdin,terminal:false});
let db;
try{
  const line=await new Promise((done,reject)=>{input.once('line',done);input.once('close',()=>reject(new Error('Missing input')));});input.close();
  const data=JSON.parse(line),email=typeof data.email==='string'?data.email.trim():'',password=data.password;
  if(!validator.isEmail(email,{allow_utf8_local_part:false})||email.length>254||typeof password!=='string'||password.length<10||password.length>128)throw new Error('Invalid email or password length');
  const directory=resolve(process.env.DATA_DIR||'data');db=new DatabaseSync(join(directory,'studio.sqlite'));db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  function check(){if(db.prepare("SELECT 1 FROM users WHERE role='admin'").get())throw new Error('An initial administrator already exists');if(db.prepare('SELECT 1 FROM users WHERE emailKey=?').get(email.toLowerCase()))throw new Error('Account already exists; use account permissions without replacing its password');}
  check();mkdirSync(join(directory,'backups'),{recursive:true});
  const snapshot=join(directory,'backups',`before-initial-admin-${Date.now()}-${randomUUID()}.sqlite`);await sqliteBackup(db,snapshot);
  const salt=randomBytes(16).toString('hex'),hash=(await promisify(scrypt)(password,Buffer.from(salt,'hex'),64,{N:131072,r:8,p:1,maxmem:192*1024*1024})).toString('hex'),id=randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try{
    check();db.prepare("INSERT INTO users(id,email,emailKey,passwordSalt,passwordHash,createdAt,role) VALUES(?,?,?,?,?,?,'admin')").run(id,email,email.toLowerCase(),salt,hash,new Date().toISOString());
    db.prepare('INSERT INTO user_settings(userId,value,version) VALUES(?,?,0)').run(id,JSON.stringify(defaultSettings));
    db.prepare("INSERT INTO role_changes(id,userId,actorId,fromRole,toRole,createdAt) VALUES(?,?,?,'user','admin',?)").run(randomUUID(),id,'server-bootstrap',new Date().toISOString());db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  console.log(JSON.stringify({ok:true,user:{id,email,role:'admin'},backup:snapshot}));
}catch{console.error('Initial administrator creation failed; check account state and input locally.');process.exitCode=1;}
finally{input.close();db?.close();}
