import {DatabaseSync,backup as sqliteBackup} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdirSync,existsSync,unlinkSync,realpathSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const image=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const checksum=/^[0-9a-f]{64}$/,key=value=>value.normalize('NFKC').trim().toLowerCase();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const schema=`CREATE TABLE IF NOT EXISTS ships(id TEXT PRIMARY KEY,name TEXT NOT NULL,en TEXT NOT NULL DEFAULT '',manufacturer TEXT NOT NULL DEFAULT '',image TEXT NOT NULL,priceCents INTEGER,version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,updatedAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO settings(id,value,version) VALUES(1,'{}',0);`;
function text(value,max,required=false){return typeof value==='string'&&value.length<=max&&(!required||value.trim().length>0);}
function verifiedFile(path,expected){const bytes=readFileSync(path);if(hash(bytes)!==expected)throw new Error('Asset checksum mismatch: '+path);return bytes;}
function rows(db){return db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ships'").get()?db.prepare('SELECT * FROM ships ORDER BY id').all():[];}
function plan(entries,existing){
  const ids=new Set(existing.map(ship=>key(ship.id))),names=new Set(existing.flatMap(ship=>[ship.name,ship.en].filter(Boolean).map(key)));
  return entries.filter(ship=>!ids.has(key(ship.id))&&!names.has(key(ship.name))&&!names.has(key(ship.en)));
}

export async function seedCatalog({source=join(root,'assets','ships'),dataDir=process.env.DATA_DIR||join(root,'data')}={}){
  source=resolve(source);dataDir=resolve(dataDir);
  const manifest=JSON.parse(readFileSync(join(source,'manifest.json'),'utf8'));
  if(manifest.schemaVersion!==1||!Array.isArray(manifest.ships)||!manifest.ships.length)throw new Error('Invalid catalog manifest');
  const ids=new Set(),files=new Set(),names=new Set();
  const entries=manifest.ships.map(ship=>{
    if(!ship||!uuid.test(ship.id)||!image.test(ship.file)||ship.thumbnailFile!==ship.file+'.webp'||!checksum.test(ship.sha256)||!checksum.test(ship.thumbnailSha256))throw new Error('Invalid catalog identifier, filename or checksum');
    if(!text(ship.name,60,true)||!text(ship.en,80,true)||!text(ship.manufacturer,60))throw new Error('Invalid catalog text');
    if(ship.priceUsd!==null&&(typeof ship.priceUsd!=='number'||!Number.isFinite(ship.priceUsd)||ship.priceUsd<0||ship.priceUsd>999999.99||Math.round(ship.priceUsd*100)/100!==ship.priceUsd))throw new Error('Invalid catalog price');
    const shipNames=new Set([key(ship.name),key(ship.en)]);
    if(ids.has(ship.id)||files.has(ship.file)||[...shipNames].some(name=>names.has(name)))throw new Error('Duplicate catalog ship');
    ids.add(ship.id);files.add(ship.file);for(const name of shipNames)names.add(name);
    verifiedFile(join(source,'images',ship.file),ship.sha256);verifiedFile(join(source,'thumbnails',ship.thumbnailFile),ship.thumbnailSha256);
    return {...ship,name:ship.name.trim(),en:ship.en.trim(),manufacturer:ship.manufacturer.trim()};
  });
  const database=join(dataDir,'studio.sqlite'),hadDatabase=existsSync(database);
  let existing=[],db,backup=null;
  if(hadDatabase){db=new DatabaseSync(database,{readOnly:true});try{existing=rows(db);}finally{db.close();}}
  const planned=plan(entries,existing),report={total:entries.length,added:0,skipped:entries.length-planned.length,backup:null};
  if(!planned.length)return report;
  for(const ship of planned)for(const [folder,file,expected] of [['images',ship.file,ship.sha256],['thumbnails',ship.thumbnailFile,ship.thumbnailSha256]]){
    const destination=join(dataDir,folder,file);if(existsSync(destination))verifiedFile(destination,expected);
  }
  for(const folder of ['', 'images','thumbnails','backups'])mkdirSync(join(dataDir,folder),{recursive:true});
  db=new DatabaseSync(database);db.exec('PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;');
  const copied=[];let transaction=false,committed=false;
  try{
    if(hadDatabase){backup=join(dataDir,'backups',`before-seed-${Date.now()}-${randomUUID()}.sqlite`);await sqliteBackup(db,backup);report.backup=backup;}
    db.exec('BEGIN IMMEDIATE');transaction=true;
    if(JSON.stringify(rows(db))!==JSON.stringify(existing))throw new Error('Catalog changed during backup; retry seeding');
    db.exec(schema);
    const insert=db.prepare('INSERT INTO ships(id,name,en,manufacturer,image,priceCents,updatedAt) VALUES(?,?,?,?,?,?,?)'),now=new Date().toISOString();
    for(const ship of planned){
      for(const [folder,file,expected] of [['images',ship.file,ship.sha256],['thumbnails',ship.thumbnailFile,ship.thumbnailSha256]]){
        const destination=join(dataDir,folder,file);
        if(existsSync(destination)){verifiedFile(destination,expected);continue;}
        const bytes=verifiedFile(join(source,folder,file),expected);writeFileSync(destination,bytes,{flag:'wx',mode:0o600});copied.push(destination);
      }
      insert.run(ship.id,ship.name,ship.en,ship.manufacturer,ship.file,ship.priceUsd===null?null:Math.round(ship.priceUsd*100),now);
    }
    db.exec('COMMIT');committed=true;report.added=planned.length;return report;
  }catch(error){
    if(transaction&&!committed)db.exec('ROLLBACK');
    for(const path of copied)unlinkSync(path);
    throw error;
  }finally{db.close();if(!hadDatabase&&!committed)for(const path of [database,database+'-wal',database+'-shm'])if(existsSync(path))unlinkSync(path);}
}

if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length>3)throw new Error('Usage: node scripts/seed-catalog.mjs [assets-directory]');
  console.log(JSON.stringify(await seedCatalog({source:process.argv[2]}),null,2));
}
