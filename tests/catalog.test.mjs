import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseShipFilename} from '../public/ship-filename.js';
import {importCache} from '../scripts/import-cache.mjs';

test('filename metadata preserves hyphenated names, zero, decimals and unknown prices',()=>{
  for(const [file,name,price] of [['Ares Ion-250.jpg','Ares Ion',250],['ROC-DS-75.jpg','ROC-DS',75],['Khartu-Al-175.jpg','Khartu-Al',175],['F7A Hornet Mk II-NA.jpg','F7A Hornet Mk II',null],['Ship-0.png','Ship',0],['Ship-125.50.webp','Ship',125.5],['My ship.jpg','My ship',null]])assert.deepEqual(parseShipFilename(file),{name,priceUsd:price});
});
test('cache import is backed up, additive, idempotent and verifies hashes before writes',()=>{
  const root=mkdtempSync(join(tmpdir(),'upgrade-catalog-')),dataDir=join(root,'data'),source=join(root,'cache');
  try{
    for(const path of [dataDir,source,join(dataDir,'images'),join(dataDir,'backups')])mkdirSync(path);
    const db=new DatabaseSync(join(dataDir,'studio.sqlite'));
    db.exec("CREATE TABLE ships(id TEXT PRIMARY KEY,name TEXT,en TEXT,manufacturer TEXT,image TEXT,priceCents INTEGER,version INTEGER DEFAULT 1,deleted INTEGER DEFAULT 0,updatedAt TEXT); CREATE TABLE settings(id INTEGER PRIMARY KEY,value TEXT,version INTEGER); INSERT INTO settings VALUES(1,'{\"shop\":\"Keep\"}',2)");
    db.prepare('INSERT INTO ships VALUES(?,?,?,?,?,?,2,0,?)').run('custom','弩炮 · 示例','Ballista','User','custom.jpg',14000,'unchanged');
    writeFileSync(join(dataDir,'images','custom.jpg'),'keep');
    const image=Buffer.from('ffd8ff'+'01'.repeat(40),'hex');writeFileSync(join(source,'Ballista-140.jpg'),image);
    const manifest={ships:[{name:'Ballista',priceUsd:140,file:'Ballista-140.jpg',sha256:createHash('sha256').update(image).digest('hex')}]};
    const save=()=>writeFileSync(join(source,'manifest.json'),JSON.stringify(manifest));save();
    assert.equal(importCache(source,null,{dataDir}).planned.length,1);assert.equal(db.prepare('SELECT count(*) n FROM ships').get().n,1);
    symlinkSync(fileURLToPath(new URL('..',import.meta.url)),join(root,'release'),'junction');
    const cli=spawnSync(process.execPath,[join(root,'release','scripts','import-cache.mjs'),source],{env:{...process.env,DATA_DIR:dataDir},encoding:'utf8'});
    assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).planned.length,1);
    const first=importCache(source,join(root,'backup-1'),{dataDir,apply:true});
    assert.equal(first.added.length,1);assert.equal(first.afterCount,2);assert.equal(first.existingRowsUnchanged,true);assert.equal(first.settingsUnchanged,true);
    const snapshot=new DatabaseSync(join(root,'backup-1','studio.sqlite'),{readOnly:true});assert.equal(snapshot.prepare('SELECT count(*) n FROM ships').get().n,1);snapshot.close();
    assert.equal(readFileSync(join(dataDir,'images',first.added[0].image)).equals(image),true);
    const second=importCache(source,join(root,'backup-2'),{dataDir,apply:true});assert.equal(second.added.length,0);assert.equal(second.skipped.length,1);
    manifest.ships[0].sha256='wrong';save();assert.throws(()=>importCache(source,join(root,'invalid-backup'),{dataDir,apply:true}),/checksum/);assert.equal(db.prepare('SELECT count(*) n FROM ships').get().n,2);
    db.close();
  }finally{rmSync(root,{recursive:true,force:true});}
});
