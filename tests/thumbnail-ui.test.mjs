import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {hasPrice,routeError,canSelectShip,sortPickerShips} from '../public/route-rules.js';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const actions=[
  source.slice(source.indexOf('async function refresh(){'),source.indexOf('async function initialize(){')),
  source.slice(source.indexOf('async function preview(){'),source.indexOf('function selectShip(')),
  source.slice(source.indexOf('function filterShips('),source.indexOf('function cropControls('))
].join('\n');
const catalog=[
  {id:'a',name:'起点',en:'From',priceUsd:100,imageUrl:'/media/a.jpg',thumbnailUrl:'/thumbnails/a.jpg.webp'},
  {id:'b',name:'终点',en:'To',priceUsd:200,imageUrl:'/media/b.png',thumbnailUrl:'/thumbnails/b.png.webp'},
  {id:'c',name:'高价',en:'Higher',priceUsd:300,imageUrl:'/media/c.webp',thumbnailUrl:'/thumbnails/c.webp.webp'}
];

function browser(){
  const requests=[],nodes=new Map(),rendered=[];
  class Node{
    constructor(tag='div'){
      this.tagName=tag;this.children=[];this.value='';this.open=false;this.width=1000;this.height=1000;
      const classes=new Set();
      this.classList={contains:value=>classes.has(value),add:value=>classes.add(value),remove:value=>classes.delete(value),toggle:(value,enabled)=>{if(enabled===undefined)enabled=!classes.has(value);if(enabled)classes.add(value);else classes.delete(value);return enabled;}};
    }
    set src(value){this.url=value;requests.push({url:value,loading:this.loading,decoding:this.decoding});}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=[...children];}
    showModal(){this.open=true;}
    close(){this.open=false;}
    focus(){this.focused=true;}
    getContext(){return {drawImage(){}};}
  }
  function elem(tag,className,content){const node=new Node(tag);node.className=className||'';node.textContent=content;return node;}
  const $=selector=>{if(!nodes.has(selector))nodes.set(selector,new Node());return nodes.get(selector);};
  $('#library-view').classList.add('hidden');
  const context={$,elem,$$:()=>[],button:(text,className,action)=>Object.assign(elem('button',className,text),{onclick:action}),
    ships:[],state:{from:null,to:null,size:1600},currentUser:{id:'test-user',role:'user'},authRevision:1,renderRevision:0,pickerTarget:'from',
    isAdmin:()=>false,hasPrice,routeError,canSelectShip,sortPickerShips,formatPrice:value=>'$'+value,structuredClone,
    api:async()=>structuredClone(catalog),document:{createElement:tag=>elem(tag)},render:async(_canvas,state,ships)=>rendered.push({state,ships})};
  runInNewContext(actions,context);
  return {context,$,requests,rendered};
}

test('catalog refresh does not construct or request images for the hidden library or closed picker',async()=>{
  const page=browser();await page.context.refresh();
  assert.equal(page.context.ships.length,3);assert.equal(page.requests.length,0);
  assert.equal(page.$('#library-grid').children.length,0);assert.equal(page.$('#picker-grid').children.length,0);
});

test('visible library cards use lazy decoded thumbnails before assigning src, with no full image fallback',async()=>{
  const page=browser();await page.context.refresh();page.$('#library-view').classList.remove('hidden');page.context.drawLibrary();
  assert.equal(page.$('#library-grid').children.length,3);
  assert.deepEqual(page.requests,catalog.map(ship=>({url:ship.thumbnailUrl,loading:'lazy',decoding:'async'})));
  page.requests.length=0;
  page.context.shipVisual({name:'Legacy',priceUsd:100,imageUrl:'/media/legacy.jpg'});
  assert.deepEqual(page.requests,[{url:'/thumbnails/legacy.jpg.webp',loading:'lazy',decoding:'async'}]);
  page.requests.length=0;
  page.context.shipVisual({name:'Unknown source',priceUsd:100,imageUrl:'https://example.test/original.jpg'});
  assert.equal(page.requests.length,0);
});

test('closing the library and picker keeps hidden refreshes from assigning more image sources',async()=>{
  const page=browser();await page.context.refresh();page.$('#library-view').classList.remove('hidden');page.context.drawLibrary();
  const cards=page.$('#library-grid').children;page.context.openPicker('from');const choices=page.$('#picker-grid').children;
  page.$('#library-view').classList.add('hidden');page.$('#picker').close();page.requests.length=0;
  await page.context.refresh();
  assert.equal(page.requests.length,0);assert.equal(page.$('#library-grid').children,cards);assert.equal(page.$('#picker-grid').children,choices);
});

test('opening the picker constructs only eligible thumbnail cards after the dialog opens',async()=>{
  const page=browser();await page.context.refresh();page.context.state.from='a';page.context.openPicker('to');
  assert.equal(page.$('#picker').open,true);assert.equal(page.$('#picker-grid').children.length,2);
  assert.deepEqual(page.requests.map(item=>item.url),catalog.slice(1).map(ship=>ship.thumbnailUrl));
  assert.ok(page.requests.every(item=>item.loading==='lazy'&&item.decoding==='async'));
});

test('selection slots use thumbnails while the preview keeps original image URLs in render inputs',async()=>{
  const page=browser();await page.context.refresh();Object.assign(page.context.state,{from:'a',to:'b'});await page.context.preview();
  assert.deepEqual(page.requests.map(item=>item.url),catalog.slice(0,2).map(ship=>ship.thumbnailUrl));
  assert.equal(page.rendered.length,1);
  assert.deepEqual(page.rendered[0].ships.map(ship=>ship.imageUrl),catalog.map(ship=>ship.imageUrl));
});
