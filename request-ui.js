'use strict';
// Enhances the original Worker page without modifying the upstream project.
(() => {
 const notify=document.getElementById('notifyBtn');
 const success=document.getElementById('successView');
 if(!notify||!success)return;
 const waiting=document.getElementById('waitingText');
 let current=null,photo=null,objectUrl=null,pollTimer=null,contactTimer=null,startedAt=0,confirmed=false,wechatId='',visitorPhoneEnabled=false,visitorPhoneSent=false,phoneSubmitting=false;
 const successCard=success.querySelector('.success-card');
 const successTitle=successCard?.querySelector('h2');
 const contactCard=success.querySelector('.action-card');
 const phone=contactCard?.querySelector('.btn-phone');
 const retry=contactCard?.querySelector('#retryBtn');
 const originalPhoneHref=phone?.getAttribute('href')||'';
 let phoneAvailable=/^tel:\\+?[0-9][0-9+() -]*$/i.test(originalPhoneHref);
 const notice=document.createElement('p');
 notice.id='contactNotice';
 notice.setAttribute('role','status');
 notice.setAttribute('aria-live','polite');
 notice.style.cssText='font-size:12px;color:#617586;text-align:center;margin:4px 0 0;min-height:0';
 function showContactNotice(message){
   notice.textContent=message;
   clearTimeout(showContactNotice.timer);
   showContactNotice.timer=setTimeout(()=>{notice.textContent='';},3200);
 }
 window.moveCarContactNotice=showContactNotice;
 const wechatButton=document.createElement('button');
 wechatButton.id='wechatContactBtn';
 wechatButton.type='button';
 wechatButton.textContent='💬 微信联系';
 wechatButton.className='movecar-contact movecar-wechat unavailable';
 wechatButton.setAttribute('aria-disabled','true');
 const callbackButton=document.createElement('button');
 callbackButton.id='visitorPhoneBtn';
 callbackButton.type='button';
 callbackButton.textContent='📱 留下电话';
 callbackButton.className='movecar-contact movecar-callback unavailable';
 callbackButton.setAttribute('aria-disabled','true');
 function setUnavailable(el,notAvailable){
   if(!el)return;
   el.classList.toggle('unavailable',notAvailable);
   el.setAttribute('aria-disabled',String(notAvailable));
   if(!el.classList.contains('movecar-contact'))el.classList.add('movecar-contact');
 }
 if(phone){
   phone.textContent='☎️ 电话联系';
   phone.classList.add('movecar-phone');
   if(!phoneAvailable)phone.removeAttribute('href');
   phone.addEventListener('click',e=>{
     if(!phoneAvailable){e.preventDefault();showContactNotice('车主未配置');}
   });
   setUnavailable(phone,!phoneAvailable);
 }
 function refreshContact(){setUnavailable(phone,!phoneAvailable);setUnavailable(callbackButton,!visitorPhoneEnabled||visitorPhoneSent);}
 function beginWait(){if(!startedAt||confirmed)startedAt=Date.now();confirmed=false;visitorPhoneSent=false;refreshContact();}
 async function copyWechat(){
   if(!wechatId){showContactNotice('车主未配置');return;}
   try{
     if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(wechatId);
     else{
       const text=document.createElement('textarea');text.value=wechatId;text.style.position='fixed';text.style.left='-9999px';
       document.body.appendChild(text);text.select();if(!document.execCommand('copy'))throw Error('复制失败');text.remove();
     }
     showContactNotice('微信号已复制');
   }catch{showContactNotice('复制失败，请手动复制：'+wechatId);}
 }
 wechatButton.addEventListener('click',copyWechat);
 if(contactCard){
   // First button is retry; voice-entry.js inserts "语音通话" after retry.
   if(retry)contactCard.append(retry);
   contactCard.append(callbackButton);
   contactCard.append(wechatButton);
   if(phone)contactCard.append(phone);
   contactCard.append(notice);
 }
 fetch('/api/site-config',{cache:'no-store'})
   .then(r=>r.ok?r.json():{})
   .then(c=>{
     wechatId=typeof c.wechatId==='string'?c.wechatId.trim():'';
     visitorPhoneEnabled=c.visitorPhoneEnabled===true;
     refreshContact();
     setUnavailable(wechatButton,!wechatId);
   }).catch(()=>{visitorPhoneEnabled=false;refreshContact();setUnavailable(wechatButton,true);});
 const cosmetic=document.createElement('style');
 cosmetic.textContent=`
   #successView .action-card{display:flex;flex-direction:column;gap:10px}
   #successView .action-card .movecar-contact,#successView .action-card #retryBtn{
     display:block;width:100%;min-height:54px;border:0;border-radius:15px;
     margin:0;padding:13px 14px;text-align:center;
     font-size:16px;font-weight:750;line-height:1.25;text-decoration:none;
     cursor:pointer;box-sizing:border-box;
   }
   #successView .action-card #retryBtn{background:linear-gradient(110deg,#f5a20a,#df7c00);color:#fff}
   #successView .action-card .movecar-voice{background:#087e6f;color:#fff}
   #successView .action-card .movecar-callback{background:#357fc9;color:#fff}
   #successView .action-card .movecar-wechat{background:#13a879;color:#fff}
   #successView .action-card .movecar-phone{background:#e98b90;color:#fff}
   #successView .action-card .unavailable,
   #successView .action-card [aria-disabled="true"]{background:#e4e7e9!important;color:#88929b!important;cursor:pointer;opacity:1!important}
   #contactNotice:empty{display:none}
   #photoCard{margin-top:14px}
   .movecar-phone-modal[hidden]{display:none!important}
   .movecar-phone-modal{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:18px;background:#122d3a99}
   .movecar-phone-panel{width:min(100%,460px);padding:24px 18px;background:#fff;border-radius:22px;box-shadow:0 22px 70px #0d344044;color:#19303b}
   .movecar-phone-panel h2{margin:0 0 7px;font-size:21px}
   .movecar-phone-panel p{margin:0 0 18px;color:#667884;font-size:13px}
   .movecar-phone-digits{position:relative;display:flex;gap:4px;margin:12px 0 20px;cursor:text}
   .movecar-phone-digits span{flex:1;min-width:0;height:43px;display:grid;place-items:center;border:1px solid #cbd7de;border-radius:7px;font-size:18px;font-weight:700;background:#f8fafb}
   .movecar-phone-digits span:nth-of-type(3),.movecar-phone-digits span:nth-of-type(7){margin-right:8px}
   .movecar-phone-digits span.active{border-color:#087e6f;background:#eef9f5}
   .movecar-phone-digits input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:text;font-size:16px}
   .movecar-phone-actions{display:flex;gap:10px}
   .movecar-phone-actions button{flex:1;min-height:48px;border:0;border-radius:12px;font-weight:750;font-size:15px}
   .movecar-phone-cancel{background:#eef2f4;color:#405665}
   .movecar-phone-submit{background:#087e6f;color:#fff}
   .movecar-phone-submit:disabled{background:#dce3e6;color:#8d9ba3;cursor:not-allowed}
   .movecar-phone-status{min-height:20px;margin:10px 0 0!important;color:#c44747!important}
 `;
 document.head.appendChild(cosmetic);
 const phoneModal=document.createElement('div');
 phoneModal.className='movecar-phone-modal';phoneModal.hidden=true;
 phoneModal.innerHTML='<form class="movecar-phone-panel" role="dialog" aria-modal="true" aria-labelledby="visitorPhoneTitle"><h2 id="visitorPhoneTitle">留下联系电话</h2><p>车主收到号码后可以拨打联系你</p><div class="movecar-phone-digits"><input id="visitorPhoneInput" type="tel" inputmode="numeric" pattern="[0-9]*" autocomplete="tel" maxlength="11" aria-label="11 位电话号码"><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span></div><div class="movecar-phone-actions"><button type="button" class="movecar-phone-cancel">取消</button><button type="submit" class="movecar-phone-submit" disabled>发送给车主</button></div><p class="movecar-phone-status" role="status" aria-live="polite"></p></form>';
 document.body.appendChild(phoneModal);
 const phoneInput=phoneModal.querySelector('#visitorPhoneInput');
 const digitBoxes=[...phoneModal.querySelectorAll('.movecar-phone-digits span')];
 const phoneSubmit=phoneModal.querySelector('.movecar-phone-submit');
 const phoneStatus=phoneModal.querySelector('.movecar-phone-status');
 const renderPhone=()=>{
   const digits=phoneInput.value.replace(/\D/g,'').slice(0,11);
   if(phoneInput.value!==digits)phoneInput.value=digits;
   digitBoxes.forEach((box,index)=>{box.textContent=digits[index]||'';box.classList.toggle('active',!phoneModal.hidden&&index===digits.length&&digits.length<11);});
   phoneSubmit.disabled=phoneSubmitting||digits.length!==11;
 };
 const closePhone=()=>{phoneModal.hidden=true;phoneInput.blur();phoneStatus.textContent='';};
 phoneInput.addEventListener('input',renderPhone);
 phoneModal.querySelector('.movecar-phone-cancel').addEventListener('click',closePhone);
 phoneModal.addEventListener('click',event=>{if(event.target===phoneModal)closePhone();});
 phoneModal.addEventListener('keydown',event=>{if(event.key==='Escape')closePhone();});
 callbackButton.addEventListener('click',()=>{
   if(!visitorPhoneEnabled){showContactNotice('车主未开启留下电话');return;}
   if(visitorPhoneSent){showContactNotice('电话号码已发送');return;}
   if(!current?.requestId||!current?.pollToken){showContactNotice('请先重新发送挪车通知');return;}
   phoneInput.value='';phoneModal.hidden=false;phoneStatus.textContent='';renderPhone();
   phoneInput.focus({preventScroll:true});
 });
 phoneModal.querySelector('form').addEventListener('submit',async event=>{
   event.preventDefault();
   if(phoneSubmit.disabled||!current?.requestId||!current?.pollToken)return;
   const payload={requestId:current.requestId,pollToken:current.pollToken,phone:phoneInput.value};
   phoneSubmitting=true;phoneSubmit.disabled=true;phoneStatus.textContent='正在发送…';
   try{
     await htmlText(await fetch('/api/visitor-phone',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store'}));
     visitorPhoneSent=true;if(successTitle)successTitle.textContent='电话号码已发送';refreshContact();closePhone();showContactNotice('电话号码已发送给车主');
   }catch(error){phoneStatus.textContent=error.message;}
   finally{phoneSubmitting=false;renderPhone();}
 });
 try{
   const recent=Number(sessionStorage.getItem('movecar-last-notified')||0);
   if(new URLSearchParams(location.search).get('contact')==='1' &&
       recent&&Date.now()-recent<12*60*1000){
     sessionStorage.removeItem('movecar-last-notified');
     document.getElementById('mainView').style.display='none';
     success.style.display='flex';
     if(waiting)waiting.textContent='通知已发送，等待车主回应…';
     const clean=new URL(location.href);
     clean.searchParams.delete('contact');
     history.replaceState(history.state,'',clean.pathname+clean.search+clean.hash);
   }
 }catch{}
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
   if(successTitle)successTitle.textContent='通知已发送！';
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
