import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../public/renderer.js';

let imagesCreated=0;
globalThis.Image=class{
  constructor(){imagesCreated++;this.width=1000;this.height=800;}
  set src(value){this.url=value;queueMicrotask(()=>this.onload());}
};
globalThis.Path2D=class{constructor(data){this.data=data;}};
const ship=(id,name,priceUsd=140)=>({id,name,en:id.toUpperCase(),priceUsd,imageUrl:'/ships/'+id+'.jpg'});
const ships=[ship('alpha','甲船'),ship('beta','乙船'),ship('gamma','丙船'),ship('delta','丁船'),ship('higher','高价船',150),ship('target','终点船',175)];
const state=(from,options={})=>({from,to:'target',template:'ember',size:1000,crop:{from:{x:50,y:50,zoom:1},to:{x:50,y:50,zoom:1}},order:'from-top',shop:'店铺',logo:'',type:'WBCCU',upgradeMode:'text',upgradeText:'UPGRADE',upgradeArrow:'line',title:'',separator:' → ',language:'zh',...options});
function canvas(){
  const draws=[],texts=[],stack=[];
  const ctx={
    font:'10px sans-serif',globalAlpha:1,clipRegion:null,path:[],
    beginPath(){this.path=[];},moveTo(x,y){this.path.push([x,y]);},lineTo(x,y){this.path.push([x,y]);},closePath(){},
    clip(){const xs=this.path.map(p=>p[0]),ys=this.path.map(p=>p[1]);this.clipRegion={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};},
    save(){stack.push({clipRegion:this.clipRegion,font:this.font,globalAlpha:this.globalAlpha});},restore(){Object.assign(this,stack.pop());},
    drawImage(img,x,y,width,height){draws.push({src:img.url,x,y,width,height,clip:this.clipRegion});},
    fillText(content,x,y){texts.push({content,x,y,font:this.font});},
    measureText(content){const size=Number(this.font.match(/(\d+)px/)?.[1]||10),width=Array.from(String(content)).length*size*.55;return {width,actualBoundingBoxLeft:0,actualBoundingBoxRight:width,actualBoundingBoxAscent:size*.7,actualBoundingBoxDescent:size*.2};},
    fill(){},stroke(){},translate(){},scale(){}
  };
  return {draws,texts,getContext:()=>ctx};
}
const photos=canvas=>canvas.draws.filter(draw=>draw.src.startsWith('/ships/'));

test('invalid multi-origin routes are rejected before accessing canvas or loading images',async()=>{
  const created=imagesCreated;
  for(const from of [[],['alpha','beta','gamma','delta'],['alpha','alpha'],['alpha','higher'],['alpha','missing'],['target'],[null]]){
    await assert.rejects(render(null,state(from),ships));
  }
  assert.equal(imagesCreated,created);
});

test('legacy single-origin string and one-item array keep the existing photo geometry and title',async()=>{
  const legacy=canvas(),array=canvas();
  await render(legacy,state('alpha'),ships);await render(array,state(['alpha']),ships);
  assert.deepEqual(legacy.draws,array.draws);assert.deepEqual(legacy.texts,array.texts);
  assert.deepEqual(photos(legacy).map(draw=>draw.clip),[{x:34,y:99,width:932,height:367},{x:34,y:487,width:932,height:367}]);
  assert.ok(legacy.texts.some(item=>item.content==='甲船 → 终点船'));
});

test('two or three origins split only the origin image region and share one price badge',async()=>{
  for(const count of [2,3])for(const order of ['from-top','to-top']){
    const result=canvas(),ids=['alpha','beta','gamma'].slice(0,count);
    await render(result,state(ids,{order}),ships);
    const draws=photos(result),origins=draws.filter(draw=>ids.some(id=>draw.src==='/ships/'+id+'.jpg')),target=draws.find(draw=>draw.src==='/ships/target.jpg'),width=(932-8*(count-1))/count;
    assert.equal(origins.length,count);assert.deepEqual(target.clip,{x:34,y:order==='to-top'?99:487,width:932,height:367});
    origins.forEach((draw,i)=>{assert.equal(draw.clip.x,34+i*(width+8));assert.equal(draw.clip.y,order==='to-top'?487:99);assert.ok(Math.abs(draw.clip.width-width)<.0001);assert.equal(draw.clip.height,367);});
    assert.equal(result.texts.filter(item=>item.content==='$140').length,1);
    assert.equal(result.texts.filter(item=>item.content==='$175').length,1);
    assert.ok(result.texts.some(item=>item.content.includes(' / ')));
    for(const name of ['甲船','乙船','丙船'].slice(0,count))assert.ok(result.texts.some(item=>item.content===name));
  }
});

test('each origin applies its own crop and first origin falls back to the legacy crop',async()=>{
  const result=canvas(),crop={from:{zoom:2,x:100,y:100},to:{zoom:1,x:50,y:50},origins:{beta:{zoom:1.2,x:0,y:0}}};
  await render(result,state(['alpha','beta'],{crop}),ships);
  const [first,second]=photos(result);
  assert.equal(first.width,924);assert.equal(first.x,34-(924-462));
  assert.ok(Math.abs(second.width-554.4)<.0001);assert.equal(second.x,504);
  const explicit=canvas();await render(explicit,state(['alpha','beta'],{crop:{...crop,origins:{...crop.origins,alpha:{zoom:1,x:0,y:0}}}}),ships);
  assert.equal(photos(explicit)[0].x,34);assert.equal(photos(explicit)[0].width,462);
});

test('multi-origin labels and automatic titles follow selected language while custom title wins',async()=>{
  const result=canvas();await render(result,state(['alpha','beta'],{language:'en'}),ships);
  assert.ok(result.texts.some(item=>item.content==='ALPHA'));assert.ok(result.texts.some(item=>item.content==='BETA'));
  assert.ok(result.texts.some(item=>item.content==='ALPHA / BETA → TARGET'));
  const custom=canvas();await render(custom,state(['alpha','beta'],{title:'我的组合升级'}),ships);
  assert.ok(custom.texts.some(item=>item.content==='我的组合升级'));
  assert.equal(custom.texts.some(item=>item.content.includes('→')),false);
});
