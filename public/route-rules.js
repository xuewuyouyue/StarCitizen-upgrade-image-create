export const hasPrice=ship=>Number.isFinite(ship?.priceUsd)&&ship.priceUsd>=0;
export function originIds(from){return Array.isArray(from)?[...from]:from===null||from===undefined?[]:[from];}
export function resolveOrigins(state,ships){return originIds(state.from).map(id=>typeof id==='string'?ships.find(ship=>ship.id===id):undefined);}
function originsError(origins){
  if(!origins.length||origins.some(ship=>!ship))return '请先选择起点与终点舰船';
  if(origins.length>3)return '起点最多选择 3 艘舰船';
  if(new Set(origins.map(ship=>ship.id)).size!==origins.length)return '不能重复选择同一艘起点舰船';
  if(origins.some(ship=>!hasPrice(ship)))return '请先在图库填写两艘舰船的美元价格';
  if(origins.some(ship=>Math.round(ship.priceUsd*100)!==Math.round(origins[0].priceUsd*100)))return '多个起点舰船的价格必须相同';
  return '';
}
export function routeError(from,to){
  const origins=Array.isArray(from)?from:[from];
  if(!origins.length||origins.some(ship=>!ship)||!to)return '请先选择起点与终点舰船';
  if(origins.some(ship=>ship.id===to.id))return '起点与终点不能是同一艘舰船';
  const error=originsError(origins);if(error)return error;
  if(!hasPrice(to))return '请先在图库填写两艘舰船的美元价格';
  if(origins.some(ship=>Math.round(ship.priceUsd*100)>=Math.round(to.priceUsd*100)))return '起点价格必须严格低于终点，不能同价或降级';
  return '';
}
export function originSelectionError(ship,selected,to){
  const origins=[...(Array.isArray(selected)?selected:selected?[selected]:[]),ship],error=originsError(origins);
  return error||(to?routeError(origins,to):'');
}
export function canSelectShip(side,ship,other){
  if(!hasPrice(ship))return false;
  if(side==='to'&&Array.isArray(other))return !other.length||!routeError(other,ship);
  if(!hasPrice(other))return true;
  return !(side==='from'?routeError(ship,other):routeError(other,ship));
}
export function sortPickerShips(ships,order){
  const direction=order==='price-asc'?1:order==='price-desc'?-1:0;
  return direction?[...ships].sort((a,b)=>direction*(Math.round(a.priceUsd*100)-Math.round(b.priceUsd*100))):[...ships];
}
