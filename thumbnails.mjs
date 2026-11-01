import sharp from 'sharp';
import {mkdirSync} from 'node:fs';
import {access,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

sharp.concurrency(1);
sharp.cache({memory:16,files:0,items:8});
export const imageFilenamePattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function createThumbnails(dataDir){
  const directory=join(dataDir,'thumbnails'),pending=new Map();
  mkdirSync(directory,{recursive:true});
  let queue=Promise.resolve();
  function ensure(filename){
    if(!imageFilenamePattern.test(filename))return Promise.reject(Object.assign(new Error('Invalid image filename'),{code:'ENOENT'}));
    if(pending.has(filename))return pending.get(filename);
    const task=queue.then(async()=>{
      const source=join(dataDir,'images',filename),path=join(directory,filename+'.webp');
      await access(source);
      try{await access(path);return {path,generated:false};}catch(error){if(error.code!=='ENOENT')throw error;}
      const temporary=path+'.'+randomUUID()+'.tmp';
      try{
        await sharp(source,{limitInputPixels:64*1024*1024}).rotate().resize({width:480,height:320,fit:'inside',withoutEnlargement:true}).webp({quality:72}).toFile(temporary);
        await rename(temporary,path);
      }catch(error){await unlink(temporary).catch(()=>{});throw error;}
      return {path,generated:true};
    });
    pending.set(filename,task);
    queue=task.catch(()=>{});
    task.then(()=>pending.delete(filename),()=>pending.delete(filename));
    return task;
  }
  return {ensure};
}
