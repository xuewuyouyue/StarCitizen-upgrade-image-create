import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {hasPrice,routeError,canSelectShip,sortPickerShips,originIds,resolveOrigins,originSelectionError} from '../public/route-rules.js';

const catalog=[
  ['a','起点甲',100],['b','起点乙',100],['c','起点丙',100],['d','起点丁',100],
  ['cheap','较低价',50],['middle','另一价位',150],['target','终点',200],['higher','更高终点',300],['unknown','无价格',null]
].map(([id,name,priceUsd])=>({id,name,en:id,priceUsd,imageUrl:'/media/'+id+'.jpg',thumbnailUrl:'/thumbnails/'+id+'.jpg.webp'}));

function browser(file){
  const source=readFileSync(new URL('../'+file,import.meta.url),'utf8'),nodes=new Map(),messages=[],rendered=[];
  class Node{
    constructor(tag='div'){
      this.tagName=tag;this.children=[];this.value='';this.open=false;this.disabled=false;this.attributes={};this.listeners={};this.classes=new Set();
      this.classList={contains:value=>this.classes.has(value),add:value=>this.classes.add(value),remove:value=>this.classes.delete(value),toggle:(value,enabled)=>{if(enabled===undefined)enabled=!this.classes.has(value);if(enabled)this.classes.add(value);else this.classes.delete(value);return enabled;}};
    }
    set className(value){this.classes=new Set(value.split(/\s+/).filter(Boolean));}
    get className(){return [...this.classes].join(' ');}
    set id(value){this.identifier=value;nodes.set('#'+value,this);}
    get id(){return this.identifier;}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=[...children];}
    setAttribute(name,value){this.attributes[name]=value;}
    addEventListener(name,action){this.listeners[name]=action;}
    async dispatch(name){if(this.disabled)return false;const action=this.listeners[name]||this['on'+name];if(action)await action({target:this,currentTarget:this});return true;}
    async click(){return this.dispatch('click');}
    async change(){if(this.disabled)return false;this.checked=!this.checked;return this.dispatch('change');}
    showModal(){this.open=true;}
    close(){this.open=false;}
    focus(){this.focused=true;}
    getContext(){return {drawImage(){}};}
  }
  const $=selector=>{if(!nodes.has(selector))nodes.set(selector,new Node());return nodes.get(selector);};
  const context={$, $$:()=>[],ships:structuredClone(catalog),renderRevision:0,pickerTarget:'from',
    isAdmin:()=>false,hasPrice,routeError,canSelectShip,sortPickerShips,originIds,resolveOrigins,originSelectionError,formatPrice:value=>'$'+value,structuredClone,
    toast:message=>messages.push(message),safely:action=>async event=>{try{return await action(event);}catch(error){messages.push(error.message);}},refresh:async()=>{},
    document:{createElement:tag=>new Node(tag)},render:async(_canvas,state)=>rendered.push(state)};
  $('#library-view').classList.add('hidden');
  const defaults=source.split('\n').find(line=>line.startsWith('function defaultState('));
  runInNewContext(defaults,context);context.state=context.defaultState();
  const helpers=source.split('\n').filter(line=>line.startsWith('function elem(')||line.startsWith('function button(')).join('\n');
  const actions=source.slice(source.indexOf('async function preview(){'),source.indexOf('async function normalize('));
  const clearBinding=source.split('\n').find(line=>line.includes("$('#clear-origins').onclick="));
  const toggleBinding=source.split('\n').find(line=>line.startsWith("$('#multi-from').onchange="));
  assert.ok(actions.includes('function selectShip(')&&actions.includes('function cropControls(')&&clearBinding&&toggleBinding,'exercise the current production UI functions');
  runInNewContext(helpers+'\n'+actions+'\n'+clearBinding+'\n'+toggleBinding,context);
  const pickerIds=()=>$('#picker-grid').children.filter(card=>card.children[0]?.type==='checkbox').map(card=>card.children[0].id.replace('origin-choice-',''));
  const check=id=>$('#origin-choice-'+id);
  const pickerChoice=id=>$('#picker-grid').children.find(card=>card.children.at(-1)?.children[0]?.textContent===catalog.find(ship=>ship.id===id).name);
  const libraryAction=(id,side)=>{
    $('#library-view').classList.remove('hidden');context.drawLibrary();
    const name=catalog.find(ship=>ship.id===id).name,card=$('#library-grid').children.find(card=>card.children[1]?.children[0]?.textContent===name);
    return card.children[1].children.at(-1).children[side==='from'?0:1];
  };
  return {context,$,messages,rendered,pickerIds,check,pickerChoice,libraryAction};
}

for(const file of ['public/app.js','extensions/edge/app.js']){
  test(file+': single origin is the default and selecting another price replaces it and closes the picker',async()=>{
    const page=browser(file),{context}=page;assert.equal(context.state.multiFrom,false);
    context.state.to='target';await context.preview();
    assert.equal(page.$('#multi-from').checked,false);assert.equal(page.$('#origin-count').classList.contains('hidden'),true);
    assert.equal(page.$('#origin-list').classList.contains('hidden'),true);assert.equal(page.$('#origin-help').classList.contains('hidden'),true);
    context.openPicker('from');assert.deepEqual(page.pickerIds(),[]);assert.ok(page.pickerChoice('middle'));await page.pickerChoice('middle').click();
    assert.equal(context.state.from,'middle');assert.equal(page.$('#picker').open,false);
    context.openPicker('from');assert.ok(page.pickerChoice('a'));await page.pickerChoice('a').click();
    assert.equal(context.state.from,'a');assert.equal(page.$('#picker').open,false);
    context.openPicker('from');await page.pickerChoice('a').click();assert.equal(context.state.from,'a');
    assert.equal(page.libraryAction('middle','from').textContent,'设为起点');assert.equal(page.libraryAction('middle','from').disabled,false);
    await page.libraryAction('middle','from').click();assert.equal(context.state.from,'middle');assert.equal(context.state.to,'target');
    assert.deepEqual(Object.keys(context.state.crop.origins),['middle']);
  });

  test(file+': toggling multiple origins on enables checkboxes and off retains the first ship and its crop',async()=>{
    const page=browser(file),{context}=page;context.state.from='a';context.state.to='target';context.state.crop.from={x:23,y:34,zoom:1.2};context.cropControls();await context.preview();
    const firstCrop=context.state.crop.origins.a;await page.$('#multi-from').change();
    assert.equal(context.state.multiFrom,true);assert.equal(context.state.crop.origins.a,firstCrop);assert.equal(page.$('#origin-count').classList.contains('hidden'),false);
    context.openPicker('from');assert.deepEqual(page.pickerIds(),['a','b','c','d']);assert.equal(page.check('a').type,'checkbox');
    await page.check('b').change();await page.check('c').change();assert.deepEqual(Array.from(context.state.from),['a','b','c']);
    const firstY=page.$('#crop-controls').children[0].children[2].children[0];firstY.value='77';await firstY.dispatch('input');
    await page.$('#multi-from').change();
    assert.equal(context.state.multiFrom,false);assert.equal(context.state.from,'a');assert.equal(context.state.crop.origins.a,firstCrop);assert.equal(context.state.crop.origins.a.y,77);
    assert.deepEqual(Object.keys(context.state.crop.origins),['a']);assert.deepEqual(page.pickerIds(),[]);
    for(const selector of ['#origin-count','#origin-list','#origin-help'])assert.equal(page.$(selector).classList.contains('hidden'),true);
    assert.equal(page.$('#multi-from').checked,false);await page.pickerChoice('middle').click();assert.equal(context.state.from,'middle');assert.equal(page.$('#picker').open,false);
  });

  test(file+': checkbox selection stays open, filters same-price origins and enforces three selections',async()=>{
    const page=browser(file),{context}=page;context.state.multiFrom=true;context.state.to='target';context.openPicker('from');
    assert.deepEqual(page.pickerIds(),['a','b','c','d','cheap','middle']);
    await page.check('a').change();
    assert.equal(page.$('#picker').open,true);assert.deepEqual(Array.from(context.state.from),['a']);
    assert.deepEqual(page.pickerIds(),['a','b','c','d']);assert.equal(page.check('a').checked,true);
    await page.check('b').change();await page.check('c').change();
    assert.deepEqual(Array.from(context.state.from),['a','b','c']);assert.equal(page.check('d').disabled,true);
    assert.equal(context.selectShip('from','d'),false);assert.deepEqual(Array.from(context.state.from),['a','b','c']);assert.match(page.messages.at(-1),/最多.*3/);
    await page.check('b').change();assert.equal(page.check('d').disabled,false);await page.check('d').change();
    await context.preview();assert.deepEqual(Array.from(context.state.from),['a','c','d']);assert.equal(page.$('#export').disabled,false);
    assert.equal(page.$('#origin-count').textContent,'3/3');assert.equal(page.$('#swap-ships').disabled,true);
    assert.deepEqual(Array.from(page.rendered.at(-1).from),['a','c','d']);
  });

  test(file+': deselecting every origin and clearing selections unlock a different price tier',async()=>{
    const page=browser(file),{context}=page;context.state.multiFrom=true;context.state.to='target';context.openPicker('from');
    await page.check('a').change();await page.check('a').change();
    assert.deepEqual(Array.from(context.state.from),[]);assert.ok(page.pickerIds().includes('middle'));
    await page.check('middle').change();assert.deepEqual(page.pickerIds(),['middle']);
    await page.$('#picker-clear').click();assert.equal(context.state.from,null);assert.ok(page.pickerIds().includes('a'));
    assert.deepEqual(Object.keys(context.state.crop.origins),[]);await page.check('a').change();
    assert.deepEqual(Array.from(context.state.from),['a']);assert.equal(page.$('#picker').open,true);
  });

  test(file+': library actions apply the same capacity and price rules and can remove selected origins',async()=>{
    const page=browser(file),{context}=page;context.state.multiFrom=true;context.state.to='target';context.selectShip('from','a');
    assert.equal(page.libraryAction('a','from').textContent,'移除起点');assert.equal(page.libraryAction('middle','from').disabled,true);
    assert.equal(page.libraryAction('unknown','from').disabled,true);await page.libraryAction('b','from').click();await page.libraryAction('c','from').click();
    assert.deepEqual(Array.from(context.state.from),['a','b','c']);assert.equal(page.libraryAction('d','from').disabled,true);
    assert.equal(page.libraryAction('a','to').disabled,true);assert.equal(page.libraryAction('cheap','to').disabled,true);assert.equal(page.libraryAction('higher','to').disabled,false);
    await page.libraryAction('b','from').click();assert.deepEqual(Array.from(context.state.from),['a','c']);assert.equal(page.libraryAction('d','from').disabled,false);
    assert.equal(context.selectShip('from','middle'),false);assert.deepEqual(Array.from(context.state.from),['a','c']);
    await page.libraryAction('higher','to').click();assert.equal(context.state.to,'higher');
  });

  test(file+': removing an origin preserves each remaining ship crop and legacy single-origin crop',async()=>{
    const page=browser(file),{context}=page;context.state.multiFrom=true;context.state.from='a';context.state.to='target';context.state.crop.from={x:23,y:34,zoom:1.2};
    context.cropControls();assert.deepEqual({...context.state.crop.origins.a},{x:23,y:34,zoom:1.2});
    context.selectShip('from','b');context.selectShip('from','c');
    const groups=page.$('#crop-controls').children,range=groups[1].children[2].children[0];range.value='77';await range.dispatch('input');
    const b=context.state.crop.origins.b,c=context.state.crop.origins.c;assert.equal(b.y,77);assert.equal(context.state.crop.origins.a.y,34);assert.equal(c.y,50);
    await page.$('#origin-list').children[0].click();
    assert.deepEqual(Array.from(context.state.from),['b','c']);assert.equal(context.state.crop.origins.a,undefined);assert.equal(context.state.crop.origins.b,b);assert.equal(context.state.crop.origins.c,c);
    assert.equal(page.$('#crop-controls').children[0].children[2].children[0].value,77);
    context.selectShip('from','a');assert.deepEqual({...context.state.crop.origins.a},{x:50,y:50,zoom:1});assert.equal(context.state.crop.origins.b.y,77);
  });

  test(file+': legacy string selections render and invalid selected routes cannot export',async()=>{
    const page=browser(file),{context}=page;context.state.from='a';context.state.to='target';await context.preview();
    assert.equal(page.$('#export').disabled,false);assert.equal(page.rendered.at(-1).from,'a');assert.equal(page.$('#origin-count').textContent,'1/3');
    context.openPicker('to');
    const names=page.$('#picker-grid').children.map(card=>card.children[1].children[0].textContent);assert.deepEqual(names,['另一价位','终点','更高终点']);
    context.state.multiFrom=true;
    for(const invalid of [['a','missing'],['a','middle'],['a','b','c','d']]){context.state.from=invalid;await context.preview();assert.equal(page.$('#export').disabled,true);}
    context.state.from=['a','b'];context.state.to='a';await context.preview();assert.equal(page.$('#export').disabled,true);
  });
}
