import {parseUpgradeCsv,matchUpgradeRows} from './ccu-csv.js';
import {LocalZip} from './local-zip.js';
import {render} from './renderer.js';
import {routeError} from './route-rules.js';

export function setupBatch({getState,getShips,getFormat,fetchShips}){
  const $=id=>document.getElementById(id),file=$('batch-file'),start=$('batch-start'),cancel=$('batch-cancel'),language=$('batch-language'),status=$('batch-status'),progress=$('batch-progress'),body=$('batch-rows');
  const node=(tag,content)=>{const element=document.createElement(tag);if(content!==undefined)element.textContent=content;return element;};
  let source='',rows=[],queue=[],choices={},cursor=0,part=1,success=0,failed=0,settings=null,format='png',outputLanguage='zh',token=0,busy=false,cancelled=false,url='';
  const cells=new Map();
  function clearDownload(){if(url)URL.revokeObjectURL(url);url='';$('batch-downloads').replaceChildren();}
  function controls(){
    $('batch-select').disabled=file.disabled=language.disabled=busy;start.disabled=busy||!queue.length;cancel.classList.toggle('hidden',!busy);
    start.textContent=busy?'正在生成…':cursor===queue.length&&queue.length?'重新生成 ZIP':cursor?'继续生成下一包':'生成 ZIP';
    body.querySelectorAll('select').forEach(select=>select.disabled=busy);
  }
  function resetOutput(){clearDownload();cursor=0;part=1;success=0;failed=0;settings=null;progress.value=0;progress.classList.add('hidden');for(const row of rows)if(cells.has(row.rowNumber)){const cell=cells.get(row.rowNumber);cell.textContent=row.error||'待生成';cell.classList.toggle('batch-error',!!row.error);}controls();}
  function drawRows(){
    body.replaceChildren();cells.clear();
    for(const row of rows){
      const tr=node('tr');tr.append(node('td',row.rowNumber));
      for(const side of ['from','to']){
        const td=node('td'),name=row[side+'Name'];td.append(node('span',name));
        if(row[side+'Options'].length){
          const select=node('select');select.setAttribute('aria-label',`第 ${row.rowNumber} 行${side==='from'?'起点':'终点'}同名舰船`);
          const empty=node('option','请选择同名舰船图片');empty.value='';select.append(empty);
          for(const ship of row[side+'Options']){const option=node('option',ship.name+(Number.isFinite(ship.priceUsd)?' · $'+ship.priceUsd:''));option.value=ship.id;select.append(option);}
          select.value=choices[row.rowNumber+':'+side]||'';
          select.onchange=()=>{choices[row.rowNumber+':'+side]=select.value;readRows();};td.append(select);
        }
        tr.append(td);
      }
      tr.append(node('td',row.saving??'—'),node('td',row.type==='CCU'?'普通CCU':row.type||'—'));
      const result=node('td',row.error||'待生成');result.classList.toggle('batch-error',!!row.error);cells.set(row.rowNumber,result);tr.append(result);body.append(tr);
    }
    $('batch-table-wrap').classList.toggle('hidden',!rows.length);
  }
  function readRows(){
    rows=Array.isArray(source)?matchUpgradeRows(source,getShips(),choices,{allowChinese:true}):parseUpgradeCsv(source,getShips(),choices);if(rows.length>5000)throw new Error('单次最多读取 5000 行，请拆分表格后导入');
    queue=rows.filter(row=>!row.error);drawRows();resetOutput();
    status.textContent=rows.length?`共 ${rows.length} 行，可生成 ${queue.length} 行，需检查 ${rows.length-queue.length} 行。每行生成一张。`:'表格只有表头，没有升级路线。';
  }
  function reset(){token++;cancelled=true;busy=false;source='';rows=[];queue=[];choices={};file.value='';language.value='zh';drawRows();resetOutput();status.textContent='';}
  $('batch-select').onclick=()=>file.click();
  file.onchange=async()=>{
    const selected=file.files[0];if(!selected)return;reset();const revision=++token;busy=true;controls();
    try{
      if(!/\.(csv|xlsx)$/i.test(selected.name))throw new Error('请上传 CSV 或 XLSX 文件。');
      if(selected.size>5*1024*1024)throw new Error('文件不能超过 5 MB，请拆分后导入');
      const buffer=await selected.arrayBuffer();if(revision!==token)return;
      if(/\.xlsx$/i.test(selected.name)){
        const {readUpgradeXlsx}=await import('./ccu-xlsx.js');if(revision!==token)return;
        source=readUpgradeXlsx(buffer);
      }else{
        try{source=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}
        catch{throw new Error('CSV 不是有效的 UTF-8 文件，请用 UTF-8 重新导出。');}
      }
      readRows();
    }catch(error){if(revision===token){source='';rows=[];queue=[];drawRows();status.textContent=error.message;}}
    finally{if(revision===token){busy=false;controls();}}
  };
  language.onchange=()=>{resetOutput();status.textContent='语言已切换，下一次生成使用所选语言。';};
  cancel.onclick=()=>{cancelled=true;cancel.disabled=true;status.textContent='正在停止，已完成的图片仍可下载。';};
  start.onclick=async()=>{
    if(busy||!queue.length)return;
    if(cursor===queue.length)resetOutput();else clearDownload();
    const revision=++token,active=()=>revision===token,stopped=()=>!active()||cancelled;
    busy=true;cancelled=false;cancel.disabled=false;controls();
    let zip=new LocalZip();const canvas=document.createElement('canvas'),begin=cursor;
    try{
      const ships=await fetchShips();if(!active())return;
      if(!settings){settings=structuredClone(getState());format=getFormat();outputLanguage=language.value;}
      progress.max=queue.length;progress.value=cursor;progress.classList.remove('hidden');
      while(cursor<queue.length&&!stopped()){
        const row=queue[cursor],cell=cells.get(row.rowNumber),from=ships.find(ship=>ship.id===row.fromId),to=ships.find(ship=>ship.id===row.toId);
        cell.textContent='生成中…';
        try{
          const error=routeError(from,to);if(error)throw new Error(error);
          const state={...settings,from:from.id,to:to.id,type:row.type,title:'',language:outputLanguage,crop:{from:{x:50,y:50,zoom:1},to:{x:50,y:50,zoom:1}}};
          if(outputLanguage==='en'&&state.separator===' 升级至 ')state.separator=' TO ';
          await render(canvas,state,ships);if(stopped()){if(active())cell.textContent='待生成';break;}
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/'+format,.95));if(stopped()){if(active())cell.textContent='待生成';break;}
          if(!blob)throw new Error('图片导出失败');
          const shipName=ship=>outputLanguage==='en'?(ship.en||ship.name):ship.name,safe=value=>value.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,'_').slice(0,80);
          const name=String(row.rowNumber).padStart(4,'0')+'_'+safe(shipName(from))+'_'+safe(shipName(to))+'_'+row.type+'.'+(format==='jpeg'?'jpg':'png');
          if(zip.count&&zip.size+blob.size+76+new TextEncoder().encode(name).length*2>100*1024*1024){cell.textContent='待生成';break;}
          await zip.add(name,blob);if(!active())return;success++;cell.textContent='已生成';cell.classList.remove('batch-error');
        }catch(error){if(!active())return;failed++;cell.textContent='生成失败：'+error.message;cell.classList.add('batch-error');}
        cursor++;progress.value=cursor;status.textContent=`已处理 ${cursor} / ${queue.length} 行，成功 ${success} 张，失败 ${failed} 行。`;
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(!active())return;
      if(zip.count){
        const archive=zip.finish();url=URL.createObjectURL(archive);
        const link=node('a',`下载第 ${part} 包 · ${zip.count} 张 · ${(archive.size/1024/1024).toFixed(1)} MB`);link.href=url;link.download=`升级商品图_${outputLanguage}_${String(part++).padStart(2,'0')}.zip`;link.className='primary';$('batch-downloads').append(link);
      }
      status.textContent=`${cancelled?'已停止':cursor<queue.length?'本包已完成':'生成完成'}：已处理 ${cursor} / ${queue.length} 行，成功 ${success} 张，失败 ${failed} 行。`+(rows.length>queue.length?`另有 ${rows.length-queue.length} 行因导入问题未生成。`:'')+(cursor<queue.length?'请先下载本包，再继续生成下一包。':'');
    }catch(error){if(active())status.textContent='生成未完成：'+error.message;}
    finally{canvas.width=canvas.height=1;zip=null;if(active()){busy=false;controls();if(cursor===begin&&cancelled)status.textContent='已停止，可继续生成。';}}
  };
  reset();return {reset};
}
