'use strict';
// Enhances the original Worker page without modifying the upstream project.
(() => {
 const notify=document.getElementById('notifyBtn');
 const success=document.getElementById('successView');
 if(!notify||!success)return;
 const waiting=document.getElementById('waitingText');
 let current=null,photo=null,objectUrl=null,pollTimer=null;
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
         if(feedback){feedback.classList.remove('hidden');const p=feedback.querySelector('p');if(p)p.textContent='车主已确认收到请求，正在赶来';}
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
     const locationData=typeof userLocation==='undefined'?null:userLocation;
     const message=document.getElementById('msgInput')?.value||'';
     const data=await htmlText(await fetch('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,location:locationData}),cache:'no-store'}));
     current=data;
     resetPhoto();
     showSuccess();
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
     const locationData=typeof userLocation==='undefined'?null:userLocation;
     const data=await htmlText(await fetch('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'再次通知：请尽快挪车',location:locationData}),cache:'no-store'}));
     current=data;
     resetPhoto();
     if(waiting)waiting.textContent='再次通知已发送，等待车主回应…';
     notifyText('✅ 再次通知已发送');
     startPoll();
   }catch(e){notifyText('❌ '+e.message);}
   finally{if(button){button.disabled=false;button.innerHTML='<span>🔔</span><span>再次通知</span>';}}
 };
 const card=document.createElement('section');
 card.id='photoCard';card.className='card photo-card';
 card.innerHTML='<h3 style="margin-bottom:10px">📸 补充现场照片</h3><p style="margin-bottom:14px;color:#657a8b">首次通知成功后，可拍照并单独发送给车主。</p><input id="photoPicker" type="file" accept="image/*" capture="environment" style="position:absolute;left:-9999px;width:1px;height:1px" aria-label="拍摄现场照片"><button id="photoChooseBtn" type="button" style="width:100%;padding:16px;background:#d6f5fa;border:1px solid #93cdda;color:#006978;border-radius:14px;font-weight:bold;font-size:17px">📷 拍照 / 选择照片</button><img id="photoPreview" alt="已选择的现场照片" hidden style="width:100%;max-height:300px;object-fit:contain;margin-top:12px;border-radius:12px"><p id="photoStatus" role="status" style="margin:12px 0;color:#355e6b;font-size:14px"></p><button id="photoSendBtn" type="button" hidden style="width:100%;background:#159f79;color:#fff;padding:15px;border:0;border-radius:14px;font-weight:bold">发送照片给车主</button>';
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
   send.hidden=true;
   try{
     if(!file.type.startsWith('image/'))throw Error('请选择图片');
     state.textContent='正在处理照片…';
     const img=await new Promise((resolve,reject)=>{
       const url=URL.createObjectURL(file),image=new Image();
       image.onload=()=>{URL.revokeObjectURL(url);resolve(image);};
       image.onerror=()=>{URL.revokeObjectURL(url);reject(Error('照片解码失败'));};
       image.src=url;
     });
     const canvas=document.createElement('canvas');
     const scale=Math.min(1,1200/Math.max(img.naturalWidth,img.naturalHeight));
     canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
     canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
     const ctx=canvas.getContext('2d');
     if(!ctx)throw Error('设备不支持图片压缩');
     ctx.drawImage(img,0,0,canvas.width,canvas.height);
     photo=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.72));
     if(!photo||photo.size>1572864||photo.size<32)throw Error('照片过大，请换一张');
     if(objectUrl)URL.revokeObjectURL(objectUrl);
     objectUrl=URL.createObjectURL(photo);
     preview.src=objectUrl;preview.hidden=false;
     send.hidden=false;
     state.textContent='✅ 照片已准备好，点击下方发送按钮';
   }catch(e){state.textContent='❌ '+e.message;}
   picker.value='';
 });
 send.addEventListener('click',async()=>{
   if(!current?.photoToken||!photo){state.textContent='请先拍照';return;}
   send.disabled=true;choose.disabled=true;
   state.textContent='正在上传并发送照片…';
   try{
     const data=await htmlText(await fetch('/api/photo',{method:'POST',headers:{'Content-Type':'image/jpeg','X-Photo-Token':current.photoToken},body:photo,cache:'no-store'}));
     if(!data.success)throw Error('照片未能送达，请稍后重试');
     state.textContent='✅ 已发送照片给车主';
     current.photoToken=null;send.hidden=true;choose.hidden=true;
   }catch(e){state.textContent='❌ '+e.message;}
   finally{send.disabled=false;choose.disabled=false;}
 });
})();