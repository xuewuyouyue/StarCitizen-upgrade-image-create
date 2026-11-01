const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const imageFilePattern=/^[0-9a-f-]{36}\.(?:jpg|jpeg|png|webp)$/i;
class OfflineError extends Error {constructor(status,message){super(message);this.status=status;}}
function invalid(message){throw new OfflineError(400,message);}
function object(value){if(!value||typeof value!=='object'||Array.isArray(value))invalid('数据格式无效');return value;}
function text(value,max,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))invalid(`文本格式错误或超过 ${max} 字限制`);return value.trim();}
function price(value){if(value==null)return null;if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>999999.99||Math.round(value*100)/100!==value)invalid('价格须为 0–999999.99 美元，最多保留两位小数，或留空');return value;}
function metadata(value){object(value);return {name:text(value.name,60,true),en:text(value.en??'',80),manufacturer:text(value.manufacturer??'',60),priceUsd:price(value.priceUsd)};}
function image(value){
  if(typeof value!=='string'||value.length>28*1024*1024)invalid('图片无效或过大');
  const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match||match[2].length%4!==0)invalid('请使用 JPG、PNG 或 WebP 图片');
  let prefix;try{prefix=atob(match[2].slice(0,16));}catch{invalid('图片内容无效');}
  const valid=match[1]==='jpeg'?prefix.startsWith('\xff\xd8\xff'):match[1]==='png'?prefix.startsWith('\x89PNG\r\n\x1a\n'):prefix.startsWith('RIFF')&&prefix.slice(8,12)==='WEBP';
  if(!valid)invalid('图片格式与内容不匹配');return value;
}
function publicShip(ship){const {deleted,...value}=ship;return value;}
function storageError(error){return new OfflineError(503,error?.name==='QuotaExceededError'?'本机存储空间不足，请清理空间后重试':'本机数据库不可用，请检查浏览器存储设置后重新打开扩展');}
async function bundledManifest(){const response=await fetch(new URL('./assets/ships/catalog.json',import.meta.url));if(!response.ok)throw new Error('无法读取内置图库');return response.json();}
function catalog(manifest){
  if(!manifest||manifest.schemaVersion!==1||!Array.isArray(manifest.ships))invalid('内置图库清单无效');
  const found=new Map();
  for(const value of manifest.ships){
    object(value);
    if(!uuidPattern.test(value.id)||found.has(value.id)||!imageFilePattern.test(value.file)||value.thumbnailFile!==value.file+'.webp')invalid('内置图库清单包含无效或重复舰船');
    found.set(value.id,{id:value.id,...metadata(value),imageUrl:'./assets/ships/images/'+value.file,thumbnailUrl:'./assets/ships/thumbnails/'+value.thumbnailFile,version:1,updatedAt:''});
  }
  return found;
}
function openDatabase(indexedDB,name){
  return new Promise((resolve,reject)=>{
    if(!indexedDB){reject(storageError());return;}
    let request,settled=false;
    const fail=error=>{if(!settled){settled=true;reject(storageError(error));}};
    try{request=indexedDB.open(name,1);}catch(error){reject(storageError(error));return;}
    request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('ships',{keyPath:'id'});db.createObjectStore('settings');};
    request.onerror=()=>fail(request.error);request.onblocked=()=>fail();
    request.onsuccess=()=>{if(settled){request.result.close();return;}settled=true;request.result.onversionchange=()=>request.result.close();resolve(request.result);};
  });
}
function transaction(db,storeName,mode,operation){
  return new Promise((resolve,reject)=>{
    let tx,result,failure;
    try{tx=db.transaction(storeName,mode);}catch(error){reject(storageError(error));return;}
    tx.oncomplete=()=>resolve(result);
    tx.onabort=()=>reject(failure||storageError(tx.error));
    tx.onerror=()=>{};
    const fail=error=>{failure=error instanceof OfflineError?error:storageError(error);tx.abort();};
    try{operation(tx.objectStore(storeName),value=>{result=value;},fail);}catch(error){fail(error);}
  });
}

export function createOfflineApi({indexedDB=globalThis.indexedDB,loadManifest=bundledManifest,dbName='wb-image-generator-offline',newId=()=>crypto.randomUUID(),now=()=>new Date().toISOString()}={}){
  let ready;
  const initialize=()=>ready??=Promise.all([Promise.resolve().then(loadManifest).then(catalog),openDatabase(indexedDB,dbName)]);
  return async function offlineApi(url,method='GET',body){
    const [bundled,db]=await initialize();
    if(url==='/api/settings'){
      if(method==='GET')return transaction(db,'settings','readonly',(store,done)=>{const request=store.get('current');request.onsuccess=()=>done(request.result??{version:0,value:{}});});
      if(method==='PUT'){
        object(body);object(body.value);let value;try{value=JSON.parse(JSON.stringify(body.value));}catch{invalid('配置数据无效');}
        return transaction(db,'settings','readwrite',(store,done,fail)=>{
          const request=store.get('current');request.onsuccess=()=>{const current=request.result??{version:0};if(body.version!==current.version){fail(new OfflineError(409,'配置已在其他标签页更新，请重新载入后再保存'));return;}const saved={version:current.version+1,value};store.put(saved,'current');done(saved);};
        });
      }
    }
    if(url==='/api/ships'){
      if(method==='GET')return transaction(db,'ships','readonly',(store,done)=>{const request=store.getAll();request.onsuccess=()=>{const merged=new Map(bundled);for(const ship of request.result)merged.set(ship.id,ship);done([...merged.values()].filter(ship=>!ship.deleted).map(publicShip));};});
      if(method==='POST'){
        const fields=metadata(body),src=image(body.image),id=newId();if(!uuidPattern.test(id)||bundled.has(id))invalid('无法创建舰船编号，请重试');
        const ship={id,...fields,imageUrl:src,thumbnailUrl:src,version:1,updatedAt:now()};
        return transaction(db,'ships','readwrite',(store,done)=>{store.add(ship);done(ship);});
      }
    }
    const match=/^\/api\/ships\/([^/]+)$/.exec(url);
    if(match&&(method==='PUT'||method==='DELETE')){
      const id=match[1];if(!uuidPattern.test(id))invalid('舰船编号无效');object(body);
      const fields=method==='PUT'?metadata(body):null,src=method==='PUT'&&Object.hasOwn(body,'image')?image(body.image):null;
      return transaction(db,'ships','readwrite',(store,done,fail)=>{
        const request=store.get(id);request.onsuccess=()=>{
          const current=request.result??bundled.get(id);
          if(!current||current.deleted){fail(new OfflineError(404,'舰船不存在或已移除'));return;}
          if(body.version!==current.version){fail(new OfflineError(409,'舰船已在其他标签页更新，请刷新图库后重新编辑'));return;}
          const ship={...current,...fields,version:current.version+1,updatedAt:now()};
          if(method==='DELETE')ship.deleted=true;
          if(src){ship.imageUrl=src;ship.thumbnailUrl=src;}
          store.put(ship);done(method==='DELETE'?{ok:true}:publicShip(ship));
        };
      });
    }
    throw new OfflineError(404,'离线版不支持此操作');
  };
}
export const offlineApi=createOfflineApi();
