import {routeError} from './route-rules.js';

const normalizeName=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/[\u2010-\u2015\u2212]/g,'-').replace(/[\u2018\u2019\u02bc]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\s+/g,' ');

function readRows(text){
  const rows=[];
  let fields=[],field='',quoted=false,closed=false,line=1,rowNumber=1,started=false;
  const endField=()=>{fields.push(field);field='';closed=false;};
  const endRow=()=>{
    endField();
    if(started||fields.length>1||fields[0].trim())rows.push({rowNumber,fields});
    fields=[];started=false;
  };
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(quoted){
      if(char==='"'){
        if(text[i+1]==='"'){field+='"';i++;}
        else{quoted=false;closed=true;}
      }else{
        field+=char;
        if(char==='\n'||char==='\r'&&text[i+1]!=='\n')line++;
      }
      continue;
    }
    if(char===','){endField();started=true;continue;}
    if(char==='\r'||char==='\n'){
      endRow();
      if(char==='\r'&&text[i+1]==='\n')i++;
      line++;rowNumber=line;
      continue;
    }
    if(closed)throw new Error(`CSV 第 ${line} 行：闭合引号后只能是逗号或换行`);
    if(char==='"'){
      if(field!=='')throw new Error(`CSV 第 ${line} 行：未加引号字段中包含引号`);
      quoted=true;started=true;
    }else{field+=char;}
  }
  if(quoted)throw new Error(`CSV 第 ${rowNumber} 行：引号未闭合`);
  endRow();
  return rows;
}

export function parseUpgradeCsv(text,ships,choices={}){
  const rows=readRows(String(text??'').replace(/^\uFEFF/,''));
  if(!rows.length)throw new Error('CSV 缺少表头：from、to、saving');
  const headers=rows.shift().fields.map(value=>value.trim().toLowerCase()),columns={};
  for(const name of ['from','to','saving']){
    const indexes=headers.flatMap((value,index)=>value===name?[index]:[]);
    if(indexes.length!==1)throw new Error(indexes.length?`CSV 表头重复：${name}`:`CSV 缺少必需列：${name}`);
    columns[name]=indexes[0];
  }
  return matchUpgradeRows(rows.map(({rowNumber,fields})=>({rowNumber,fromName:fields[columns.from],toName:fields[columns.to],rawSaving:fields[columns.saving]})),ships,choices);
}

export function matchUpgradeRows(records,ships,choices={},{allowChinese=false}={}){
  const index=new Map();
  for(const ship of ships){
    const english=String(ship.en??'').trim()||(typeof ship.name==='string'&&!/\p{Script=Han}/u.test(ship.name)?ship.name:'');
    for(const name of allowChinese?[english,ship.name]:[english]){
      const key=normalizeName(name);if(!key)continue;
      if(!index.has(key))index.set(key,new Map());
      index.get(key).set(ship.id,ship);
    }
  }
  return records.map(record=>{
    const {rowNumber}=record,fromName=String(record.fromName??'').trim(),toName=String(record.toName??'').trim(),rawSaving=String(record.rawSaving??'').trim();
    const saving=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(rawSaving)?Number(rawSaving):NaN;
    const entry={rowNumber,fromName,toName,saving:Number.isFinite(saving)?saving:null,type:Number.isFinite(saving)?saving===0?'CCU':'WBCCU':'',fromId:null,toId:null,fromOptions:[],toOptions:[],error:''},errors=[];
    const match=(name,side,key)=>{
      if(!name){errors.push(`${side}舰船名称为空`);return null;}
      const matches=index.get(normalizeName(name));
      if(!matches){errors.push(`${side}舰船未匹配：${name}`);return null;}
      if(matches.size>1)entry[`${key}Options`]=Array.from(matches.values(),ship=>({id:ship.id,name:ship.name,priceUsd:ship.priceUsd}));
      if(Object.hasOwn(choices,`${rowNumber}:${key}`)){
        const selected=matches.get(choices[`${rowNumber}:${key}`]);
        if(!selected)errors.push(`${side}舰船选择无效，请重新选择同名舰船`);
        return selected||null;
      }
      if(matches.size!==1){errors.push(`${side}舰船名称存在歧义：${name}`);return null;}
      return matches.values().next().value;
    };
    const from=match(fromName,'起点','from'),to=match(toName,'终点','to');
    if(from)entry.fromId=from.id;
    if(to)entry.toId=to.id;
    if(!Number.isFinite(saving))errors.push('saving 必须填写有限数值');
    if(from&&to){const error=routeError(from,to);if(error)errors.push(error);}
    entry.error=errors.join('；');
    return entry;
  });
}
