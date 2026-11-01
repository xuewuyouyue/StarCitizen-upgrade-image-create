import {readdir,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createThumbnails,imageFilenamePattern} from '../thumbnails.mjs';

const dataDir=resolve(process.argv[2]||process.env.DATA_DIR||fileURLToPath(new URL('../data',import.meta.url)));
const thumbnails=createThumbnails(dataDir),result={files:0,generated:0,reused:0,failed:0,originalBytes:0,thumbnailBytes:0};
for(const filename of (await readdir(join(dataDir,'images'))).filter(name=>imageFilenamePattern.test(name)).sort()){
  result.files++;
  result.originalBytes+=(await stat(join(dataDir,'images',filename))).size;
  try{
    const thumbnail=await thumbnails.ensure(filename);
    result[thumbnail.generated?'generated':'reused']++;
    result.thumbnailBytes+=(await stat(thumbnail.path)).size;
  }catch(error){result.failed++;console.error(filename+': '+error.message);}
}
console.log(JSON.stringify(result));
if(result.failed)process.exitCode=1;
