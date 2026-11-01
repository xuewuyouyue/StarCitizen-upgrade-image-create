import {routeError} from './route-rules.js';
import {markerIcons} from './marker-icons.js';
const images=new Map();
export function loadImage(src){
  if(images.has(src)){const cached=images.get(src);images.delete(src);images.set(src,cached);return cached;}
  const image=new Image();let resolve,reject;
  const pending=new Promise((done,fail)=>{resolve=done;reject=fail;});
  image.onload=()=>resolve(image);image.onerror=()=>{if(images.get(src)===pending)images.delete(src);reject(new Error('图片加载失败，请刷新图库后重试'));};
  images.set(src,pending);while(images.size>4)images.delete(images.keys().next().value);
  image.src=src;return pending;
}
export function forgetImage(src){images.delete(src);}
export function formatPrice(value){return Number.isFinite(value)&&value>=0?'$'+value.toLocaleString('en-US',{minimumFractionDigits:Number.isInteger(value)?0:2,maximumFractionDigits:2}):'';}
const frames={
  tech:{file:'naval.png',ink:'#f4f9fc',muted:'#97b1bf',line:'#5189a5',accent:'#6ab5dd',label:'#0c293b',badgeInk:'#082335',arrowLight:'#f4f9fc',arrowDark:'#0c293b'},
  ember:{file:'porcelain.png',ink:'#454b4c',muted:'#8d8c80',line:'#aaa18b',accent:'#9a8d6c',label:'#eeece4',badgeInk:'#fff',arrowLight:'#eeece4',arrowDark:'#454b4c'},
  mono:{file:'graphite.png',ink:'#edf0ee',muted:'#a3a6a1',line:'#8d897a',accent:'#b5ab92',label:'#252b2e',badgeInk:'#22272b',arrowLight:'#edf0ee',arrowDark:'#252b2e'}
};
function text(ctx,content,x,y,size,color,maxWidth,weight=500,align='left'){
  ctx.textAlign=align;ctx.fillStyle=color;
  const font=()=>weight+' '+size+'px "Microsoft YaHei", "PingFang SC", sans-serif';ctx.font=font();
  while(maxWidth&&ctx.measureText(content).width>maxWidth&&size>9){size--;ctx.font=font();}
  ctx.fillText(content,x,y);
}
function cutRect(ctx,x,y,w,h,cut=12){
  ctx.beginPath();ctx.moveTo(x+cut,y);ctx.lineTo(x+w,y);ctx.lineTo(x+w,y+h-cut);ctx.lineTo(x+w-cut,y+h);ctx.lineTo(x,y+h);ctx.lineTo(x,y+cut);ctx.closePath();
}
function photo(ctx,img,x,y,w,h,crop={}){
  const zoom=Number(crop.zoom)||1,px=Number(crop.x??50)/100,py=Number(crop.y??50)/100;
  const scale=Math.max(w/img.width,h/img.height)*zoom,dw=img.width*scale,dh=img.height*scale;
  ctx.save();cutRect(ctx,x,y,w,h,12);ctx.clip();ctx.drawImage(img,x-(dw-w)*px,y-(dh-h)*py,dw,dh);ctx.restore();
}
function rule(ctx,points,color,width=1){ctx.beginPath();ctx.moveTo(...points[0]);for(const p of points.slice(1))ctx.lineTo(...p);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
function contain(ctx,img,x,y,w,h){const s=Math.min(w/img.width,h/img.height);ctx.drawImage(img,x+(w-img.width*s)/2,y+(h-img.height*s)/2,img.width*s,img.height*s);}
function priceBadge(ctx,value,y,frame){
  const label=formatPrice(value);if(!label)return;
  ctx.font='800 34px "Microsoft YaHei",sans-serif';const width=Math.min(245,Math.max(125,ctx.measureText(label).width+36));
  cutRect(ctx,52,y,width,50,8);ctx.fillStyle=frame.label;ctx.fill();ctx.strokeStyle=frame.accent;ctx.lineWidth=1.4;ctx.stroke();
  text(ctx,label,52+width/2,y+37,34,frame.ink,width-28,800,'center');
}
function title(ctx,content,frame){
  ctx.save();ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillStyle=frame.ink;
  const font=size=>'700 '+size+'px "Microsoft YaHei", "PingFang SC", sans-serif',chars=Array.from(content),choices=[[content]];
  ctx.font=font(160);
  const spaces=chars.map((char,i)=>i>0&&/\s/u.test(char)?i:0).filter(Boolean),breaks=spaces.length?spaces:chars.map((_,i)=>i).slice(1);
  let split=0,narrowest=Infinity;
  for(const point of breaks){const width=Math.max(ctx.measureText(chars.slice(0,point).join('').trim()).width,ctx.measureText(chars.slice(point).join('').trim()).width);if(width<narrowest){narrowest=width;split=point;}}
  if(split)choices.push([chars.slice(0,split).join('').trim(),chars.slice(split).join('').trim()]);
  let best;
  for(const lines of choices)for(let size=160;size>0;size--){
    ctx.font=font(size);
    const metrics=lines.map(line=>ctx.measureText(line)),step=size*1.08,top=Math.min(...metrics.map((metric,i)=>i*step-metric.actualBoundingBoxAscent)),bottom=Math.max(...metrics.map((metric,i)=>i*step+metric.actualBoundingBoxDescent));
    if(metrics.every(metric=>Math.max(metric.width,metric.actualBoundingBoxLeft+metric.actualBoundingBoxRight)<=912)&&bottom-top<=96){
      if(!best||size>best.size)best={lines,metrics,size,step,top,bottom};break;
    }
  }
  ctx.font=font(best.size);
  const baseline=934-(best.top+best.bottom)/2;
  best.lines.forEach((line,i)=>ctx.fillText(line,500+(best.metrics[i].actualBoundingBoxLeft-best.metrics[i].actualBoundingBoxRight)/2,baseline+i*best.step));
  ctx.restore();
}
function markerArrow(ctx,x,y,style,frame,up,standalone=false,color=''){
  const icon=markerIcons[style]||markerIcons.line,scale=(standalone?108:44)/icon.height,weight=standalone?18:3.5;
  ctx.save();ctx.translate(x,y);ctx.scale(scale,up?scale:-scale);ctx.translate(-12,-icon.centerY);ctx.lineCap='round';ctx.lineJoin='round';
  const paths=icon.paths.map(data=>new Path2D(data)),custom=typeof color==='string'&&color.length===7&&/^#[0-9a-f]{6}$/i.test(color),fill=custom?color:frame.arrowLight;
  let outline=frame.arrowDark;
  if(custom){const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));if((rgb[0]*299+rgb[1]*587+rgb[2]*114)/1000<140)outline=frame.arrowLight;}
  if(standalone){
    ctx.lineCap='butt';ctx.lineJoin='miter';ctx.miterLimit=2;
    ctx.strokeStyle=outline;ctx.lineWidth=(style==='solid'?6:weight+6)/scale;
    for(const path of paths)ctx.stroke(path);
  }
  for(const path of paths){
    ctx.fillStyle=standalone?fill:frame.ink;ctx.strokeStyle=standalone?fill:frame.ink;ctx.lineWidth=weight/scale;
    if(style==='solid')ctx.fill(path);else ctx.stroke(path);
  }
  ctx.restore();
}
function upgradeMarker(ctx,state,frame,up){
  const content=String(state.upgradeText||'').replace(/\s+/g,' ').trim()||'UPGRADE',style=['solid','double','none'].includes(state.upgradeArrow)?state.upgradeArrow:'line';
  if(state.upgradeMode==='arrow'){markerArrow(ctx,500,477,style==='none'?'line':style,frame,up,true,state.upgradeColor);return;}
  const arrowWidth=style==='none'?0:46,gap=arrowWidth?18:0,maxWidth=456-arrowWidth-gap;
  let size=56,lines=[content];
  const font=()=>{ctx.font='800 '+size+'px "Microsoft YaHei", "PingFang SC", sans-serif';};font();
  while(ctx.measureText(content).width>maxWidth&&size>28){size--;font();}
  if(ctx.measureText(content).width>maxWidth){
    const chars=Array.from(content);let split=1,best=Infinity;
    for(let i=1;i<chars.length;i++){const width=Math.max(ctx.measureText(chars.slice(0,i).join('').trim()).width,ctx.measureText(chars.slice(i).join('').trim()).width);if(width<best){best=width;split=i;}}
    lines=[chars.slice(0,split).join('').trim(),chars.slice(split).join('').trim()];size=32;font();
    while(Math.max(...lines.map(line=>ctx.measureText(line).width))>maxWidth&&size>9){size--;font();}
  }
  const width=Math.max(...lines.map(line=>ctx.measureText(line).width)),left=500-(width+arrowWidth+gap)/2;
  ctx.save();ctx.fillStyle=frame.ink;
  if(arrowWidth)markerArrow(ctx,left+arrowWidth/2,477,style,frame,up);
  ctx.textAlign='center';ctx.textBaseline='alphabetic';
  const step=size*1.12,metrics=lines.map(line=>ctx.measureText(line)),top=Math.min(...metrics.map((metric,i)=>i*step-metric.actualBoundingBoxAscent)),bottom=Math.max(...metrics.map((metric,i)=>i*step+metric.actualBoundingBoxDescent)),baseline=477-(top+bottom)/2;
  lines.forEach((line,i)=>ctx.fillText(line,left+arrowWidth+gap+width/2,baseline+i*step));
  ctx.restore();
}
export async function render(canvas,state,ships){
  const from=ships.find(s=>s.id===state.from),to=ships.find(s=>s.id===state.to),error=routeError(from,to);if(error)throw new Error(error);
  const frame=frames[state.template]||frames.ember;
  const [fromImg,toImg,plate,logo]=await Promise.all([loadImage(from.imageUrl),loadImage(to.imageUrl),loadImage('/assets/'+frame.file),state.logo?loadImage(state.logo):null]);
  const size=Number(state.size)||1600;canvas.width=size;canvas.height=size;const ctx=canvas.getContext('2d');ctx.scale(size/1000,size/1000);ctx.imageSmoothingQuality='high';
  ctx.drawImage(plate,0,0,1000,1000);
  const up=state.order==='to-top';
  photo(ctx,up?toImg:fromImg,34,99,932,367,state.crop[up?'to':'from']);
  photo(ctx,up?fromImg:toImg,34,487,932,367,state.crop[up?'from':'to']);
  // Offset technical rules echo the reference pages without copying their brand marks.
  rule(ctx,[[27,145],[27,94],[153,94],[164,105],[366,105]],frame.line,1.4);
  rule(ctx,[[633,846],[837,846],[853,861],[973,861],[973,815]],frame.line,1.4);
  ctx.globalAlpha=.65;
  rule(ctx,[[34,78],[966,78]],frame.line,.8);
  rule(ctx,[[355,874],[645,874]],frame.line,.8);
  ctx.globalAlpha=1;
  const shop=state.shop.trim(),brandX=logo?104:49;
  if(shop||logo){
    ctx.font='800 40px "Microsoft YaHei", "PingFang SC", sans-serif';const brandWidth=Math.min(700,Math.max(150,ctx.measureText(shop).width+(logo?100:30)));
    cutRect(ctx,34,14,brandWidth,51,10);ctx.fillStyle=frame.label;ctx.fill();ctx.strokeStyle=frame.accent;ctx.lineWidth=1.4;ctx.stroke();
    if(logo)contain(ctx,logo,44,18,45,45);
    text(ctx,shop,brandX,55,40,frame.ink,brandWidth-(logo?85:30),800);
  }
  priceBadge(ctx,(up?to:from).priceUsd,115,frame);
  priceBadge(ctx,(up?from:to).priceUsd,503,frame);
  cutRect(ctx,758,14,198,51,10);ctx.fillStyle=frame.accent;ctx.fill();
  text(ctx,state.type==='CCU'?(state.language==='en'?'CCU':'普通CCU'):state.type,857,52,38,frame.badgeInk,178,800,'center');
  if(state.upgradeMode!=='arrow'){
    rule(ctx,[[44,478],[238,478]],frame.line,.9);
    rule(ctx,[[762,478],[956,478]],frame.line,.9);
    // Overlap both photographs with the larger marker while keeping the center gutter narrow.
    cutRect(ctx,250,434,500,86,14);ctx.fillStyle=frame.label;ctx.fill();ctx.strokeStyle=frame.accent;ctx.lineWidth=1.2;ctx.stroke();
  }
  upgradeMarker(ctx,state,frame,up);
  const name=state.title.trim()||(state.language==='en'?from.en||from.name:from.name)+state.separator+(state.language==='en'?to.en||to.name:to.name);
  title(ctx,name,frame);
  return true;
}
