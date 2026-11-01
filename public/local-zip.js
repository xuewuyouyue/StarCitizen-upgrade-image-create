const UINT32_MAX=0xffffffff,UINT16_MAX=0xffff;
const encoder=new TextEncoder();
const crcTable=Uint32Array.from({length:256},(_,value)=>{
  for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);
  return value>>>0;
});

function crc32(bytes){
  let crc=UINT32_MAX;
  for(const byte of bytes)crc=(crc>>>8)^crcTable[(crc^byte)&255];
  return (crc^UINT32_MAX)>>>0;
}

function filenameBytes(name){
  if(typeof name!=='string'||!name||/[\\:\u0000-\u001f\u007f]/u.test(name)||name.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('Invalid ZIP entry name');
  const bytes=encoder.encode(name);
  if(bytes.length>UINT16_MAX)throw new Error('ZIP entry name is too long');
  return bytes;
}

export class LocalZip{
  #entries=[];
  #parts=[];
  #localSize=0;
  #size=22;

  get size(){return this.#size;}
  get count(){return this.#entries.length;}

  #checkLimits(nameLength,size){
    if(this.count===UINT16_MAX)throw new Error('ZIP entry count exceeds ZIP32 limit');
    if(!Number.isSafeInteger(size)||size<0||size>UINT32_MAX)throw new Error('ZIP entry exceeds ZIP32 size limit');
    if(this.#size+size+76+nameLength*2>UINT32_MAX)throw new Error('ZIP archive exceeds ZIP32 size limit');
  }

  async add(name,blob){
    const nameBytes=filenameBytes(name);
    if(!(blob instanceof Blob))throw new TypeError('ZIP entry must be a Blob');
    const size=blob.size;
    this.#checkLimits(nameBytes.length,size);
    const bytes=new Uint8Array(await blob.arrayBuffer());
    if(bytes.length!==size)throw new Error('ZIP entry size does not match its data');
    const crc=crc32(bytes);
    this.#checkLimits(nameBytes.length,size);
    const header=new Uint8Array(30+nameBytes.length),view=new DataView(header.buffer);
    view.setUint32(0,0x04034b50,true);
    view.setUint16(4,20,true);
    view.setUint16(6,0x0800,true);
    view.setUint16(12,0x0021,true);
    view.setUint32(14,crc,true);
    view.setUint32(18,size,true);
    view.setUint32(22,size,true);
    view.setUint16(26,nameBytes.length,true);
    header.set(nameBytes,30);
    this.#entries.push({nameBytes,size,crc,offset:this.#localSize});
    this.#parts.push(header,blob);
    this.#localSize+=header.length+size;
    this.#size+=size+76+nameBytes.length*2;
  }

  finish(){
    const directory=this.#entries.map(({nameBytes,size,crc,offset})=>{
      const header=new Uint8Array(46+nameBytes.length),view=new DataView(header.buffer);
      view.setUint32(0,0x02014b50,true);
      view.setUint16(4,20,true);
      view.setUint16(6,20,true);
      view.setUint16(8,0x0800,true);
      view.setUint16(14,0x0021,true);
      view.setUint32(16,crc,true);
      view.setUint32(20,size,true);
      view.setUint32(24,size,true);
      view.setUint16(28,nameBytes.length,true);
      view.setUint32(42,offset,true);
      header.set(nameBytes,46);
      return header;
    });
    const end=new Uint8Array(22),view=new DataView(end.buffer);
    view.setUint32(0,0x06054b50,true);
    view.setUint16(8,this.count,true);
    view.setUint16(10,this.count,true);
    view.setUint32(12,this.#size-this.#localSize-22,true);
    view.setUint32(16,this.#localSize,true);
    return new Blob([...this.#parts,...directory,end],{type:'application/zip'});
  }
}
