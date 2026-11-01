export function parseShipFilename(filename){
  const stem=filename.replace(/\.[^.]+$/,'').trim(),match=/^(.+)-(\d+(?:\.\d{1,2})?|NA)$/i.exec(stem);
  if(!match)return {name:stem,priceUsd:null};
  const price=match[2].toUpperCase()==='NA'?null:Number(match[2]);
  if(price!==null&&price>999999.99)return {name:stem,priceUsd:null};
  return {name:match[1].trim(),priceUsd:price};
}
