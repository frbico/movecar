'use strict';
(() => {
  const owner=location.pathname==='/voice/owner';
  const start=document.querySelector('#start'),hangup=document.querySelector('#hangup');
  const label=document.querySelector('#status'),timer=document.querySelector('#timer');
  const remote=document.querySelector('#remote');
  const goBackToContact=()=>{
    // A browser cannot normally close a tab opened by scanning a QR code.
    // Return to the last notice/contact screen instead.
    try{sessionStorage.setItem('movecar-last-notified',String(Date.now()));}catch{}
    window.location.replace('/?contact=1');
  };
  const defaultIce=[{urls:['stun:stun.l.google.com:19302']}];
  let callId='',auth='',pc=null,localStream=null,last=0,poller=null,closed=false;
  let offerSent=false,inCallAt=0,connectSince=0,retryTicket='',retrying=false;
  let iceServers=defaultIce,pollFailures=0;
  let connectedOnce=false,reconnectAttempts=0,lastIceRestart=0,restartInFlight=false;
  let pendingOffer=null,lastQualityReport=0,qualityInFlight=false;
  const pendingIce=[];
  const unsentIce=[];
  const MAX_OUTGOING_ICE=90;
  let pendingAnswer=null;
  // ICE candidates can be lost when a VPN/TURN connection briefly stalls.
  // Queue a bounded number, retry later, never block microphone or SDP.
  const sendIce=async candidate=>{
    if(closed)return;
    if(!await signal('ice',candidate)){
      if(unsentIce.length>=MAX_OUTGOING_ICE)unsentIce.shift();
      unsentIce.push(candidate);
    }
  };
  const flushIce=async()=>{
    // Flush a small batch each successful signaling poll, preserving order.
    for(let i=0;i<Math.min(12,unsentIce.length);i++){
      const item=unsentIce[0];
      if(!await signal('ice',item))break;
      unsentIce.shift();
    }
  };
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
  async function sendQuality(phase,reason=''){
    if(!callId||!auth||!pc||qualityInFlight)return;
    qualityInFlight=true;
    lastQualityReport=Date.now();
    try{
      const stats=await pc.getStats();
      let pair=null;
      for(const entry of stats.values()){
        if(entry.type==='transport'&&entry.selectedCandidatePairId){
          pair=stats.get(entry.selectedCandidatePairId);
          if(pair)break;
        }
      }
      if(!pair)for(const entry of stats.values()){
        if(entry.type==='candidate-pair'&&entry.state==='succeeded'&&
           (entry.selected||entry.nominated)){pair=entry;break;}
      }
      const local=pair?stats.get(pair.localCandidateId):null;
      const remoteCandidate=pair?stats.get(pair.remoteCandidateId):null;
      const relay=local?.candidateType==='relay'||remoteCandidate?.candidateType==='relay';
      const protocol=(local?.relayProtocol||remoteCandidate?.relayProtocol||local?.protocol||'udp').toLowerCase();
      const route=relay?(protocol==='tls'?'turn-tls':protocol==='tcp'?'turn-tcp':'turn-udp'):'direct';
      const rtt=pair?.currentRoundTripTime;
      const rttMs=Number.isFinite(rtt)?Math.max(0,Math.min(30000,Math.round(rtt*1000))):null;
      await api(endpoint('diagnostic'),{
        token:auth,phase,route:pair?route:'unknown',rttMs,
        reconnects:reconnectAttempts,reason
      });
    }catch{/* Diagnostics never block real-time audio or expose ICE addresses. */}
    finally{qualityInFlight=false;}
  }
  async function restartIce(){
    if(restartInFlight||!pc||closed||reconnectAttempts>=2||
       !pc.remoteDescription||pc.signalingState!=='stable'||
       Date.now()-lastIceRestart<7000)return false;
    restartInFlight=true;
    reconnectAttempts++;
    lastIceRestart=Date.now();
    try{
      const offer=await pc.createOffer({iceRestart:true});
      await pc.setLocalDescription(offer);
      pendingOffer={type:offer.type,sdp:offer.sdp};
      say('网络不稳定，正在恢复语音…');
      void sendQuality('reconnecting','ice_restart');
      if(await signal('offer',pendingOffer))pendingOffer=null;
      return true;
    }catch(e){
      say('正在等待网络恢复…');
      return false;
    }finally{restartInFlight=false;}
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
    if(inCallAt)await sendQuality('ended');
    releaseMedia();
    hangup.hidden=true;start.hidden=true;
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
  async function peer(){
    if(pc)return;
    pc=new RTCPeerConnection({iceServers,iceCandidatePoolSize:1});
    pc.ontrack=e=>{
      remote.srcObject=e.streams[0];
      remote.play().catch(()=>say('点按页面继续播放语音'));
    };
    pc.onicecandidate=e=>{if(e.candidate)void sendIce(e.candidate.toJSON());};
    pc.onconnectionstatechange=()=>{
      if(closed||!pc)return;
      if(pc.connectionState==='connected'){
        connectSince=0;
        if(!inCallAt)inCallAt=Date.now();
        if(!connectedOnce || reconnectAttempts>0)void sendQuality(
          reconnectAttempts>0?'recovered':'connected');
        connectedOnce=true;
        say('通话中');
      }else if(['failed','disconnected'].includes(pc.connectionState)){
        say('网络中断，尝试恢复中…');
        if(!connectSince)connectSince=Date.now();
        if(!owner&&pc.connectionState==='failed')void restartIce();
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
      if(unsentIce.length)await flushIce();
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
        if(data.status==='ended'&&!owner)window.setTimeout(goBackToContact,1000);
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
        pendingOffer={type:pc.localDescription.type,sdp:pc.localDescription.sdp};
        if(await signal('offer',pendingOffer)){offerSent=true;pendingOffer=null;}
        else offerSent=false;
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
      if(pendingOffer&&!owner&&!restartInFlight){
        if(await signal('offer',pendingOffer)){pendingOffer=null;offerSent=true;}
      }
      if(pendingAnswer){
        if(await signal('answer',pendingAnswer))pendingAnswer=null;
      }
      if(pc?.remoteDescription&&pendingIce.length){
        for(const candidate of pendingIce.splice(0))await pc.addIceCandidate(candidate);
      }
      if(connectSince&&pc?.connectionState!=='connected'){
        const elapsed=Date.now()-connectSince;
        if(!owner&&pc?.remoteDescription&&elapsed>6500&&reconnectAttempts<2)
          await restartIce();
        if(elapsed>(connectedOnce?35000:39000)){
          void sendQuality('failed',connectedOnce?'ice_failed':'connect_timeout');
          await failed(connectedOnce?'ice_failed':'connect_timeout','语音连接未能恢复');
          return;
        }
      }
      if(inCallAt&&Date.now()-lastQualityReport>18000)
        void sendQuality('connected');
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
    connectedOnce=false;reconnectAttempts=0;lastIceRestart=0;restartInFlight=false;pendingOffer=null;lastQualityReport=0;qualityInFlight=false;
    callId='';auth='';pendingIce.length=0;unsentIce.length=0;pendingAnswer=null;timer.textContent='';
    start.hidden=true;hangup.hidden=false;hangup.disabled=false;
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
      localStream=await navigator.mediaDevices.getUserMedia({
        audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false
      });
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
  hangup.addEventListener('click',()=>{
    const wasConnected=Boolean(inCallAt);
    void stop().then(()=>{
      if(!owner&&wasConnected)window.setTimeout(goBackToContact,700);
    });
  });
  window.addEventListener('pagehide',()=>{
    if(!closed&&callId&&auth){
      const blob=new Blob([JSON.stringify({token:auth})],{type:'application/json'});
      navigator.sendBeacon?.(endpoint('end'),blob);
    }
    if(!closed)void stop(false);
  });
  if(owner){start.textContent='接通';void begin();}
})();
