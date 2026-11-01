import {DatabaseSync} from 'node:sqlite';
import {readFileSync,copyFileSync,unlinkSync,writeFileSync,chmodSync,chownSync,statSync,realpathSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const key=value=>value.normalize('NFKC').trim().toLowerCase();
export function importCache(source,backupDirectory,{dataDir=process.env.DATA_DIR||'data',apply=false}={}){
  source=resolve(source);dataDir=resolve(dataDir);
  const manifest=JSON.parse(readFileSync(join(source,'manifest.json'),'utf8'));
  if(!Array.isArray(manifest.ships)||!manifest.ships.length)throw new Error('Empty import manifest');
  const names=new Set(),entries=manifest.ships.map(item=>{
    if(typeof item.name!=='string'||!item.name.trim()||item.name.length>60||names.has(key(item.name)))throw new Error('Invalid or duplicate ship name');
    names.add(key(item.name));
    if(typeof item.file!=='string'||basename(item.file)!==item.file||!/^.+\.jpg$/i.test(item.file))throw new Error('Invalid image filename');
    const price=item.priceUsd;
    if(price!==null&&(typeof price!=='number'||!Number.isFinite(price)||price<0||price>999999.99||Math.round(price*100)/100!==price))throw new Error('Invalid price');
    const path=join(source,item.file),bytes=readFileSync(path),sha256=createHash('sha256').update(bytes).digest('hex');
    if(bytes.length<16||bytes.length>6*1024*1024||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||sha256!==item.sha256)throw new Error('Invalid JPEG or checksum: '+item.file);
    return {...item,name:item.name.trim(),path,sha256};
  });
  const db=new DatabaseSync(join(dataDir,'studio.sqlite'));db.exec('PRAGMA busy_timeout=10000');
  const existing=db.prepare('SELECT * FROM ships ORDER BY id').all(),settings=db.prepare('SELECT * FROM settings ORDER BY id').all();
  const known=new Set(existing.map(s=>key(s.name))),planned=entries.filter(s=>!known.has(key(s.name)));
  const report={createdAt:new Date().toISOString(),source:manifest.source||'User supplied cache',total:entries.length,added:[],skipped:entries.filter(s=>known.has(key(s.name))).map(s=>({name:s.name,reason:'Existing name retained, including deleted records'})),beforeCount:existing.filter(s=>!s.deleted).length};
  if(!apply){db.close();return {...report,dryRun:true,planned:planned.map(s=>({name:s.name,priceUsd:s.priceUsd}))};}
  if(!backupDirectory){db.close();throw new Error('An external backup directory is required');}
  const backup=resolve(backupDirectory),result=spawnSync(process.execPath,[fileURLToPath(new URL('./backup.mjs',import.meta.url)),backup],{env:{...process.env,DATA_DIR:dataDir},encoding:'utf8'});
  if(result.status!==0){db.close();throw new Error('Backup failed: '+result.stderr);}
  const copied=[],owner=statSync(dataDir);let committed=false;
  try{
    db.exec('BEGIN IMMEDIATE');
    if(JSON.stringify(db.prepare('SELECT * FROM ships ORDER BY id').all())!==JSON.stringify(existing)||JSON.stringify(db.prepare('SELECT * FROM settings ORDER BY id').all())!==JSON.stringify(settings))throw new Error('Data changed during backup; retry with a new backup');
    const insert=db.prepare('INSERT INTO ships(id,name,en,manufacturer,image,priceCents,updatedAt) VALUES(?,?,?,?,?,?,?)');
    for(const ship of planned){
      const id=randomUUID(),image=randomUUID()+'.jpg',destination=join(dataDir,'images',image);
      copyFileSync(ship.path,destination);copied.push(destination);chmodSync(destination,0o600);
      if(process.platform!=='win32'&&process.getuid()===0)chownSync(destination,owner.uid,owner.gid);
      insert.run(id,ship.name,ship.name,'',image,ship.priceUsd===null?null:Math.round(ship.priceUsd*100),report.createdAt);
      report.added.push({id,name:ship.name,priceUsd:ship.priceUsd,image,sourceFile:ship.file,sha256:ship.sha256});
    }
    db.exec('COMMIT');committed=true;
    report.afterCount=db.prepare('SELECT count(*) AS count FROM ships WHERE deleted=0').get().count;
    report.existingRowsUnchanged=existing.every(row=>JSON.stringify(db.prepare('SELECT * FROM ships WHERE id=?').get(row.id))===JSON.stringify(row));
    report.settingsUnchanged=JSON.stringify(db.prepare('SELECT * FROM settings ORDER BY id').all())===JSON.stringify(settings);
    writeFileSync(join(backup,'import-result.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
    return report;
  }catch(error){if(!committed){db.exec('ROLLBACK');for(const path of copied)unlinkSync(path);}throw error;}
  finally{db.close();}
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
  const [source,backup,flag]=process.argv.slice(2);
  if(!source)throw new Error('Usage: node scripts/import-cache.mjs /cache /external/backup [--apply]');
  const report=importCache(source,backup,{apply:flag==='--apply'});
  console.log(JSON.stringify(report,null,2));
}
