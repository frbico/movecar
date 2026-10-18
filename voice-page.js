'use strict';
(() => {
  const owner=location.pathname==='/voice/owner';
  const start=document.querySelector('#start'),hangup=document.querySelector('#hangup');
  const label=document.querySelector('#status'),timer=document.querySelector('#timer');
  const speaker=document.querySelector('#speaker');
  const audioNote=document.querySelector('#audioRouteNote');
  const remote=document.querySelector('#remote');
  let speakerOn=false;
  async function audioOutputs(){
    try{return (await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audiooutput');}
    catch{return [];}
  }
  async function preferReceiver(){
    speakerOn=false;
    speaker.setAttribute('aria-pressed','false');
    speaker.textContent='🔈 开启免提';
    if(typeof remote.setSinkId!=='function'){
      audioNote.textContent='浏览器无法直接指定听筒，使用手机当前音频路由；可通过系统音频设置切换。';
      return;
    }
    const devices=await audioOutputs();
    const receiver=devices.find(d=>/earpiece|receiver|听筒/i.test(d.label));
    const preferred=receiver?.deviceId||'communications';
    try{
      await remote.setSinkId(preferred);
      audioNote.textContent='优先使用听筒 / 通信音频输出';
    }catch{
      audioNote.textContent='本浏览器未提供听筒路由，使用当前系统默认音频输出。';
    }
  }
  async function toggleAudioRoute(){
    if(!speakerOn){
      const devices=await audioOutputs();
      const output=devices.find(d=>/speaker|扬声器|免提/i.test(d.label));
      if(typeof remote.setSinkId==='function'&&output){
        try{
          await remote.setSinkId(output.deviceId);
          speakerOn=true;speaker.textContent='🔉 关闭免提';
          speaker.setAttribute('aria-pressed','true');audioNote.textContent='当前音频输出：扬声器';
          return;
        }catch{}
      }
      if(typeof navigator.mediaDevices.selectAudioOutput==='function'){
        try{
          const choice=await navigator.mediaDevices.selectAudioOutput();
          await remote.setSinkId(choice.deviceId);
          speakerOn=true;speaker.textContent='🔉 返回听筒';
          speaker.setAttribute('aria-pressed','true');
          audioNote.textContent='已切换至选择的音频输出';
          return;
        }catch{}
      }
      audioNote.textContent='当前浏览器不允许网页强制开启扬声器，请从手机系统音频菜单切换。';
    }else await preferReceiver();
  }
  document.querySelector('#title').textContent=owner?'接听挪车语音':'呼叫车主（网络语音）';
  const defaultIce=[{urls:['stun:stun.l.google.com:19302']}];
  let callId='',auth='',pc=null,localStream=null,last=0,poller=null,closed=false;
  let offerSent=false,inCallAt=0,connectSince=0,retryTicket='',retrying=false;
  let iceServers=defaultIce,pollFailures=0,lastPathCheck=0;
  const pendingIce=[];
  let pendingAnswer=null;
  const say=s=>{label.textContent=s;};
  async function api(endpoint,body){
    const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(8500)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(d.error||'请求失败 (HTTP '+r.status+')');
    return d;
  }
  const endpoint=action=>'/api/voice/calls/'+encodeURIComponent(callId)+'/'+action;
  async function signal(kind,payload){
    try{await api(endpoint('signal'),{token:auth,kind,payload});return true;}
    catch(e){if(!closed)say('网络信令不稳定：'+e.message);return false;}
  }
  function releaseMedia(){
    if(pc){try{pc.close();}catch{}pc=null;}
    localStream?.getTracks().forEach(t=>t.stop());localStream=null;
  }
  async function stop(sendEnd=true,message='通话已结束'){
    if(closed)return;
    closed=true;
    if(poller)clearTimeout(poller);
    poller=null;
    if(sendEnd&&callId&&auth){
      api(endpoint('end'),{token:auth}).catch(()=>{});
    }
    releaseMedia();
    hangup.hidden=true;start.hidden=true;speaker.hidden=true;
    if(message)say(message);
  }
  async function failed(reason,message){
    if(closed||retrying)return;
    retrying=true;
    let ticket='';
    if(!owner&&callId&&auth){
      try{const result=await api(endpoint('end'),{token:auth,reason});ticket=result.retryToken||'';}
      catch(e){say('连接失败，尝试释放本次呼叫：'+e.message);}
      if(!ticket){
        try{ticket=(await api(endpoint('retry'),{token:auth})).retryToken||'';}catch{}
      }
    }else if(owner&&callId&&auth){
      try{await api(endpoint('end'),{token:auth,reason});}catch{}
    }
    await stop(false,message);
    if(!owner){
      retryTicket=ticket;
      start.hidden=false;
      start.textContent=ticket?'立即重新拨打':'重新拨打';
      say(ticket?message+'。可以立即重拨，无须等待 90 秒。':message+'。网络异常已结束；如遇限流请稍后再试。');
    }
    retrying=false;
  }
  async function showSelectedRoute(){
    if(!pc||!document.querySelector('#diag'))return;
    try{
      const report=await pc.getStats();
      let selected=null;
      report.forEach(item=>{
        if(item.type==='transport'&&item.selectedCandidatePairId)
          selected=report.get(item.selectedCandidatePairId);
      });
      if(!selected){
        report.forEach(item=>{
          if(item.type==='candidate-pair'&&item.state==='succeeded'&&item.nominated)
            selected=item;
        });
      }
      if(!selected)return;
      const a=report.get(selected.localCandidateId),b=report.get(selected.remoteCandidateId);
      const kind=a?.candidateType==='relay'||b?.candidateType==='relay'?'TURN 中继':'P2P 直连';
      const rtt=typeof selected.currentRoundTripTime==='number'
        ?Math.round(selected.currentRoundTripTime*1000)+' ms':'等待测量';
      document.querySelector('#diag').textContent='连接路径：'+kind+' · 往返延迟：'+rtt;
    }catch{}
  }
  async function peer(){
    if(pc)return;
    pc=new RTCPeerConnection({iceServers,iceCandidatePoolSize:1});
    pc.ontrack=e=>{remote.srcObject=e.streams[0];void preferReceiver();};
    pc.onicecandidate=e=>{if(e.candidate)void signal('ice',e.candidate.toJSON());};
    pc.onconnectionstatechange=()=>{
      if(closed||!pc)return;
      if(pc.connectionState==='connected'){
        connectSince=0;
        if(!inCallAt)inCallAt=Date.now();
        void showSelectedRoute();
        say('✅ 通话中');speaker.hidden=false;
      }else if(pc.connectionState==='failed'){
        void failed('ice_failed','语音网络连接失败');
      }else if(pc.connectionState==='disconnected'){
        say('网络中断，尝试恢复中…');
        if(!connectSince)connectSince=Date.now();
      }
    };
    localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  }
  async function poll(){
    if(closed)return;
    try{
      const data=await api(endpoint('events'),{token:auth,after:last});
      pollFailures=0;
      if(closed)return;
      if(['missed','rejected','ended','failed'].includes(data.status)){
        if(data.status==='failed'&&!owner){
          const ticket=await api(endpoint('retry'),{token:auth}).catch(()=>({}));
          await stop(false,'语音连接失败');
          retryTicket=ticket.retryToken||'';
          start.hidden=false;
          start.textContent=retryTicket?'立即重新拨打':'重新拨打';
          say(retryTicket?'网络建连失败，可以立即重新拨打':'本次连接失败，请重新尝试');
          return;
        }
        const messages={missed:'车主暂未接听',rejected:'车主已拒绝来电',ended:'通话已结束',failed:'连接失败'};
        await stop(false,messages[data.status]);
        if(data.status==='ended'){
          // Return to the parking page after a completed call; browsers
          // generally forbid closing a tab that wasn't script-opened.
          window.setTimeout(()=>{
            if(location.pathname.startsWith('/voice/')){
              let sameSite=false;
              try{sameSite=!!document.referrer&&new URL(document.referrer).origin===location.origin;}catch{}
              if(sameSite&&history.length>1)history.back();
              else location.assign('/');
            }
          },1100);
        }
        return;
      }
      if(data.status==='active'&&!pc){await peer();connectSince=Date.now();}
      if(data.status==='active'&&!owner&&!offerSent){
        offerSent=true;
        say('车主已接听，正在建立语音通道…');
        if(!pc.localDescription){
          const offer=await pc.createOffer({offerToReceiveAudio:true});
          await pc.setLocalDescription(offer);
        }
        offerSent=await signal('offer',{
          type:pc.localDescription.type,sdp:pc.localDescription.sdp
        });
      }
      for(const event of data.events){
        last=Math.max(last,event.seq);
        if(event.kind==='offer'&&owner){
          await pc.setRemoteDescription(new RTCSessionDescription(event.payload));
          const answer=await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if(!await signal('answer',{type:answer.type,sdp:answer.sdp}))
            pendingAnswer={type:answer.type,sdp:answer.sdp};
        }else if(event.kind==='answer'&&!owner){
          await pc.setRemoteDescription(new RTCSessionDescription(event.payload));
        }else if(event.kind==='ice'){
          if(pc?.remoteDescription)await pc.addIceCandidate(new RTCIceCandidate(event.payload));
          else pendingIce.push(event.payload);
        }
      }
      if(pendingAnswer){
        if(await signal('answer',pendingAnswer))pendingAnswer=null;
      }
      if(pc?.remoteDescription&&pendingIce.length){
        for(const candidate of pendingIce.splice(0))await pc.addIceCandidate(candidate);
      }
      if(inCallAt&&Date.now()-lastPathCheck>5000){
        lastPathCheck=Date.now();void showSelectedRoute();
      }
      if(connectSince&&Date.now()-connectSince>30000&&pc?.connectionState!=='connected'){
        await failed('connect_timeout','30 秒内未能建立音频连接');
        return;
      }
      if(inCallAt)timer.textContent='已通话 '+Math.floor((Date.now()-inCallAt)/1000)+' 秒';
    }catch(e){
      if(!closed){
        pollFailures++;
        if(pollFailures>=5&&connectSince){await failed('signaling_failed','信令网络连续超时');return;}
        say('网络信令不稳定（'+pollFailures+'）：'+e.message);
      }
    }
    if(!closed)poller=setTimeout(poll,900);
  }
  async function begin(){
    closed=false;retrying=false;last=0;offerSent=false;inCallAt=0;connectSince=0;pollFailures=0;
    callId='';auth='';pendingIce.length=0;pendingAnswer=null;timer.textContent='';
    document.querySelector('#diag').textContent='';
    start.hidden=true;hangup.hidden=false;speaker.hidden=true;hangup.disabled=false;
    try{
      if(owner){
        const params=new URLSearchParams(location.hash.slice(1));
        callId=params.get('callId')||'';auth=params.get('token')||'';
        if(!/^[A-Za-z0-9_-]{24}$/.test(callId)||!/^[A-Za-z0-9_-]{43}$/.test(auth))
          throw Error('通话链接无效');
        history.replaceState(null,'',location.pathname);
      }
      if(!navigator.mediaDevices?.getUserMedia)throw Error('请使用 HTTPS 页面并允许浏览器麦克风权限');
      say('正在申请麦克风权限…');
      localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
      if(!owner){
        say('正在通知车主…');
        const currentRetry=retryTicket;
        const response=await api('/api/voice/start',currentRetry?{retryToken:currentRetry}:{});
        retryTicket='';callId=response.callId;auth=response.token;
        iceServers=response.iceServers||defaultIce;
        say('已发送来电，等待车主接听…');
      }else{say('正在接入语音通道…');}
      void poll();
    }catch(e){
      await stop(true,'呼叫失败：'+e.message);
      if(!owner){
        start.hidden=false;start.textContent=retryTicket?'立即重新拨打':'重新拨打';
      }
    }
  }
  start.addEventListener('click',()=>void begin());
  speaker.addEventListener('click',()=>void toggleAudioRoute());
  hangup.addEventListener('click',()=>void stop());
  window.addEventListener('pagehide',()=>{
    if(!closed&&callId&&auth){
      const blob=new Blob([JSON.stringify({token:auth})],{type:'application/json'});
      navigator.sendBeacon?.(endpoint('end'),blob);
    }
    if(!closed)void stop(false);
  });
  if(owner){start.textContent='接通';void begin();}
})();
