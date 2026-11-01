import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalZip} from '../public/local-zip.js';

function checksum(bytes){
  let crc=0xffffffff;
  for(const byte of bytes){
    crc^=byte;
    for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}

async function readArchive(blob){
  const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),end=bytes.length-22;
  assert.equal(blob.type,'application/zip');
  assert.equal(view.getUint32(end,true),0x06054b50);
  assert.equal(view.getUint16(end+4,true),0);
  assert.equal(view.getUint16(end+6,true),0);
  assert.equal(view.getUint16(end+20,true),0);
  const count=view.getUint16(end+10,true),directorySize=view.getUint32(end+12,true),directoryOffset=view.getUint32(end+16,true);
  assert.equal(view.getUint16(end+8,true),count);
  assert.equal(directoryOffset+directorySize,end);
  const entries=[];
  let cursor=directoryOffset,localEnd=0;
  for(let index=0;index<count;index++){
    assert.equal(view.getUint32(cursor,true),0x02014b50);
    assert.equal(view.getUint16(cursor+8,true),0x0800);
    assert.equal(view.getUint16(cursor+10,true),0);
    const crc=view.getUint32(cursor+16,true),size=view.getUint32(cursor+20,true),nameLength=view.getUint16(cursor+28,true),extraLength=view.getUint16(cursor+30,true),commentLength=view.getUint16(cursor+32,true),offset=view.getUint32(cursor+42,true);
    assert.equal(view.getUint32(cursor+24,true),size);
    assert.equal(offset,localEnd);
    assert.equal(view.getUint32(offset,true),0x04034b50);
    assert.equal(view.getUint16(offset+6,true),0x0800);
    assert.equal(view.getUint16(offset+8,true),0);
    assert.equal(view.getUint16(offset+12,true),0x0021);
    assert.equal(view.getUint32(offset+14,true),crc);
    assert.equal(view.getUint32(offset+18,true),size);
    assert.equal(view.getUint32(offset+22,true),size);
    assert.equal(view.getUint16(offset+26,true),nameLength);
    assert.equal(view.getUint16(offset+28,true),0);
    const nameBytes=bytes.subarray(cursor+46,cursor+46+nameLength),localName=bytes.subarray(offset+30,offset+30+nameLength),payload=bytes.slice(offset+30+nameLength,offset+30+nameLength+size);
    assert.deepEqual(localName,nameBytes);
    assert.equal(checksum(payload),crc);
    entries.push({name:new TextDecoder('utf-8',{fatal:true}).decode(nameBytes),payload,crc});
    cursor+=46+nameLength+extraLength+commentLength;
    localEnd=offset+30+nameLength+size;
  }
  assert.equal(cursor,end);
  assert.equal(localEnd,directoryOffset);
  return entries;
}

test('local ZIP stores UTF-8 names, original binary payloads and valid CRC/offsets',async()=>{
  const zip=new LocalZip(),first=new Uint8Array([0,1,2,128,255]),second=new TextEncoder().encode('123456789');
  await zip.add('舰船图片/极光 → 仙女座.png',new Blob([first]));
  await zip.add('upgrade-02.jpg',new Blob([second]));
  const blob=zip.finish(),entries=await readArchive(blob);
  assert.equal(zip.count,2);
  assert.equal(zip.size,blob.size);
  assert.deepEqual(entries.map(entry=>entry.name),['舰船图片/极光 → 仙女座.png','upgrade-02.jpg']);
  assert.deepEqual(entries[0].payload,first);
  assert.deepEqual(entries[1].payload,second);
  assert.equal(entries[1].crc,0xcbf43926);
});

test('empty ZIP and repeated finish are valid and finishing does not clear entries',async()=>{
  const zip=new LocalZip();
  assert.equal(zip.count,0);assert.equal(zip.size,22);
  assert.deepEqual(await readArchive(zip.finish()),[]);
  await zip.add('one.png',new Blob());
  const first=zip.finish(),again=zip.finish();
  assert.deepEqual(await first.arrayBuffer(),await again.arrayBuffer());
  await zip.add('two.png',new Blob(['two']));
  assert.equal((await readArchive(first)).length,1);
  assert.equal((await readArchive(zip.finish())).length,2);
  assert.equal(zip.size,zip.finish().size);
});

test('entry names reject absolute paths, traversal and unsafe control characters',async()=>{
  const zip=new LocalZip();
  for(const name of ['',null,13,'/absolute.png','C:/absolute.png','C:\\absolute.png','../bad.png','a/../bad.png','./bad.png','a/./bad.png','a//bad.png','a/','a\\bad.png','a\0bad.png','a\nbad.png'])await assert.rejects(zip.add(name,new Blob()),/Invalid ZIP entry name/);
  assert.equal(zip.count,0);assert.equal(zip.size,22);
  await assert.rejects(zip.add('valid.png',new Uint8Array()),/must be a Blob/);
});

test('filename lengths use UTF-8 bytes and preserve the ZIP32 name boundary',async()=>{
  const zip=new LocalZip(),name='船'.repeat(21845);
  await zip.add(name,new Blob(['x']));
  assert.equal((await readArchive(zip.finish()))[0].name,name);
  await assert.rejects(zip.add(`${name}x`,new Blob()),/name is too long/);
  await assert.rejects(zip.add('a'.repeat(65536),new Blob()),/name is too long/);
  assert.equal(zip.count,1);
});

test('ZIP32 size limits reject before reading or allocating large payloads',async()=>{
  let reads=0;
  class DeclaredBlob extends Blob{
    constructor(size){super();this.declaredSize=size;}
    get size(){return this.declaredSize;}
    async arrayBuffer(){reads++;throw new Error('Large data must not be read');}
  }
  const zip=new LocalZip();
  await assert.rejects(zip.add('large.png',new DeclaredBlob(0x100000000)),/entry exceeds ZIP32/);
  await assert.rejects(zip.add('large.png',new DeclaredBlob(0xffffffff)),/archive exceeds ZIP32/);
  await zip.add('first.png',new Blob(['abc']));
  const before=zip.size;
  await assert.rejects(zip.add('next.png',new DeclaredBlob(0xffffffff-before-76-16+1)),/archive exceeds ZIP32/);
  assert.equal(reads,0);assert.equal(zip.count,1);assert.equal(zip.size,before);
});

test('ZIP32 permits 65535 entries and rejects an additional entry without mutation',async()=>{
  const zip=new LocalZip(),empty=new Blob();
  for(let index=0;index<65535;index++)await zip.add(`${index}.png`,empty);
  const before=zip.size;
  await assert.rejects(zip.add('overflow.png',empty),/entry count exceeds ZIP32/);
  assert.equal(zip.count,65535);assert.equal(zip.size,before);
  const blob=zip.finish(),end=new DataView(await blob.slice(-22).arrayBuffer());
  assert.equal(end.getUint16(10,true),65535);
  assert.equal(blob.size,before);
});
