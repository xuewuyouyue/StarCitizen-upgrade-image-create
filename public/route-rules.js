export const hasPrice=ship=>Number.isFinite(ship?.priceUsd)&&ship.priceUsd>=0;
export function routeError(from,to){
  if(!from||!to)return '请先选择起点与终点舰船';
  if(from.id===to.id)return '起点与终点不能是同一艘舰船';
  if(!hasPrice(from)||!hasPrice(to))return '请先在图库填写两艘舰船的美元价格';
  if(Math.round(from.priceUsd*100)>=Math.round(to.priceUsd*100))return '起点价格必须严格低于终点，不能同价或降级';
  return '';
}
export function canSelectShip(side,ship,other){
  if(!hasPrice(ship))return false;
  if(!hasPrice(other))return true;
  return !(side==='from'?routeError(ship,other):routeError(other,ship));
}
export function sortPickerShips(ships,order){
  const direction=order==='price-asc'?1:order==='price-desc'?-1:0;
  return direction?[...ships].sort((a,b)=>direction*(Math.round(a.priceUsd*100)-Math.round(b.priceUsd*100))):[...ships];
}
