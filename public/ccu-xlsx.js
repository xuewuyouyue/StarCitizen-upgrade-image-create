import {read,utils} from './vendor/sheetjs/xlsx.mjs';

export function readUpgradeXlsx(buffer){
  const bytes=new Uint8Array(buffer);
  if(bytes[0]!==0x50||bytes[1]!==0x4b)throw new Error('不是有效的 XLSX 文件，请重新导出。');
  let workbook;
  try{workbook=read(bytes,{type:'array',sheets:0,sheetRows:5003,cellFormula:false,cellHTML:false,cellText:false});}
  catch{throw new Error('无法读取 XLSX 文件，请确认文件未损坏且未加密。');}
  const sheet=workbook.Sheets[workbook.SheetNames[0]];
  if(!sheet)throw new Error('XLSX 没有可读取的工作表。');
  if(utils.decode_range(sheet['!fullref']||sheet['!ref']||'A1').e.r>5001)throw new Error('单次最多读取 5000 行，请拆分表格后导入');
  const headers=new Map(),data=new Map(),normalize=value=>String(value??'').normalize('NFKC').replace(/\s+/g,'');
  for(const [address,cell]of Object.entries(sheet)){
    if(address[0]==='!')continue;
    const {r,c}=utils.decode_cell(address);
    if(r===1){const name=normalize(cell.v);if(!headers.has(name))headers.set(name,[]);headers.get(name).push(c);}
    else if(r>1&&String(cell.v??'').trim()){
      if(!data.has(r))data.set(r,new Map());data.get(r).set(c,cell.t==='e'?'#ERROR!':cell.v);
    }
  }
  const column=names=>{
    for(const name of names){const matches=headers.get(name);if(!matches)continue;if(matches.length!==1)throw new Error('XLSX 第二行表头重复：'+name);return matches[0];}
    return null;
  };
  const from=column(['起始船(英)','起始船','起始船(中)']),to=column(['终点船(英)','终点船','终点船(中)']),saving=column(['节约($)','节约']);
  if(from===null||to===null||saving===null)throw new Error('XLSX 第二行缺少必需列：起始船、终点船、节约');
  const fromChinese=column(['起始船(中)']),toChinese=column(['终点船(中)']);
  return [...data].sort(([a],[b])=>a-b).map(([row,fields])=>({rowNumber:row+1,fromName:String(fields.get(from)??fields.get(fromChinese)??'').trim(),toName:String(fields.get(to)??fields.get(toChinese)??'').trim(),rawSaving:fields.get(saving)}));
}
