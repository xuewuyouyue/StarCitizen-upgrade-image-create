import test from 'node:test';
import assert from 'node:assert/strict';

let instance=0;
async function setup(t){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'Image'),created=[];
  class FakeImage{
    constructor(){created.push(this);this.width=100;this.height=100;}
    set src(value){this.url=value;}
    succeed(){this.onload();}
    fail(){this.onerror();}
  }
  globalThis.Image=FakeImage;
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'Image',previous);else delete globalThis.Image;});
  return {...await import(`../public/renderer.js?image-cache-test=${instance++}`),created};
}

test('image cache reuses promises and refreshes LRU hits while retaining only four entries',async t=>{
  const {loadImage,created}=await setup(t),a=loadImage('a'),b=loadImage('b'),c=loadImage('c'),d=loadImage('d');
  assert.equal(created.length,4);assert.equal(loadImage('a'),a);
  loadImage('e');
  assert.equal(created.length,5);assert.equal(loadImage('a'),a);assert.equal(loadImage('c'),c);assert.equal(loadImage('d'),d);
  const replacement=loadImage('b');
  assert.notEqual(replacement,b);assert.equal(created.length,6);
  for(const image of created)image.succeed();
  assert.equal(await b,created[1]);assert.equal(await replacement,created[5]);
});

test('eviction leaves held image promises usable and never cancels their loads',async t=>{
  const {loadImage,created}=await setup(t),pending=loadImage('a');
  for(const url of ['b','c','d','e'])loadImage(url);
  created[0].succeed();assert.equal(await pending,created[0]);
  assert.notEqual(loadImage('a'),pending);assert.equal(created.length,6);
  for(const image of created.slice(1))image.succeed();
});

test('failed image loads are removed and can be retried',async t=>{
  const {loadImage,created}=await setup(t),failed=loadImage('a'),rejection=assert.rejects(failed,/图片加载失败/);
  created[0].fail();await rejection;
  const retry=loadImage('a');assert.notEqual(retry,failed);assert.equal(created.length,2);
  created[1].succeed();assert.equal(await retry,created[1]);
});

test('forgetImage allows reloading and an old failure cannot remove a newer cached promise',async t=>{
  const {loadImage,forgetImage,created}=await setup(t),old=loadImage('a'),rejection=assert.rejects(old,/图片加载失败/);
  forgetImage('a');const current=loadImage('a');
  assert.notEqual(current,old);created[0].fail();await rejection;
  assert.equal(loadImage('a'),current);assert.equal(created.length,2);
  created[1].succeed();assert.equal(await current,created[1]);
  forgetImage('a');const latest=loadImage('a');assert.notEqual(latest,current);
  created[2].succeed();assert.equal(await latest,created[2]);
});

test('canvas rendering loads originals only for the two selected ships even when thumbnails exist',async t=>{
  const {render,created}=await setup(t),{canvas}=titleCanvas(),ships=[
    {id:'a',name:'起点',priceUsd:100,imageUrl:'/media/a.jpg',thumbnailUrl:'/thumbnails/a.jpg.webp'},
    {id:'b',name:'终点',priceUsd:200,imageUrl:'/media/b.jpg',thumbnailUrl:'/thumbnails/b.jpg.webp'},
    {id:'unused',name:'未选择',priceUsd:300,imageUrl:'/media/unused.jpg',thumbnailUrl:'/thumbnails/unused.jpg.webp'}
  ];
  const pending=render(canvas,{from:'a',to:'b',shop:'',title:'',separator:' → ',type:'WBCCU',crop:{from:{},to:{}},upgradeArrow:'none'},ships);
  for(const image of created)image.succeed();await pending;
  assert.deepEqual(created.map(image=>image.url).filter(url=>url.startsWith('/media/')),['/media/a.jpg','/media/b.jpg']);
  assert.equal(created.some(image=>image.url.startsWith('/thumbnails/')),false);
});

test('transient English rendering changes only automatic ship names and the regular CCU badge',async t=>{
  const {render,created}=await setup(t),drawn=[];
  const ctx={measureText:value=>({width:value.length*10,actualBoundingBoxLeft:0,actualBoundingBoxRight:value.length*10,actualBoundingBoxAscent:20,actualBoundingBoxDescent:4}),fillText:value=>drawn.push(value)};
  for(const name of ['scale','drawImage','save','restore','beginPath','moveTo','lineTo','closePath','clip','fill','stroke'])ctx[name]=()=>{};
  const canvas={getContext:()=>ctx},ships=[{id:'a',name:'弩炮',en:'Ballista',priceUsd:140,imageUrl:'a'},{id:'b',name:'财富',en:'Fortune',priceUsd:175,imageUrl:'b'}];
  const state={from:'a',to:'b',shop:'我的店铺',type:'CCU',crop:{from:{},to:{}},upgradeArrow:'none',title:'',separator:' → '};
  const first=render(canvas,state,ships);for(const image of created)image.succeed();await first;
  assert.ok(drawn.includes('弩炮 → 财富'));assert.ok(drawn.includes('普通CCU'));
  drawn.length=0;await render(canvas,{...state,language:'en'},ships);
  assert.ok(drawn.includes('Ballista → Fortune'));assert.ok(drawn.includes('CCU'));assert.ok(drawn.includes('我的店铺'));assert.ok(drawn.includes('UPGRADE'));
  drawn.length=0;await render(canvas,{...state,language:'en',title:'自定义标题',upgradeText:'自定义中框'},ships);
  assert.ok(drawn.includes('自定义标题'));assert.ok(drawn.includes('自定义中框'));
  drawn.length=0;await render(canvas,{...state,language:'en'},ships.map(ship=>({...ship,en:''})));
  assert.ok(drawn.includes('弩炮 → 财富'));
  drawn.length=0;await render(canvas,{...state,language:'other'},ships);
  assert.ok(drawn.includes('弩炮 → 财富'));assert.ok(drawn.includes('普通CCU'));
});

function titleCanvas(){
  const drawn=[],stack=[],ctx={font:'10px sans-serif',textAlign:'left',textBaseline:'alphabetic'};
  ctx.measureText=content=>{
    const size=Number(/([\d.]+)px/.exec(ctx.font)[1]),characters=Array.from(content),hasChinese=/[\u3400-\u9fff]/u.test(content);
    const width=characters.reduce((sum,char)=>sum+size*(/[\u3400-\u9fff]/u.test(char)?1:/\s/u.test(char)?.28:char==='W'?.9:.56),0);
    return {width,actualBoundingBoxLeft:size*.025,actualBoundingBoxRight:width+size*.015,actualBoundingBoxAscent:size*(hasChinese?.84:.72),actualBoundingBoxDescent:size*(hasChinese?.08:/[gjpqy]/.test(content)?.22:.02)};
  };
  ctx.fillText=(content,x,y)=>{
    const metrics=ctx.measureText(content),offset=ctx.textAlign==='center'?-metrics.width/2:0;
    drawn.push({content,size:Number(/([\d.]+)px/.exec(ctx.font)[1]),left:x+offset-metrics.actualBoundingBoxLeft,right:x+offset+metrics.actualBoundingBoxRight,top:y-metrics.actualBoundingBoxAscent,bottom:y+metrics.actualBoundingBoxDescent});
  };
  ctx.save=()=>stack.push({font:ctx.font,textAlign:ctx.textAlign,textBaseline:ctx.textBaseline});
  ctx.restore=()=>Object.assign(ctx,stack.pop());
  for(const name of ['scale','drawImage','beginPath','moveTo','lineTo','closePath','clip','fill','stroke'])ctx[name]=()=>{};
  return {canvas:{getContext:()=>ctx},drawn};
}

function assertFooterTitle(drawn,content){
  const lines=drawn.filter(line=>line.top>=874);
  assert.ok(lines.length>=1&&lines.length<=2,'footer contains only the complete title, without the old subtitle');
  assert.equal(lines.map(line=>line.content).join(' ').replace(/\s+/g,'').trim(),content.replace(/\s+/g,'').trim());
  for(const line of lines){
    assert.ok(line.left>=44-1e-8&&line.right<=956+1e-8,'title ink stays inside the horizontal footer margins');
    assert.ok(line.top>=886-1e-8&&line.bottom<=982+1e-8,'title ink stays inside the vertical footer margins');
    assert.ok(Math.abs((line.left+line.right)/2-500)<1e-8,'each title line is visually centered');
  }
  assert.ok(Math.abs((Math.min(...lines.map(line=>line.top))+Math.max(...lines.map(line=>line.bottom)))/2-934)<1e-8,'complete title ink is vertically centered');
  return lines;
}

test('short Chinese and English product titles grow to use the footer and remain centered in every frame and size',async t=>{
  const {render,created}=await setup(t),ships=[{id:'a',name:'弩炮',en:'Ballista',priceUsd:140,imageUrl:'a'},{id:'b',name:'财富',en:'Fortune',priceUsd:175,imageUrl:'b'}];
  for(const template of ['ember','tech','mono'])for(const size of [1000,1600,2000])for(const content of ['弩炮 → 财富','Ballista → Fortune']){
    const {canvas,drawn}=titleCanvas(),pending=render(canvas,{from:'a',to:'b',shop:'',type:'WBCCU',crop:{from:{},to:{}},upgradeArrow:'none',title:content,template,size},ships);
    for(const image of created)image.succeed();await pending;
    const lines=assertFooterTitle(drawn,content);
    assert.equal(lines.length,1);assert.ok(lines[0].size>50,'short titles are larger than the old 50px maximum');
    assert.ok(Math.max((lines[0].right-lines[0].left)/912,(lines[0].bottom-lines[0].top)/96)>=.97,'short titles use the available width or height before shrinking');
    assert.equal(canvas.width,size);assert.equal(canvas.height,size);
  }
});

test('long Chinese and English titles retain all characters across two lines without clipping',async t=>{
  const {render,created}=await setup(t),ships=[{id:'a',name:'弩炮',priceUsd:140,imageUrl:'a'},{id:'b',name:'财富',priceUsd:175,imageUrl:'b'}];
  for(const content of ['星际公民舰船升级路线商品标题'.repeat(6).slice(0,80),'Constellation Andromeda Mk IV to Constellation Phoenix Mk IV Warbond Edition','W'.repeat(80)]){
    const {canvas,drawn}=titleCanvas(),pending=render(canvas,{from:'a',to:'b',shop:'',type:'WBCCU',crop:{from:{},to:{}},upgradeArrow:'none',title:content,language:'en',template:'ember',size:1600},ships);
    for(const image of created)image.succeed();await pending;
    const lines=assertFooterTitle(drawn,content);assert.equal(lines.length,2);
    assert.ok(Math.min(...lines.map(line=>line.size))>=22,'the full custom title remains readable at the 80-character boundary');
    if(content.includes(' '))assert.ok(/\s/.test(content[lines[0].content.length]),'English wrapping respects word boundaries');
  }
});
