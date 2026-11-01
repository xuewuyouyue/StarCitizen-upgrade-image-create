import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {routeError} from '../public/route-rules.js';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const action=source.slice(source.indexOf('async function demo()'),source.indexOf("\n$$('[data-view]')"));
const defaults=[{id:'from',name:'弩炮',en:'Ballista',priceUsd:140,imageUrl:'/media/from.jpg',version:1},{id:'to',name:'财富',en:'Fortune',priceUsd:175,imageUrl:'/media/to.jpg',version:1}];
function browser(catalog=structuredClone(defaults),options={}){
  const button={disabled:false},calls={writes:0,previews:0,reads:0},state={from:null,to:null};
  const context={ships:[],state,authRevision:1,$:()=>button,routeError,requireAdmin:()=>{if(options.admin===false)throw Error('仅管理员');},
    refresh:async()=>{calls.reads++;await options.beforeRefresh?.(context);context.ships=structuredClone(catalog);},
    preview:async()=>{calls.previews++;},toast:()=>{},confirm:()=>true,loadImage:async()=>({width:1000,height:1000}),
    document:{createElement:()=>({getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,test'})},
    api:async(_url,method,body)=>{if(method!=='GET'){calls.writes++;const ship={id:'new-'+catalog.length,...body};catalog.push(ship);return ship;}return structuredClone(catalog);}};
  const demo=runInNewContext(action+'\ndemo',context);
  return {demo,calls,state,context,button,catalog};
}
test('重复载入及刷新后载入只选择已有舰船，图库和图片引用不变',async()=>{
  const catalog=structuredClone(defaults),before=JSON.stringify(catalog),first=browser(catalog);
  await first.demo();await first.demo();const reloaded=browser(catalog);await reloaded.demo();
  assert.equal(first.calls.writes+reloaded.calls.writes,0);assert.equal(JSON.stringify(catalog),before);
  assert.deepEqual(first.state,{from:'from',to:'to'});assert.deepEqual(reloaded.state,first.state);assert.equal(first.calls.previews,2);
});
test('两个客户端同时载入不会新增记录，已有示例也不重复创建',async()=>{
  const catalog=structuredClone(defaults);catalog.push({...defaults[0],id:'old-from',name:'弩炮 · 示例'},{...defaults[1],id:'old-to',name:'财富 · 示例'});
  const first=browser(catalog),second=browser(catalog);await Promise.all([first.demo(),second.demo()]);
  assert.equal(catalog.length,4);assert.equal(first.calls.writes+second.calls.writes,0);assert.deepEqual(first.state,second.state);
});
test('已有舰船改名、改价和换图均保留，非法升级不会覆盖资料',async()=>{
  const catalog=structuredClone(defaults);Object.assign(catalog[0],{name:'我的弩炮',priceUsd:200,imageUrl:'/media/replaced.jpg',version:8});
  const before=JSON.stringify(catalog),page=browser(catalog);await assert.rejects(page.demo(),/价格/);
  assert.equal(page.calls.writes,0);assert.equal(JSON.stringify(catalog),before);assert.equal(page.calls.previews,0);assert.equal(page.button.disabled,false);
});
test('缺少样例时提示手动选船，普通用户不能载入，不创建记录',async()=>{
  const empty=browser([]);await assert.rejects(empty.demo(),/图库/);assert.equal(empty.calls.writes,0);assert.equal(empty.catalog.length,0);
  const user=browser(undefined,{admin:false});await assert.rejects(user.demo(),/管理员/);assert.equal(user.calls.reads,0);assert.equal(user.calls.writes,0);
});
test('载入期间重复调用和退出登录不会重复操作或污染新会话',{timeout:1000},async()=>{
  let finish;const loading=new Promise(resolve=>{finish=resolve;}),page=browser(undefined,{beforeRefresh:()=>loading});
  const pending=page.demo();await page.demo();assert.equal(page.calls.reads,1);page.context.authRevision++;finish();await pending;
  assert.deepEqual(page.state,{from:null,to:null});assert.equal(page.calls.previews,0);assert.equal(page.calls.writes,0);assert.equal(page.button.disabled,false);
});
