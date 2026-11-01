import {createHash} from 'node:crypto';
import {cp,mkdir,mkdtemp,lstat,readFile,readdir,realpath,rename,rm} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const shared=['renderer.js','ship-filename.js','route-rules.js','marker-icons.js','batch-export.js','ccu-csv.js','ccu-xlsx.js','local-zip.js','style.css','theme.css'];
const imageFile=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp)$/i;
const checksum=/^[0-9a-f]{64}$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const within=(parent,path)=>{const value=relative(parent,path);return !value||(!isAbsolute(value)&&value!=='..'&&!value.startsWith('..'+sep));};
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function canonicalOutput(path){
  let ancestor=dirname(path);
  while(!await exists(ancestor))ancestor=dirname(ancestor);
  return resolve(await realpath(ancestor),relative(ancestor,path));
}
async function regular(path){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Expected a regular file: '+path);}
async function noLinks(path){
  const stat=await lstat(path);
  if(stat.isSymbolicLink())throw new Error('Symbolic links are not allowed in extension sources: '+path);
  if(stat.isDirectory()){for(const name of await readdir(path))await noLinks(join(path,name));}
  else if(!stat.isFile())throw new Error('Unsupported source entry: '+path);
}
async function copy(source,destination){await noLinks(source);await cp(source,destination,{recursive:true,errorOnExist:true,force:false});}
function localPath(directory,value){
  if(typeof value!=='string'||!value||value.includes('\\')||value.split('/').some(part=>!part||part==='.'||part==='..')||isAbsolute(value))throw new Error('Invalid extension resource path');
  const path=resolve(directory,value);
  if(!within(directory,path))throw new Error('Extension resource escapes its directory');
  return path;
}
async function verifyCatalog(directory,file='manifest.json'){
  const manifest=JSON.parse(await readFile(join(directory,file),'utf8'));
  if(manifest.schemaVersion!==1||!Array.isArray(manifest.ships)||manifest.ships.length!==256)throw new Error('Expected the bundled catalog of 256 ships');
  const ids=new Set(),files=new Set();
  for(const ship of manifest.ships){
    if(!ship||typeof ship.id!=='string'||ids.has(ship.id)||!imageFile.test(ship.file)||files.has(ship.file)||ship.thumbnailFile!==ship.file+'.webp'||!checksum.test(ship.sha256)||!checksum.test(ship.thumbnailSha256))throw new Error('Invalid or duplicate bundled ship asset');
    ids.add(ship.id);files.add(ship.file);
    for(const [folder,file,expected] of [['images',ship.file,ship.sha256],['thumbnails',ship.thumbnailFile,ship.thumbnailSha256]]){
      const path=join(directory,folder,file);await regular(path);
      if(hash(await readFile(path))!==expected)throw new Error('Ship asset checksum mismatch: '+file);
    }
  }
  for(const folder of ['images','thumbnails'])if((await readdir(join(directory,folder))).length!==256)throw new Error('Unexpected files in bundled '+folder);
  return manifest.ships.length;
}
async function verifyExtension(directory){
  const manifests=(await readdir(directory,{recursive:true,withFileTypes:true})).filter(entry=>entry.isFile()&&entry.name.toLowerCase()==='manifest.json');
  if(manifests.length!==1||resolve(manifests[0].parentPath)!==directory)throw new Error('Extension must contain only one manifest.json at its root');
  const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
  if(manifest.manifest_version!==3||!manifest.version||!manifest.background?.service_worker)throw new Error('Invalid Manifest V3 extension');
  const icons=value=>typeof value==='string'?[value]:Object.values(value||{});
  const resources=['index.html','app.js','offline-store.js','LICENSE',manifest.background.service_worker,...icons(manifest.icons),...icons(manifest.action?.default_icon)];
  for(const value of resources)await regular(localPath(directory,value));
  return manifest.version;
}

export async function buildEdge({outputDir=join(root,'dist','edge')}={}){
  outputDir=await canonicalOutput(resolve(outputDir));
  if(outputDir===root||['public','assets','extensions','scripts','tests'].some(folder=>within(join(root,folder),outputDir)))throw new Error('Output must not replace or sit inside project source directories');
  if(await exists(outputDir))throw new Error('Output already exists; choose a new directory with --output: '+outputDir);
  const source=join(root,'extensions','edge'),assets=join(root,'assets','ships');
  await noLinks(source);await noLinks(assets);
  await verifyCatalog(assets);
  await mkdir(dirname(outputDir),{recursive:true});
  const temporary=await mkdtemp(join(dirname(outputDir),'.edge-build-'));
  try{
    for(const file of shared)await copy(join(root,'public',file),join(temporary,file));
    await copy(join(root,'public','vendor'),join(temporary,'vendor'));
    await copy(join(root,'public','assets'),join(temporary,'assets'));
    await copy(assets,join(temporary,'assets','ships'));
    await rename(join(temporary,'assets','ships','manifest.json'),join(temporary,'assets','ships','catalog.json'));
    for(const name of await readdir(source))if(name!=='README.md')await copy(join(source,name),join(temporary,name));
    await copy(join(root,'LICENSE'),join(temporary,'LICENSE'));
    const version=await verifyExtension(temporary),ships=await verifyCatalog(join(temporary,'assets','ships'),'catalog.json');
    if(await exists(outputDir))throw new Error('Output was created during the build; refusing to replace it: '+outputDir);
    await rename(temporary,outputDir);
    return {outputDir,version,ships,images:ships,thumbnails:ships};
  }catch(error){
    if(dirname(temporary)!==dirname(outputDir)||!basename(temporary).startsWith('.edge-build-'))throw new Error('Unexpected temporary build path',{cause:error});
    await rm(temporary,{recursive:true,force:true});
    throw error;
  }
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2);
  if(args.length&&(args.length!==2||args[0]!=='--output'))throw new Error('Usage: node scripts/build-edge.mjs [--output new-directory]');
  console.log(JSON.stringify(await buildEdge(args.length?{outputDir:args[1]}:{}),null,2));
}
