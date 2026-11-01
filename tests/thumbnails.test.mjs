import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,statSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import sharp from 'sharp';
import {createThumbnails} from '../thumbnails.mjs';

const data=mkdtempSync(join(tmpdir(),'upgrade-studio-thumbnails-')),base='http://127.0.0.1:4219',password='thumbnail-test-password';
mkdirSync(join(data,'images'));
const store=createThumbnails(data),originals=new Map();
let processHandle,logs='',cookie='';
const filename=(number,extension='jpg')=>`00000000-0000-4000-8000-${String(number).padStart(12,'0')}.${extension}`;
async function fixture(number,format,width=1200,height=800,orientation){
  const pixels=Buffer.alloc(width*height*3);let seed=number;
  for(let index=0;index<pixels.length;index++){seed=(seed*1664525+1013904223)>>>0;pixels[index]=seed>>>24;}
  let encoder=sharp(pixels,{raw:{width,height,channels:3}});
  if(orientation)encoder=encoder.withMetadata({orientation});
  const bytes=await encoder.toFormat(format).toBuffer(),name=filename(number,format==='jpeg'?'jpg':format);
  writeFileSync(join(data,'images',name),bytes);originals.set(name,bytes);return name;
}
async function req(path,headers={}){return fetch(base+path,{headers:{Cookie:cookie,...headers}});}
before(async()=>{
  processHandle=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:'4219',DATA_DIR:data,APP_PASSWORD:password}});
  processHandle.stdout.on('data',chunk=>logs+=chunk);processHandle.stderr.on('data',chunk=>logs+=chunk);
  for(let attempt=0;attempt<100;attempt++){
    if(processHandle.exitCode!==null)throw Error(logs);
    try{if((await fetch(base+'/health')).ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw Error(logs||'Thumbnail test server did not start');
});
after(async()=>{
  if(processHandle?.exitCode===null){const ended=once(processHandle,'exit');processHandle.kill();await ended;}
  assert.equal(logs.includes(password),false);
  for(const [name,bytes]of originals)assert.deepEqual(readFileSync(join(data,'images',name)),bytes);
  assert.ok(data.startsWith(tmpdir()));rmSync(data,{recursive:true,force:true});
});

test('缩略图与原图均要求登录，管理员登录后可访问',async()=>{
  for(const path of ['/media/'+filename(1),'/thumbnails/'+filename(1)+'.webp'])assert.equal((await req(path)).status,401);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
  assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
});

test('JPG、PNG、WebP缩略图实际解码，保持比例且体积小于原图',async()=>{
  for(const [number,format,width,height,expected]of [[1,'jpeg',1200,800,[480,320]],[2,'png',800,1200,[213,320]],[3,'webp',1200,800,[480,320]]]){
    const name=await fixture(number,format,width,height),response=await req('/thumbnails/'+name+'.webp');
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');
    const bytes=Buffer.from(await response.arrayBuffer()),decoded=await sharp(bytes).metadata();
    assert.equal(decoded.format,'webp');assert.deepEqual([decoded.width,decoded.height],expected);
    assert.ok(bytes.length<originals.get(name).length/4);assert.equal(readdirSync(join(data,'thumbnails')).includes(name+'.webp'),true);
  }
});

test('EXIF方向应用后缩放，小图片不放大',async()=>{
  const rotated=await fixture(4,'jpeg',600,300,6),small=await fixture(5,'png',80,40);
  for(const [name,expected]of [[rotated,[160,320]],[small,[80,40]]]){
    const result=await store.ensure(name),metadata=await sharp(result.path).metadata();
    assert.deepEqual([metadata.width,metadata.height],expected);assert.equal(metadata.orientation,undefined);
  }
});

test('同一图片并发只生成一次，后续调用复用文件且不改写',async()=>{
  const name=await fixture(6,'png'),first=store.ensure(name),other=store.ensure(name);
  assert.equal(first,other);
  const [a,b]=await Promise.all([first,other]);assert.equal(a,b);assert.equal(a.generated,true);
  const before=statSync(a.path),bytes=readFileSync(a.path),again=await store.ensure(name);
  assert.equal(again.generated,false);assert.equal(statSync(a.path).mtimeMs,before.mtimeMs);assert.deepEqual(readFileSync(a.path),bytes);
  assert.equal(readdirSync(join(data,'thumbnails')).filter(value=>value.startsWith(name)).length,1);
});

test('无效文件名和缺失原图拒绝访问，残留缩略图不能绕过原图检查',async()=>{
  for(const name of ['../server.mjs','bad.jpg','0000.jpg','00000000-0000-4000-8000-000000000999.jpeg'])await assert.rejects(store.ensure(name),{code:'ENOENT'});
  const name=filename(999);writeFileSync(join(data,'thumbnails',name+'.webp'),Buffer.from('orphan thumbnail'));
  assert.equal((await req('/thumbnails/'+name+'.webp')).status,404);
  for(const path of ['/thumbnails/bad.jpg.webp','/thumbnails/%2e%2e%2fserver.mjs.webp','/thumbnails/'+filename(1)+'.webp/extra','/thumbnails/'+filename(1)+'.png'])assert.equal((await req(path)).status,404);
});

test('解码失败无临时文件，队列继续处理后续图片且失败项允许重试',async()=>{
  const broken=filename(7),valid=await fixture(8,'jpeg');
  writeFileSync(join(data,'images',broken),Buffer.from('invalid image bytes'));
  const outcomes=await Promise.allSettled([store.ensure(broken),store.ensure(valid)]);
  assert.equal(outcomes[0].status,'rejected');assert.equal(outcomes[1].status,'fulfilled');
  assert.equal(readdirSync(join(data,'thumbnails')).some(name=>name.startsWith(broken)),false);
  assert.equal((await req('/thumbnails/'+broken+'.webp')).status,500);
  writeFileSync(join(data,'images',broken),originals.get(valid));originals.set(broken,originals.get(valid));
  assert.equal((await req('/thumbnails/'+broken+'.webp')).status,200);
  assert.equal(readdirSync(join(data,'thumbnails')).some(name=>name.endsWith('.tmp')),false);
});

test('原图和缩略图使用私有持久缓存并支持304，鉴权在缓存校验之前',async()=>{
  for(const path of ['/media/'+filename(1),'/thumbnails/'+filename(1)+'.webp']){
    const response=await req(path),bytes=await response.arrayBuffer(),etag=response.headers.get('etag');
    assert.equal(response.status,200);assert.ok(bytes.byteLength);assert.ok(etag);assert.equal(response.headers.get('cache-control'),'private, max-age=31536000, immutable');
    const cached=await req(path,{'If-None-Match':etag});assert.equal(cached.status,304);assert.equal((await cached.arrayBuffer()).byteLength,0);assert.equal(cached.headers.get('etag'),etag);
    assert.equal((await req(path,{'If-None-Match':'"different", '+etag})).status,304);
    assert.equal((await req(path,{'If-None-Match':'"different"'})).status,200);
    assert.equal((await fetch(base+path,{headers:{'If-None-Match':etag}})).status,401);
  }
});

test('上传和替换图片返回对应的独立缩略图URL，原图字节不变',async()=>{
  const upload=async(path,method,value)=>fetch(base+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(value)});
  const image='data:image/jpeg;base64,'+originals.get(filename(1)).toString('base64');
  const createdResponse=await upload('/api/ships','POST',{name:'Thumbnail ship',image,priceUsd:140});assert.equal(createdResponse.status,201);const created=await createdResponse.json();
  assert.equal(created.thumbnailUrl,'/thumbnails/'+created.imageUrl.split('/').pop()+'.webp');assert.equal((await req(created.thumbnailUrl)).status,200);
  const replacedResponse=await upload('/api/ships/'+created.id,'PUT',{version:created.version,name:created.name,en:'',manufacturer:'',image,priceUsd:140});assert.equal(replacedResponse.status,200);const replaced=await replacedResponse.json();
  assert.notEqual(replaced.imageUrl,created.imageUrl);assert.notEqual(replaced.thumbnailUrl,created.thumbnailUrl);assert.equal((await req(replaced.thumbnailUrl)).status,200);
  for(const ship of [created,replaced])assert.deepEqual(Buffer.from(await(await req(ship.imageUrl)).arrayBuffer()),originals.get(filename(1)));
});

test('预生成CLI复用已有缩略图，输出字节统计且不修改原图或数据库',()=>{
  const database=readFileSync(join(data,'studio.sqlite')),before=new Map(readdirSync(join(data,'images')).map(name=>[name,readFileSync(join(data,'images',name))]));
  const run=spawnSync(process.execPath,['scripts/generate-thumbnails.mjs',data],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);const stats=JSON.parse(run.stdout.trim());
  assert.equal(stats.failed,0);assert.equal(stats.files,before.size);assert.equal(stats.generated,0);assert.equal(stats.reused,before.size);
  assert.equal(stats.originalBytes,[...before.values()].reduce((total,bytes)=>total+bytes.length,0));assert.ok(stats.thumbnailBytes>0);assert.ok(stats.thumbnailBytes<stats.originalBytes);
  for(const [name,bytes]of before)assert.deepEqual(readFileSync(join(data,'images',name)),bytes);assert.deepEqual(readFileSync(join(data,'studio.sqlite')),database);
});
