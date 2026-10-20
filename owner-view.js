'use strict';
(() => {
 const token=location.pathname.split('/').pop();
 const message=document.getElementById('message');
 const button=document.getElementById('confirm');
 const status=document.getElementById('state');

 async function json(url,options){const res=await fetch(url,{cache:'no-store',...options});const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(data.error||'请求失败');return data}
 async function init(){
   try{
     const data=await json('/api/owner-request/'+encodeURIComponent(token));
     message.textContent='💬 '+data.message;
     if(data.status==='confirmed'){button.textContent='✅ 已确认';status.textContent='已通知请求挪车的人';button.disabled=true;}
     else button.disabled=false;
   }catch(e){message.textContent=e.message;button.disabled=true;}
 }
 button.addEventListener('click',async()=>{
   button.disabled=true;button.textContent='确认中…';
   try{
     await json('/api/confirm-move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
     button.textContent='✅ 已确认';status.textContent='已通知对方，你可以去挪车了';
     if(navigator.vibrate)navigator.vibrate(120);
   }catch(e){status.textContent='❌ '+e.message;button.disabled=false;button.textContent='重新确认';}
 });
 init();
})();