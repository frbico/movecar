'use strict';
(()=>{
 const owner=location.pathname==='/voice/owner';
 const start=document.querySelector('#start'),hangup=document.querySelector('#hangup');
 const label=document.querySelector('#status'),timer=document.querySelector('#timer');
 document.querySelector('#title').textContent=owner?'正在接听挪车电话':'呼叫车主（网络语音）';
 let callId='',auth='',pc=null,localStream=null,last=0,poller=null,closed=false,offerSent=false,inCallAt=0,iceServers=[{urls:['stun:stun.l.google.com:19302']}];
 const say=s=>{label.textContent=s;};
 async function api(endpoint,body){
   const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(d.error||'请求失败 ('+r.status+')');
   return d;
 }
 const endpoint=action=>`/api/voice/calls/${encodeURIComponent(callId)}/${action}`;
 async function signal(kind,payload){
   try{await api(endpoint('signal'),{token:auth,kind,payload});}catch(e){if(!closed)say('网络信令失败：'+e.message);}
 }
 async function peer(){
   if(pc)return;
   pc=new RTCPeerConnection({iceServers});
   pc.ontrack=e=>{document.getElementById('remote').srcObject=e.streams[0];};
   pc.onicecandidate=e=>{if(e.candidate)signal('ice',e.candidate.toJSON());};
   pc.onconnectionstatechange=()=>{
     if(closed)return;
     if(pc.connectionState==='connected'){if(!inCallAt)inCallAt=Date.now();say('✅ 通话中');}
     else if(pc.connectionState==='failed')say('音频连接失败，可能需要 TURN 中继');
   };
   localStream.getTracks().forEach(track=>pc.addTrack(track,localStream));
 }
 async function stop(sendEnd=true,finishText='通话已结束'){
   if(closed)return;closed=true;
   if(poller)clearTimeout(poller);
   hangup.hidden=true;start.hidden=true;
   if(sendEnd&&callId&&auth)api(endpoint('end'),{token:auth}).catch(()=>{});
   try{pc?.close();}catch{}
   localStream?.getTracks().forEach(t=>t.stop());
   if(finishText)say(finishText);
 }
 async function poll(){
   if(closed)return;
   try{
     const data=await api(endpoint('events'),{token:auth,after:last});
     if(['missed','rejected','ended'].includes(data.status)){
       say(data.status==='missed'?'车主暂未接听':data.status==='rejected'?'车主拒绝了本次呼叫':'通话已结束');
       await stop(false,data.status==='missed'?'车主暂未接听':data.status==='rejected'?'车主拒绝了本次呼叫':'通话已结束');return;
     }
     if(data.status==='active'&&!pc){await peer();}
     if(!owner&&data.status==='active'&&!offerSent){
       offerSent=true;say('车主已接听，正在建立音频连接…');
       const offer=await pc.createOffer({offerToReceiveAudio:true});
       await pc.setLocalDescription(offer);
       await signal('offer',{type:offer.type,sdp:offer.sdp});
     }
     for(const event of data.events){
       last=Math.max(last,event.seq);
       if(event.kind==='offer'&&owner){
         await pc.setRemoteDescription(new RTCSessionDescription(event.payload));
         const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
         await signal('answer',{type:answer.type,sdp:answer.sdp});
       }else if(event.kind==='answer'&&!owner){await pc.setRemoteDescription(new RTCSessionDescription(event.payload));}
       else if(event.kind==='ice'){
         // Candidates can arrive before SDP; defer until remote description is set.
         if(pc?.remoteDescription)await pc.addIceCandidate(new RTCIceCandidate(event.payload));
         else pendingIce.push(event.payload);
       }
     }
     if(pc?.remoteDescription&&pendingIce.length){
       for(const candidate of pendingIce.splice(0))await pc.addIceCandidate(new RTCIceCandidate(candidate));
     }
     if(inCallAt)timer.textContent='已通话 '+Math.floor((Date.now()-inCallAt)/1000)+' 秒';
   }catch(e){if(!closed)say('网络连接异常：'+e.message);}
   if(!closed)poller=setTimeout(poll,900);
 }
 const pendingIce=[];
 async function begin(){
   start.hidden=true;hangup.hidden=false;
   try{
     if(owner){
       const p=new URLSearchParams(location.hash.slice(1));callId=p.get('callId')||'';auth=p.get('token')||'';
       if(!/^[A-Za-z0-9_-]{24}$/.test(callId)||!/^[A-Za-z0-9_-]{43}$/.test(auth))throw Error('通话链接已失效');
       history.replaceState(null,'',location.pathname);
     }
     if(!navigator.mediaDevices?.getUserMedia)throw Error('浏览器不支持麦克风，请使用 HTTPS 页面');
     say('正在申请麦克风权限…');
     // Android WebView only acquires microphone after the owner explicitly answers.
     localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
     if(owner){
       say('正在连接扫码者…');
     }else{
       say('正在联系车主…');
       const r=await api('/api/voice/start',{});
       callId=r.callId;auth=r.token;iceServers=r.iceServers||iceServers;
       say('呼叫已发出，等待车主接听…');
     }
     // peer() uses the stream already acquired above.
     poll();
   }catch(e){await stop(true,'无法呼叫：'+e.message);}
 }
 start.addEventListener('click',begin);
 hangup.addEventListener('click',()=>stop());
 window.addEventListener('pagehide',()=>{
   if(!closed&&callId&&auth){
     const blob=new Blob([JSON.stringify({token:auth})],{type:'application/json'});
     navigator.sendBeacon?.(endpoint('end'),blob);
   }
   if(!closed)stop(false);
 });
 if(owner){start.textContent='连接通话';begin();}
})();
