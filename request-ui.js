'use strict';
// Enhances the original Worker page without modifying the upstream project.
(() => {
 const notify=document.getElementById('notifyBtn');
 const success=document.getElementById('successView');
 if(!notify||!success)return;
 const waiting=document.getElementById('waitingText');
 let current=null,photo=null,objectUrl=null,pollTimer=null,contactTimer=null,startedAt=0,confirmed=false,wechatId='';
 const successCard=success.querySelector('.success-card');
 const contactCard=success.querySelector('.action-card');
 const phone=contactCard?.querySelector('.btn-phone');
 const originalPhoneHref=phone?.getAttribute('href')||'';
 if(phone){phone.innerHTML=phone.innerHTML.replace('直接打电话','电话联系');phone.removeAttribute('href');phone.setAttribute('aria-disabled','true');phone.style.pointerEvents='none';phone.style.opacity='.5';}
 const callHint=document.createElement('p');callHint.id='phoneCountdown';callHint.style.cssText='text-align:center;font-size:14px;color:#64748b;margin:8px 0';
 if(phone)phone.insertAdjacentElement('afterend',callHint);
 const wechatButton=document.createElement('button');
 wechatButton.id='wechatContactBtn';wechatButton.type='button';wechatButton.textContent='💬 微信联系（未配置）';wechatButton.disabled=true;
 wechatButton.style.cssText='display:block;width:100%;margin:0;padding:16px 12px;border-radius:16px;border:none;background:linear-gradient(135deg,#17b97e,#0da56e);color:white;font-size:17px;font-weight:700';
 if(phone)phone.insertAdjacentElement('beforebegin',wechatButton);
 const wechatMessage=document.createElement('p');wechatMessage.id='wechatCopyHint';wechatMessage.setAttribute('role','status');wechatMessage.style.cssText='position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
 wechatButton.insertAdjacentElement('afterend',wechatMessage);
 function refreshContact(){
   if(!phone)return;
   const remaining=startedAt?Math.max(0,60-Math.floor((Date.now()-startedAt)/1000)):60;
   const canCall=!!startedAt&&!confirmed&&remaining===0&&!!originalPhoneHref&&originalPhoneHref!=='tel:';
   if(canCall){phone.setAttribute('href',originalPhoneHref);phone.removeAttribute('aria-disabled');phone.style.pointerEvents='';phone.style.opacity='';}
   else{phone.removeAttribute('href');phone.setAttribute('aria-disabled','true');phone.style.pointerEvents='none';phone.style.opacity='.5';}
   if(startedAt&&!confirmed&&remaining>0){callHint.textContent='⏳ 车主尚未回应，'+remaining+' 秒后可直接打电话';}
   else if(confirmed){callHint.textContent='✅ 车主已回应，无需等待';}
   else if(canCall){callHint.textContent='📞 等待已超过 60 秒，现在可以联系车主';}
   else{callHint.textContent='请先发送通知';}
 }
 function beginWait(){if(!startedAt||confirmed)startedAt=Date.now();confirmed=false;refreshContact();if(!contactTimer)contactTimer=setInterval(refreshContact,1000);}
 async function copyWechat(){
   if(!wechatId)return;
   try{
     if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(wechatId);
     else {const t=document.createElement('textarea');t.value=wechatId;t.style.position='fixed';t.style.left='-9999px';document.body.appendChild(t);t.select();if(!document.execCommand('copy'))throw Error('复制失败');t.remove();}
     wechatMessage.textContent='已复制微信号，请添加车主微信';notifyText('已复制微信号，请添加车主微信');
   }catch {wechatMessage.textContent='复制失败，请手动复制：'+wechatId;notifyText('复制失败，请手动复制：'+wechatId);}
 }
 wechatButton.addEventListener('click',copyWechat);
 fetch('/api/site-config',{cache:'no-store'}).then(r=>r.ok?r.json():{}).then(c=>{wechatId=c.wechatId||'';wechatButton.disabled=!wechatId;wechatButton.textContent=wechatId?'💬 微信联系':'💬 微信联系（车主未配置）';}).catch(()=>{});
 refreshContact();
 const notifyText=(text)=>{
   if(typeof showToast==='function')showToast(text);
   else{let status=document.getElementById('photoStatus');if(status)status.textContent=text;}
 };
 const htmlText=async(response)=>{
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||'发送失败，请重试');
   return data;
 };
 function showSuccess(){
   document.getElementById('mainView').style.display='none';
   success.style.display='flex';
   if(waiting)waiting.textContent='正在等待车主回应…';
   if(successCard)successCard.style.display='block';
   const feedback=success.querySelector('#ownerFeedback');if(feedback){feedback.classList.add('hidden');feedback.style.display='none';}
 }
 function startPoll(){
   if(pollTimer)clearInterval(pollTimer);
   const update=async()=>{
     if(!current)return;
     try{
       const data=await htmlText(await fetch('/api/request-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:current.requestId,pollToken:current.pollToken}),cache:'no-store'}));
       if(data.status==='confirmed'){
         clearInterval(pollTimer);pollTimer=null;
         const feedback=document.getElementById('ownerFeedback');
         confirmed=true;refreshContact();if(successCard)successCard.style.display='none';
         if(feedback){feedback.classList.remove('hidden');feedback.style.display='block';const p=feedback.querySelector('p');if(p)p.textContent='车主已确认收到请求，正在赶来';}
         if(waiting)waiting.textContent='✅ 车主已经确认，正在赶来';
         if(navigator.vibrate)navigator.vibrate([150,80,150]);
       }
     }catch(e){if(e.message.includes('过期')){clearInterval(pollTimer);pollTimer=null;if(waiting)waiting.textContent='请求已过期，请重新发起';}}
   };
   update();
   pollTimer=setInterval(update,1200);
 }
 function resetPhoto(){
   photo=null;
   if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
   const preview=document.getElementById('photoPreview');
   const send=document.getElementById('photoSendBtn');
   const choose=document.getElementById('photoChooseBtn');
   const status=document.getElementById('photoStatus');
   if(preview){preview.src='';preview.hidden=true;}
   if(send)send.hidden=true;
   if(choose){choose.disabled=false;choose.hidden=false;}
   if(status)status.textContent='';
 }
 // Original markup calls sendNotify() directly, so overriding it here takes effect immediately.
 window.sendNotify=async function(){
   if(notify.disabled)return;
   notify.disabled=true;notify.innerHTML='<span>⏳</span><span>发送中…</span>';
   try{
     const message=document.getElementById('msgInput')?.value||'';
     const data=await htmlText(await fetch('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message}),cache:'no-store'}));
     current=data;
     resetPhoto();
     showSuccess();
     beginWait();
     notifyText('✅ 已发送，请等待车主确认');
     startPoll();
   }catch(e){
     notifyText('❌ '+e.message);
   }finally{
     notify.disabled=false;notify.innerHTML='<span>🔔</span><span>一键通知车主</span>';
   }
 };
 window.retryNotify=async function(){
   const button=document.getElementById('retryBtn');
   if(button?.disabled)return;
   if(button){button.disabled=true;button.innerHTML='⏳ 再次通知中…';}
   try{
     const data=await htmlText(await fetch('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'再次通知：请尽快挪车'}),cache:'no-store'}));
     current=data;
     resetPhoto();
     showSuccess();beginWait();
     if(waiting)waiting.textContent='再次通知已发送，等待车主回应…';
     notifyText('✅ 再次通知已发送');
     startPoll();
   }catch(e){notifyText('❌ '+e.message);}
   finally{if(button){button.disabled=false;button.innerHTML='<span>🔔</span><span>再次通知</span>';}}
 };
 const card=document.createElement('section');
 card.id='photoCard';card.className='card photo-card';
 card.innerHTML='<h3 style="margin-bottom:10px">📸 补充现场照片</h3><input id="photoPicker" type="file" accept="image/*" capture="environment" style="position:absolute;left:-9999px;width:1px;height:1px" aria-label="拍摄现场照片"><button id="photoChooseBtn" type="button" style="width:100%;padding:16px;background:#d6f5fa;border:1px solid #93cdda;color:#006978;border-radius:14px;font-weight:bold;font-size:17px">📷 拍照 / 选择照片</button><img id="photoPreview" alt="已选择的现场照片" hidden style="width:100%;max-height:300px;object-fit:contain;margin-top:12px;border-radius:12px"><p id="photoStatus" role="status" style="margin:12px 0;color:#355e6b;font-size:14px"></p><button id="photoSendBtn" type="button" hidden style="width:100%;background:#159f79;color:#fff;padding:15px;border:0;border-radius:14px;font-weight:bold">发送照片给车主</button>';
 const actionCard=success.querySelector('.action-card');
 success.insertBefore(card,actionCard||null);
 const choose=document.getElementById('photoChooseBtn');
 const picker=document.getElementById('photoPicker');
 const preview=document.getElementById('photoPreview');
 const send=document.getElementById('photoSendBtn');
 const state=document.getElementById('photoStatus');
 choose.addEventListener('click',()=>{
   if(!current?.photoToken){state.textContent='⚠️ 请先发送挪车通知';return;}
   state.textContent='请选择相机或照片…';
   picker.click();
 });
 picker.addEventListener('change',async()=>{
   const file=picker.files?.[0];if(!file)return;
   send.hidden=true;photo=null;
   try{
     const head=new Uint8Array(await file.slice(0,32).arrayBuffer());
     const ascii=(a,b)=>Array.from(head.slice(a,b),x=>String.fromCharCode(x)).join('');
     let type='';
     if(head[0]===255&&head[1]===216&&head[2]===255)type='image/jpeg';
     else if(head.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>head[i]===v))type='image/png';
     else if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP')type='image/webp';
     else if(ascii(4,8)==='ftyp'&&['heic','heix','hevc','hevx','mif1','msf1','heis','heim'].includes(ascii(8,12)))type='image/heic';
     if(!type)throw Error('仅支持 JPEG、PNG、WebP 或 HEIC/HEIF 原图');
     if(file.size<32||file.size>10*1024*1024)throw Error('请选取不超过 10 MB 的原图');
     photo={file,type};
     if(objectUrl)URL.revokeObjectURL(objectUrl);
     objectUrl=URL.createObjectURL(file);
     // Preview is optional: decoding is NOT required to upload the original file.
     preview.onerror=()=>{preview.hidden=true;state.textContent='✅ 原图已就绪（当前浏览器无法预览此格式），仍可直接发送';};
     preview.onload=()=>{preview.hidden=false;};
     preview.src=objectUrl;preview.hidden=type==='image/heic';
     send.hidden=false;
     state.textContent=type==='image/heic'
       ? '✅ HEIC 原图已就绪，可直接发送；部分消息 App 不支持内嵌预览'
       : '✅ 原图已就绪（'+(file.size/1048576).toFixed(1)+' MB），点击下方发送';
   }catch(e){state.textContent='❌ '+e.message;preview.hidden=true;}
   picker.value='';
 });
 send.addEventListener('click',async()=>{
   if(!current?.photoToken||!photo){state.textContent='请先拍照';return;}
   send.disabled=true;choose.disabled=true;
   state.textContent='正在上传并发送照片…';
   try{
     const data=await htmlText(await fetch('/api/photo',{method:'POST',headers:{'Content-Type':photo.type,'X-Photo-Token':current.photoToken},body:photo.file,cache:'no-store'}));
     if(!data.success)throw Error('照片未能送达，请稍后重试');
     state.textContent='✅ 已发送照片给车主';
     current.photoToken=null;send.hidden=true;choose.hidden=true;
   }catch(e){state.textContent='❌ '+e.message;}
   finally{send.disabled=false;choose.disabled=false;}
 });
})();