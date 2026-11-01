import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {seedCatalog} from '../scripts/seed-catalog.mjs';

function fixture(){
  const root=mkdtempSync(join(tmpdir(),'wb-seed-')),source=join(root,'source'),dataDir=join(root,'data');
  mkdirSync(join(source,'images'),{recursive:true});mkdirSync(join(source,'thumbnails'));
  const ships=[];
  function add(name='极光 Mk I CL',en='Aurora Mk I CL',priceUsd=45.5){
    const file=randomUUID()+'.jpg',original=Buffer.from('original-'+file),thumbnail=Buffer.from('thumbnail-'+file);
    const ship={id:randomUUID(),name,en,manufacturer:'RSI',priceUsd,file,sha256:createHash('sha256').update(original).digest('hex'),thumbnailFile:file+'.webp',thumbnailSha256:createHash('sha256').update(thumbnail).digest('hex')};
    writeFileSync(join(source,'images',file),original);writeFileSync(join(source,'thumbnails',ship.thumbnailFile),thumbnail);ships.push(ship);save();return ship;
  }
  function save(){writeFileSync(join(source,'manifest.json'),JSON.stringify({schemaVersion:1,ships}));}
  add();return {root,source,dataDir,ships,add,save,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

test('seed initializes bilingual catalog, prices and both asset sizes without users',async()=>{
  const f=fixture();try{
    const report=await seedCatalog(f);assert.equal(report.added,1);assert.equal(report.backup,null);
    const db=new DatabaseSync(join(f.dataDir,'studio.sqlite'));
    try{
      const row=db.prepare('SELECT * FROM ships').get(),ship=f.ships[0];assert.equal(row.name,ship.name);assert.equal(row.en,ship.en);assert.equal(row.priceCents,4550);assert.equal(row.image,ship.file);
      assert.deepEqual(db.prepare('SELECT value,version FROM settings').get(),{__proto__:null,value:'{}',version:0});
      assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='users'").get().n,0);
      for(const [folder,file] of [['images',ship.file],['thumbnails',ship.thumbnailFile]])assert.deepEqual(readFileSync(join(f.dataDir,folder,file)),readFileSync(join(f.source,folder,file)));
    }finally{db.close();}
  }finally{f.cleanup();}
});

test('repeated seed preserves edits, deletion tombstones, normalized names and private tables',async()=>{
  const f=fixture();try{
    await seedCatalog(f);const deleted=f.add('弩炮','Ballista',140);await seedCatalog(f);
    const db=new DatabaseSync(join(f.dataDir,'studio.sqlite'));
    db.prepare("UPDATE ships SET name='手动修改',priceCents=12345,version=7 WHERE id=?").run(f.ships[0].id);
    db.prepare('UPDATE ships SET deleted=1 WHERE id=?').run(deleted.id);
    db.exec("CREATE TABLE users(id TEXT,email TEXT);INSERT INTO users VALUES('local','keep@example.test');UPDATE settings SET value='{\"shop\":\"Keep\"}',version=4");db.close();
    const duplicate={...f.ships[0],id:randomUUID(),name:'不同中文',en:'  Ａｕｒｏｒａ Ｍｋ Ｉ ＣＬ  '};f.ships[0]=duplicate;f.save();
    const before=readdirSync(join(f.dataDir,'backups')).length,report=await seedCatalog(f);assert.equal(report.added,0);assert.equal(report.skipped,2);assert.equal(report.backup,null);assert.equal(readdirSync(join(f.dataDir,'backups')).length,before);
    const check=new DatabaseSync(join(f.dataDir,'studio.sqlite'));try{
      const rows=check.prepare('SELECT * FROM ships').all();assert.equal(rows.length,2);assert.equal(rows[0].name,'手动修改');assert.equal(rows[0].priceCents,12345);assert.equal(rows[0].version,7);assert.equal(rows[1].deleted,1);
      assert.equal(check.prepare('SELECT email FROM users').get().email,'keep@example.test');assert.equal(check.prepare('SELECT version FROM settings').get().version,4);
    }finally{check.close();}
  }finally{f.cleanup();}
});

test('all checksums and safe filenames are validated before any runtime data is written',async()=>{
  const f=fixture();try{
    f.add('第二艘','Second',100);f.ships[1].thumbnailSha256='0'.repeat(64);f.save();
    await assert.rejects(seedCatalog(f),/checksum mismatch/);assert.equal(existsSync(f.dataDir),false);
    f.ships[1].thumbnailSha256=createHash('sha256').update(readFileSync(join(f.source,'thumbnails',f.ships[1].thumbnailFile))).digest('hex');f.ships[1].file='../outside.jpg';f.save();
    await assert.rejects(seedCatalog(f),/Invalid catalog/);assert.equal(existsSync(f.dataDir),false);
  }finally{f.cleanup();}
});

test('append backs up the full existing database and refuses conflicting destination files',async()=>{
  const f=fixture();try{
    await seedCatalog(f);const db=new DatabaseSync(join(f.dataDir,'studio.sqlite'));db.exec("CREATE TABLE users(id TEXT);INSERT INTO users VALUES('preserved')");db.close();
    const added=f.add('财富','Fortune',175),report=await seedCatalog(f);assert.equal(report.added,1);assert.ok(report.backup);
    const restore=new DatabaseSync(report.backup,{readOnly:true});try{assert.equal(restore.prepare('SELECT count(*) n FROM ships').get().n,1);assert.equal(restore.prepare('SELECT id FROM users').get().id,'preserved');}finally{restore.close();}
    const conflict=f.add('第三艘','Third',200),target=join(f.dataDir,'images',conflict.file);writeFileSync(target,'existing different bytes');
    const before=readdirSync(join(f.dataDir,'backups')).length;await assert.rejects(seedCatalog(f),/checksum mismatch/);assert.equal(readFileSync(target,'utf8'),'existing different bytes');assert.equal(readdirSync(join(f.dataDir,'backups')).length,before);
    const check=new DatabaseSync(join(f.dataDir,'studio.sqlite'));try{assert.equal(check.prepare('SELECT count(*) n FROM ships').get().n,2);assert.equal(check.prepare('SELECT name FROM ships WHERE id=?').get(added.id).name,'财富');}finally{check.close();}
  }finally{f.cleanup();}
});

test('failed database insert rolls back the batch and removes only its new asset files',async()=>{
  const f=fixture();try{
    await seedCatalog(f);const first=f.add('第二艘','Second',100),second=f.add('第三艘','Third',200);
    const db=new DatabaseSync(join(f.dataDir,'studio.sqlite'));db.exec("CREATE TRIGGER reject_third BEFORE INSERT ON ships WHEN NEW.en='Third' BEGIN SELECT RAISE(ABORT,'test rejection'); END");db.close();
    await assert.rejects(seedCatalog(f),/test rejection/);
    const check=new DatabaseSync(join(f.dataDir,'studio.sqlite'));try{assert.equal(check.prepare('SELECT count(*) n FROM ships').get().n,1);}finally{check.close();}
    for(const ship of [first,second])for(const [folder,file] of [['images',ship.file],['thumbnails',ship.thumbnailFile]])assert.equal(existsSync(join(f.dataDir,folder,file)),false);
    assert.equal(existsSync(join(f.dataDir,'images',f.ships[0].file)),true);
  }finally{f.cleanup();}
});
