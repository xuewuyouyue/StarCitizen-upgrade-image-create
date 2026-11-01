import http from 'node:http';
import {DatabaseSync,backup as sqliteBackup} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,statSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {createAccounts} from './accounts.mjs';
import {createFeedback} from './feedback.mjs';
import {createThumbnails,imageFilenamePattern} from './thumbnails.mjs';

const root=dirname(fileURLToPath(import.meta.url)),dataDir=resolve(process.env.DATA_DIR||join(root,'data'));
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||4173),production=process.env.NODE_ENV==='production';
const password=process.env.APP_PASSWORD||'',secure=process.env.COOKIE_SECURE==='true';
if((production||!['127.0.0.1','::1','localhost'].includes(host))&&password.length<12)throw new Error('公开部署必须设置至少 12 位的 APP_PASSWORD');
for(const path of [dataDir,join(dataDir,'images'),join(dataDir,'backups')])mkdirSync(path,{recursive:true});
const thumbnails=createThumbnails(dataDir);
const db=new DatabaseSync(join(dataDir,'studio.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
db.exec(`CREATE TABLE IF NOT EXISTS ships(id TEXT PRIMARY KEY,name TEXT NOT NULL,en TEXT NOT NULL DEFAULT '',manufacturer TEXT NOT NULL DEFAULT '',image TEXT NOT NULL,priceCents INTEGER,version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,updatedAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO settings(id,value,version) VALUES(1,'{}',0);`);
if(!db.prepare('PRAGMA table_info(ships)').all().some(column=>column.name==='priceCents')){
  await sqliteBackup(db,join(dataDir,'backups',`schema-before-price-${Date.now()}-${randomUUID()}.sqlite`));
  db.exec('ALTER TABLE ships ADD COLUMN priceCents INTEGER');
}
const salt=randomBytes(16),digest=password?scryptSync(password,salt,32):null;
const allowedStatic=new Map([['/','index.html'],['/index.html','index.html'],['/app.js','app.js'],['/renderer.js','renderer.js'],['/style.css','style.css']]);
allowedStatic.set('/theme.css','theme.css');
allowedStatic.set('/ship-filename.js','ship-filename.js');
allowedStatic.set('/route-rules.js','route-rules.js');
allowedStatic.set('/marker-icons.js','marker-icons.js');
allowedStatic.set('/feedback.js','feedback.js');
for(const module of ['batch-export.js','ccu-csv.js','ccu-xlsx.js','local-zip.js','vendor/sheetjs/xlsx.mjs','vendor/sheetjs/LICENSE.txt','vendor/sheetjs/sources.json'])allowedStatic.set('/'+module,module);
for(const icon of ['arrow-up.svg','arrow-big-up.svg','chevrons-up.svg','LICENSE.txt','sources.json'])allowedStatic.set(`/assets/icons/lucide/${icon}`,`assets/icons/lucide/${icon}`);
allowedStatic.set('/owner','owner.html');
allowedStatic.set('/owner.js','owner.js');
for(const frame of ['naval','porcelain','graphite'])allowedStatic.set(`/assets/${frame}.png`,`assets/${frame}.png`);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
class ApiError extends Error {constructor(status,message){super(message);this.status=status;}}
if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get())await sqliteBackup(db,join(dataDir,'backups',`schema-before-accounts-${Date.now()}-${randomUUID()}.sqlite`));
else if(!db.prepare('PRAGMA table_info(users)').all().some(column=>column.name==='role')){
  await sqliteBackup(db,join(dataDir,'backups',`schema-before-user-roles-${Date.now()}-${randomUUID()}.sqlite`));
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin'))");
}
const accounts=createAccounts(db,{password,secure,production,ApiError});
if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='feedback'").get())await sqliteBackup(db,join(dataDir,'backups',`schema-before-feedback-${Date.now()}-${randomUUID()}.sqlite`));
const feedback=createFeedback(db,ApiError);
function requireAdmin(req){const user=accounts.identity(req);if(!user)throw new ApiError(401,'请先登录');if(user.role!=='admin')throw new ApiError(403,'只有管理员可以执行此操作');return user;}
function json(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));}
function publicShip(s){return {id:s.id,name:s.name,en:s.en,manufacturer:s.manufacturer,priceUsd:s.priceCents==null?null:s.priceCents/100,imageUrl:'/media/'+s.image,thumbnailUrl:'/thumbnails/'+s.image+'.webp',version:s.version,updatedAt:s.updatedAt};}
function backup(label,value){writeFileSync(join(dataDir,'backups',`${Date.now()}-${randomUUID()}-${label}.json`),JSON.stringify(value,null,2),{flag:'wx',mode:0o600});}
function clean(value,max,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new ApiError(400,`文本格式错误或超过 ${max} 字限制`);return value.trim();}
function priceCents(value){
  if(value==null)return null;
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>999999.99)throw new ApiError(400,'价格须为 0–999999.99 美元，或留空');
  const cents=Math.round(value*100);if(cents/100!==value)throw new ApiError(400,'价格最多保留两位小数');return cents;
}
function imageBytes(value){
  if(typeof value!=='string')throw new ApiError(400,'缺少图片');
  const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(value);
  if(!match)throw new ApiError(400,'只支持 JPG、PNG 或 WebP 图片');const bytes=Buffer.from(match[2],'base64');
  if(bytes.length>6*1024*1024||bytes.length<16)throw new ApiError(400,'图片过大或文件无效');
  const valid=match[1]==='jpeg'?bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff:match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if(!valid)throw new ApiError(400,'图片格式与内容不匹配');return {bytes,ext:match[1]==='jpeg'?'jpg':match[1]};
}
function saveImage(value){const {bytes,ext}=imageBytes(value),filename=`${randomUUID()}.${ext}`,path=join(dataDir,'images',filename);writeFileSync(path+'.tmp',bytes,{flag:'wx',mode:0o600});renameSync(path+'.tmp',path);return filename;}
async function body(req){if(!req.headers['content-type']?.startsWith('application/json'))throw new ApiError(415,'请使用 JSON 请求');let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>9*1024*1024)throw new ApiError(413,'请求内容过大');chunks.push(chunk);}try{const result=JSON.parse(Buffer.concat(chunks).toString());if(!result||Array.isArray(result)||typeof result!=='object')throw Error();return result;}catch{throw new ApiError(400,'无效的 JSON 数据');}}
function sameOrigin(req){const origin=req.headers.origin;if(origin){let parsed;try{parsed=new URL(origin);}catch{throw new ApiError(403,'请求来源无效');}if(parsed.host!==req.headers.host)throw new ApiError(403,'不允许跨站修改');}}
function file(res,path,cache='no-cache'){if(!existsSync(path))throw new ApiError(404,'文件不存在');const ext=path.slice(path.lastIndexOf('.'));res.writeHead(200,{'Content-Type':mime[ext]||'application/octet-stream','Cache-Control':cache,'Content-Length':statSync(path).size});res.end(readFileSync(path));}
function privateImage(req,res,path){
  if(!existsSync(path))throw new ApiError(404,'文件不存在');
  const stat=statSync(path),etag=`W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`,headers={'Content-Type':mime[path.slice(path.lastIndexOf('.'))],'Cache-Control':'private, max-age=31536000, immutable',ETag:etag};
  if(req.headers['if-none-match']?.split(',').some(value=>value.trim()==='*'||value.trim().replace(/^W\//,'')===etag.replace(/^W\//,''))){res.writeHead(304,headers);return res.end();}
  res.writeHead(200,{...headers,'Content-Length':stat.size});res.end(readFileSync(path));
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try{
    const path=new URL(req.url,'http://localhost').pathname,method=req.method;
    if(path==='/health'&&method==='GET'){db.prepare('SELECT 1').get();return json(res,200,{ok:true,storage:'sqlite',authentication:!!password});}
    if(method==='GET'&&allowedStatic.has(path))return file(res,join(root,'public',allowedStatic.get(path)));
    if(!['GET','HEAD'].includes(method))sameOrigin(req);
    if(path==='/api/auth/status'&&method==='GET')return json(res,200,{user:accounts.identity(req),registrationAvailable:accounts.registrationAvailable});
    if(path==='/api/auth/register'&&method==='POST'){const result=await accounts.register(req,await body(req));return json(res,201,{ok:true,user:result.user},result.headers);}
    if(path==='/api/auth/login'&&method==='POST'){const result=await accounts.login(req,await body(req));return json(res,200,{ok:true,user:result.user},result.headers);}
    if(path==='/api/auth/logout'&&method==='POST')return json(res,200,{ok:true},accounts.logout(req));
    if(path==='/api/login'&&method==='POST'){
      const ip=accounts.limitLogin(req);
      const data=await body(req),input=typeof data.password==='string'?data.password:'';
      if(password&&(input.length>256||!timingSafeEqual(scryptSync(input,salt,32),digest))){accounts.failedLogin(ip);throw new ApiError(403,'访问口令不正确');}
      return json(res,200,{ok:true,user:accounts.admin},accounts.loginSession(accounts.admin));
    }
    const user=accounts.identity(req);if(!user)throw new ApiError(401,'请先登录');
    if(path==='/api/feedback'&&method==='GET')return json(res,200,feedback.list(user,new URL(req.url,'http://localhost').searchParams));
    if(path==='/api/feedback'&&method==='POST'){
      if(user.role!=='user')throw new ApiError(403,'仅普通账号可以留言');
      const data=await body(req),author=accounts.identity(req);if(!author)throw new ApiError(401,'请先登录');if(author.role!=='user')throw new ApiError(403,'仅普通账号可以留言');
      return json(res,201,{message:feedback.add(author,data.content)});
    }
    if(path==='/api/admin/users'&&method==='GET'){requireAdmin(req);return json(res,200,{user:accounts.userByEmail(new URL(req.url,'http://localhost').searchParams.get('email'))});}
    if(path==='/api/admin/role'&&method==='POST'){requireAdmin(req);const data=await body(req),actor=requireAdmin(req);return json(res,200,{user:accounts.changeRole(actor,data,value=>backup('account-role',value))});}
    if((path==='/api/ships'||path.startsWith('/api/ships/'))&&!['GET','HEAD'].includes(method)&&user.role!=='admin')throw new ApiError(403,'只有管理员可以维护舰船图库');
    if(method==='GET'&&path.startsWith('/media/')&&imageFilenamePattern.test(path.slice(7)))return privateImage(req,res,join(dataDir,'images',path.slice(7)));
    if(method==='GET'&&path.startsWith('/thumbnails/')&&path.endsWith('.webp')){
      const filename=path.slice(12,-5);if(!imageFilenamePattern.test(filename))throw new ApiError(404,'文件不存在');
      let thumbnail;try{thumbnail=await thumbnails.ensure(filename);}catch(error){if(error.code==='ENOENT')throw new ApiError(404,'文件不存在');throw error;}
      return privateImage(req,res,thumbnail.path);
    }
    if(path==='/api/ships'&&method==='GET')return json(res,200,db.prepare('SELECT * FROM ships WHERE deleted=0 ORDER BY name COLLATE NOCASE').all().map(publicShip));
    if(path==='/api/ships'&&method==='POST'){
      const data=await body(req);requireAdmin(req);
      if(data.manufacturer==='参考图样例 · 可替换'&&['弩炮 · 示例','财富 · 示例'].includes(data.name))throw new ApiError(409,'请刷新页面后载入样例，样例不再新增到图库');
      const name=clean(data.name,60,true),en=clean(data.en??'',80),manufacturer=clean(data.manufacturer??'',60),price=priceCents(data.priceUsd),image=saveImage(data.image),id=randomUUID(),date=new Date().toISOString();
      db.prepare('INSERT INTO ships(id,name,en,manufacturer,image,priceCents,updatedAt) VALUES(?,?,?,?,?,?,?)').run(id,name,en,manufacturer,image,price,date);return json(res,201,publicShip(db.prepare('SELECT * FROM ships WHERE id=?').get(id)));
    }
    const shipMatch=/^\/api\/ships\/([0-9a-f-]{36})$/.exec(path);
    if(shipMatch&&['PUT','DELETE'].includes(method)){
      const data=await body(req);requireAdmin(req);const ship=db.prepare('SELECT * FROM ships WHERE id=? AND deleted=0').get(shipMatch[1]);if(!ship)throw new ApiError(404,'舰船已不存在，请刷新图库');
      if(data.version!==ship.version)throw new ApiError(409,'资料已在其他设备更新，请刷新图库后重新编辑');
      if(method==='DELETE'){backup('ship-deleted',ship);db.prepare('UPDATE ships SET deleted=1,version=version+1,updatedAt=? WHERE id=?').run(new Date().toISOString(),ship.id);return json(res,200,{ok:true});}
      const name=clean(data.name,60,true),en=clean(data.en??'',80),manufacturer=clean(data.manufacturer??'',60),price=Object.hasOwn(data,'priceUsd')?priceCents(data.priceUsd):ship.priceCents;backup('ship-updated',ship);const image=data.image?saveImage(data.image):ship.image;
      db.prepare('UPDATE ships SET name=?,en=?,manufacturer=?,image=?,priceCents=?,version=version+1,updatedAt=? WHERE id=?').run(name,en,manufacturer,image,price,new Date().toISOString(),ship.id);return json(res,200,publicShip(db.prepare('SELECT * FROM ships WHERE id=?').get(ship.id)));
    }
    if(path==='/api/settings'&&method==='GET'){const s=accounts.settings(user);return json(res,200,{version:s.version,value:JSON.parse(s.value)});}
    if(path==='/api/settings'&&method==='PUT'){
      const data=await body(req),current=accounts.settings(user);if(data.version!==current.version)throw new ApiError(409,'店铺配置已在其他设备更新，请刷新页面后重试');
      const v=data.value;if(!v||typeof v!=='object')throw new ApiError(400,'缺少配置');
      clean(v.separator??' → ',12,true);
      const value={shop:clean(v.shop??'',30),account:clean(v.account??'',50),separator:v.separator??' → ',logo:v.logo||''};
      for(const [key,allowed] of Object.entries({template:['tech','ember','mono'],type:['WBCCU','涨价CCU','CCU'],order:['to-top','from-top']})){if(!allowed.includes(v[key]))throw new ApiError(400,'配置选项无效');value[key]=v[key];}
      const previous=JSON.parse(current.value);
      if(Object.hasOwn(v,'title')||Object.hasOwn(previous,'title'))value.title=clean(v.title??previous.title??'',80);
      if(Object.hasOwn(v,'upgradeText')||Object.hasOwn(previous,'upgradeText'))value.upgradeText=clean(Object.hasOwn(v,'upgradeText')?v.upgradeText:previous.upgradeText,40);
      if(Object.hasOwn(v,'upgradeArrow')||Object.hasOwn(previous,'upgradeArrow')){value.upgradeArrow=Object.hasOwn(v,'upgradeArrow')?v.upgradeArrow:previous.upgradeArrow;if(!['line','solid','double','none'].includes(value.upgradeArrow))throw new ApiError(400,'中框箭头样式无效');}
      if(Object.hasOwn(v,'upgradeMode')||Object.hasOwn(previous,'upgradeMode')){value.upgradeMode=Object.hasOwn(v,'upgradeMode')?v.upgradeMode:previous.upgradeMode;if(!['label','arrow'].includes(value.upgradeMode))throw new ApiError(400,'中框呈现方式无效');}
      if(Object.hasOwn(v,'upgradeColor')||Object.hasOwn(previous,'upgradeColor')){value.upgradeColor=Object.hasOwn(v,'upgradeColor')?v.upgradeColor:previous.upgradeColor;if(typeof value.upgradeColor!=='string'||(value.upgradeColor!==''&&(value.upgradeColor.length!==7||!/^#[0-9a-f]{6}$/i.test(value.upgradeColor))))throw new ApiError(400,'中框箭头颜色无效');value.upgradeColor=value.upgradeColor.toLowerCase();}
      if(value.upgradeMode==='arrow'&&(value.upgradeArrow===undefined||value.upgradeArrow==='none'))value.upgradeArrow='line';
      if(Object.hasOwn(v,'size')||Object.hasOwn(previous,'size')){value.size=v.size??previous.size;if(![1000,1600,2000].includes(value.size))throw new ApiError(400,'图片尺寸无效');}
      if(value.logo)imageBytes(value.logo);backup('settings',current);accounts.saveSettings(user,value);return json(res,200,{version:current.version+1,value});
    }
    throw new ApiError(404,'没有找到此页面或接口');
  }catch(error){if(!res.headersSent){json(res,error.status||500,{error:error.status?error.message:'服务器暂时无法完成操作，请检查服务器日志'});}else res.end();if(!error.status)console.error(new Date().toISOString(),error);}
});
server.requestTimeout=30000;server.headersTimeout=15000;
server.listen(port,host,()=>console.log(`跃迁工坊：http://${host}:${port} / ${password?'口令保护已启用':'本地开发模式（仅回环）'}`));
const cleanup=setInterval(()=>accounts.cleanup(),600000);cleanup.unref();
function shutdown(){server.close(()=>{db.close();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();}process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
