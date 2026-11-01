export function setupFeedback({api,getUser,refreshUser}){
  const $=id=>document.getElementById(id),dialog=$('feedback-dialog'),form=$('feedback-form'),content=$('feedback-content'),list=$('feedback-list'),status=$('feedback-status'),more=$('feedback-more');
  const userKey=()=>{const user=getUser();return user?user.id+':'+user.role:'';};
  let key='',revision=0,offset=0,busy=false,hasMore=false;
  function controls(){form.querySelector('button').disabled=busy;$('feedback-refresh').disabled=busy;more.disabled=busy;more.classList.toggle('hidden',!hasMore);}
  function clear(){revision++;offset=0;busy=false;hasMore=false;content.value='';list.replaceChildren();status.textContent='';controls();}
  function reset(){clear();if(dialog.open)dialog.close();}
  function sync(){
    const next=userKey();if(next!==key){reset();key=next;}
    const user=getUser(),admin=user?.role==='admin';$('feedback-open').classList.toggle('hidden',!user);$('feedback-open').textContent=admin?'查看留言板':'留言板';form.classList.toggle('hidden',!user||admin);$('feedback-title').textContent=admin?'查看留言板':'留言板';$('feedback-list-title').textContent=admin?'用户留言':'我的留言';
  }
  const current=(version,identity)=>version===revision&&identity===userKey()&&dialog.open;
  function draw(messages){
    for(const message of messages){
      const article=document.createElement('article'),meta=document.createElement('div'),text=document.createElement('p');
      article.className='feedback-entry';meta.className='muted';meta.textContent=[message.email,new Date(message.createdAt).toLocaleString('zh-CN')].filter(Boolean).join(' · ');text.textContent=message.content;article.append(meta,text);list.append(article);
    }
  }
  async function load(append=false){
    if(busy)return;const version=revision,identity=userKey();busy=true;controls();status.textContent='正在读取留言…';
    try{
      const result=await api('/api/feedback?offset='+(append?offset:0)+'&limit=50');if(!current(version,identity))return;
      if(!append){list.replaceChildren();offset=0;}draw(result.messages);offset+=result.messages.length;hasMore=result.hasMore;status.textContent=offset?'':'暂无留言。';
    }catch(error){if(current(version,identity))status.textContent=error.message;}
    finally{if(current(version,identity)){busy=false;controls();}}
  }
  $('feedback-open').onclick=async()=>{
    try{if(!await refreshUser())return;sync();clear();dialog.showModal();if(getUser()?.role!=='admin')content.focus();await load();}
    catch(error){status.textContent=error.message;}
  };
  $('feedback-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{if(!dialog.open)clear();});
  $('feedback-refresh').onclick=()=>load();more.onclick=()=>load(true);
  form.onsubmit=async event=>{
    event.preventDefault();if(busy||getUser()?.role!=='user')return;
    const value=content.value.trim();if(!value){status.textContent='请填写留言内容。';content.focus();return;}
    const version=revision,identity=userKey();busy=true;controls();status.textContent='正在提交…';let saved=false;
    try{await api('/api/feedback','POST',{content:value});if(!current(version,identity))return;content.value='';saved=true;}
    catch(error){if(current(version,identity))status.textContent=error.message;}
    finally{if(current(version,identity)){busy=false;controls();}}
    if(saved&&current(version,identity)){await load();if(current(version,identity))status.textContent='留言已提交，谢谢你的建议。';}
  };
  sync();return {sync,reset};
}
