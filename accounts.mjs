import {randomBytes,randomUUID,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {isIP} from 'node:net';
import validator from 'validator';

const derive=promisify(scrypt),hour=3600000;
export const defaultSettings={shop:'我的店铺',logo:'',template:'ember',type:'WBCCU',order:'to-top',separator:' → ',account:'',title:'',size:1600};

export function createAccounts(db,{password,secure,production,ApiError}){
  db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL,emailKey TEXT NOT NULL UNIQUE,passwordSalt TEXT NOT NULL,passwordHash TEXT NOT NULL,createdAt TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')));
CREATE TABLE IF NOT EXISTS user_settings(userId TEXT PRIMARY KEY REFERENCES users(id),value TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS role_changes(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),actorId TEXT NOT NULL,fromRole TEXT NOT NULL,toRole TEXT NOT NULL,createdAt TEXT NOT NULL);`);
  const sessions=new Map(),loginAttempts=new Map(),registrationAttempts=new Map();
  const dummySalt=randomBytes(16).toString('hex');
  const accountTransportAllowed=!production||secure;
  const registrationAvailable=accountTransportAllowed;
  let hashing=0;
  function email(value){
    if(typeof value!=='string'||value.length>254||!validator.isEmail(value.trim(),{allow_utf8_local_part:false}))throw new ApiError(400,'请输入有效的邮箱地址');
    const address=value.trim();return {address,key:address.toLowerCase()};
  }
  function clientIp(req){const remote=req.socket.remoteAddress||'unknown',forwarded=req.headers['x-real-ip'];return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)&&typeof forwarded==='string'&&isIP(forwarded)?forwarded:remote;}
  function tokenKey(token){return createHash('sha256').update(token).digest('hex');}
  function sessionKey(req){const token=/(?:^|;\s*)studio_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];return token?tokenKey(token):null;}
  function userView(row){return {id:row.id,email:row.email,role:row.role};}
  const admin={id:'local-admin',email:null,role:'admin'};
  function identity(req){
    if(!password)return admin;
    const key=sessionKey(req),session=key&&sessions.get(key);
    if(!session)return null;
    if(session.expiresAt<=Date.now()){sessions.delete(key);return null;}
    if(session.owner)return admin;
    const row=db.prepare('SELECT id,email,role FROM users WHERE id=?').get(session.userId);
    if(!row){sessions.delete(key);return null;}return userView(row);
  }
  function cookie(token,maxAge=604800){return `studio_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure?'; Secure':''}`;}
  function loginSession(user){const token=randomBytes(32).toString('hex');sessions.set(tokenKey(token),{userId:user.id,owner:user.id==='local-admin',expiresAt:Date.now()+7*24*hour});return {'Set-Cookie':cookie(token)};}
  function logout(req){const key=sessionKey(req);if(key)sessions.delete(key);return {'Set-Cookie':cookie('',0)};}
  function requireRegistration(){if(!registrationAvailable)throw new ApiError(503,'账号注册暂未开放');}
  function passwordInput(value){if(typeof value!=='string'||value.length<8||value.length>128)throw new ApiError(400,'密码须为 8–128 个字符');return value;}
  async function hash(value,salt){
    if(hashing>=2)throw new ApiError(429,'请求较多，请稍后再试');hashing++;
    try{return (await derive(value,Buffer.from(salt,'hex'),64,{N:131072,r:8,p:1,maxmem:192*1024*1024})).toString('hex');}finally{hashing--;}
  }
  function limitLogin(req){const key=clientIp(req),entry=loginAttempts.get(key);if(entry&&entry.until>Date.now()&&entry.count>=10)throw new ApiError(429,'尝试次数过多，请 15 分钟后再试');return key;}
  function failedLogin(ip){const entry=loginAttempts.get(ip),now=Date.now();loginAttempts.set(ip,{count:entry?.until>now?entry.count+1:1,until:entry?.until>now?entry.until:now+900000});}
  async function login(req,data){
    const ip=limitLogin(req),mail=email(data.email),input=typeof data.password==='string'&&data.password.length<=128?data.password:'';
    const row=db.prepare('SELECT * FROM users WHERE emailKey=?').get(mail.key),candidate=await hash(input,row?.passwordSalt||dummySalt);
    if(!row||!timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(row.passwordHash,'hex'))){failedLogin(ip);throw new ApiError(403,'邮箱或密码不正确');}
    if(!accountTransportAllowed&&row.role!=='admin')throw new ApiError(503,'普通账号暂未开放，请稍后再试');
    const user=userView(row);return {user,headers:loginSession(user)};
  }
  async function register(req,data){
    requireRegistration();const ip=clientIp(req),now=Date.now(),entry=registrationAttempts.get(ip);
    if(entry&&entry.until>now&&entry.count>=20)throw new ApiError(429,'注册请求过多，请一小时后再试');
    registrationAttempts.set(ip,{count:entry?.until>now?entry.count+1:1,until:entry?.until>now?entry.until:now+hour});
    const mail=email(data.email),input=passwordInput(data.password);
    const salt=randomBytes(16).toString('hex'),digest=await hash(input,salt),id=randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try{
      if(db.prepare('SELECT id FROM users WHERE emailKey=?').get(mail.key))throw new ApiError(409,'此邮箱已注册，请直接登录');
      db.prepare('INSERT INTO users(id,email,emailKey,passwordSalt,passwordHash,createdAt) VALUES(?,?,?,?,?,?)').run(id,mail.address,mail.key,salt,digest,new Date().toISOString());
      db.prepare('INSERT INTO user_settings(userId,value,version) VALUES(?,?,0)').run(id,JSON.stringify(defaultSettings));
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    const user={id,email:mail.address,role:'user'};return {user,headers:loginSession(user)};
  }
  function settings(user){return user.id==='local-admin'?db.prepare('SELECT * FROM settings WHERE id=1').get():db.prepare('SELECT * FROM user_settings WHERE userId=?').get(user.id);}
  function saveSettings(user,value){if(user.id==='local-admin')db.prepare('UPDATE settings SET value=?,version=version+1 WHERE id=1').run(JSON.stringify(value));else db.prepare('UPDATE user_settings SET value=?,version=version+1 WHERE userId=?').run(JSON.stringify(value),user.id);}
  function userByEmail(value){const row=db.prepare('SELECT id,email,role FROM users WHERE emailKey=?').get(email(value).key);if(!row)throw new ApiError(404,'此邮箱尚未注册');return userView(row);}
  function changeRole(actor,data,beforeChange){
    if(!['admin','user'].includes(data.role))throw new ApiError(400,'账号权限无效');
    db.exec('BEGIN IMMEDIATE');
    try{
      if(actor.id!=='local-admin'&&db.prepare('SELECT role FROM users WHERE id=?').get(actor.id)?.role!=='admin')throw new ApiError(403,'只有管理员可以修改账号权限');
      const target=userByEmail(data.email);
      if(target.role!==data.role){
        if(target.role==='admin'&&db.prepare("SELECT count(*) AS count FROM users WHERE role='admin'").get().count<=1)throw new ApiError(409,'请先授权另一位管理员，不能撤销最后一位管理员');
        beforeChange({user:target,actorId:actor.id});
        db.prepare('UPDATE users SET role=? WHERE id=?').run(data.role,target.id);
        db.prepare('INSERT INTO role_changes(id,userId,actorId,fromRole,toRole,createdAt) VALUES(?,?,?,?,?,?)').run(randomUUID(),target.id,actor.id,target.role,data.role,new Date().toISOString());
      }
      db.exec('COMMIT');return {...target,role:data.role};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  function cleanup(){const now=Date.now();for(const [key,s]of sessions)if(s.expiresAt<=now)sessions.delete(key);for(const map of [loginAttempts,registrationAttempts])for(const [key,v]of map)if(v.until<=now)map.delete(key);}
  return {identity,loginSession,logout,login,register,settings,saveSettings,userByEmail,changeRole,registrationAvailable,cleanup,limitLogin,failedLogin,admin};
}
