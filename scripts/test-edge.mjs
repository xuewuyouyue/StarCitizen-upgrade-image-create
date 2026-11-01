import {spawn} from 'node:child_process';
import {mkdtemp,lstat,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildEdge} from './build-edge.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const temporaryParent=await realpath(tmpdir());
const temporary=await mkdtemp(join(temporaryParent,'wb-edge-tests-'));
try{
  const outputDir=join(temporary,'extension');
  await buildEdge({outputDir});
  process.exitCode=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--test',join(root,'tests','edge','offline-store.test.mjs'),join(root,'tests','edge','extension-package.test.mjs')],{
      cwd:root,stdio:'inherit',env:{...process.env,EDGE_TEST_DIR:outputDir}
    });
    child.once('error',reject);
    child.once('exit',(code,signal)=>signal?reject(new Error('Extension tests stopped by '+signal)):resolve(code??1));
  });
}finally{
  if(dirname(temporary)!==temporaryParent||!basename(temporary).startsWith('wb-edge-tests-')||(await lstat(temporary)).isSymbolicLink()||await realpath(temporary)!==temporary)throw new Error('Refusing to remove an unexpected test directory');
  await rm(temporary,{recursive:true,force:true});
}
