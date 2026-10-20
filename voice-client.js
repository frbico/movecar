'use strict';
/* Browser WebRTC audio: only signaling goes through MoveCar server. */
(() => {
  const api=async(path,body)=>{
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',credentials:'same-origin'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.error||'网络请求失败');
    return data;
  };
  const status=(node,msg)=>{if(node)node.textContent=msg;};
  const supports=()=>!!(navigator.mediaDevices?.getUserMedia&&window.RTCPeerConnection);
  const mic=async()=>{
    if(!supports())throw Error('当前浏览器不支持语音通话，需使用 HTTPS 与新版 Chrome / Safari');
    return navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
  };
  function session({role,token,callId,local,iceServers,display,remoteAudio,onFinish}) {
    let connection=null,poll=null,last=0,busy=false,closed=false,answered=false;
    const queued=[];
    const identity=()=>({role,token,callId});
    const send=signal=>api('/api/voice/signal',{...identity(),signal});
    const stop=async(notifyPeer=false)=>{
      if(closed)return;
      closed=true;clearInterval(poll);
      if(notifyPeer)send({type:'hangup'}).catch(()=>{});
      if(connection)connection.close();
      if(local)for(const track of local.getTracks())track.stop();
      if(remoteAudio){remoteAudio.pause();remoteAudio.srcObject=null;}
      onFinish?.();
    };
    async function prepare(){
      if(connection)return connection;
      connection=new RTCPeerConnection({iceServers});
      for(const track of local.getTracks())connection.addTrack(track,local);
      connection.onicecandidate=e=>{
        if(e.candidate&&!closed)send({type:'candidate',candidate:e.candidate.toJSON()}).catch(()=>{});
      };
      connection.ontrack=e=>{
        remoteAudio.srcObject=e.streams[0]||new MediaStream([e.track]);
        remoteAudio.play().catch(()=>display('已接通，请点一下页面以启用声音'));
      };
      connection.onconnectionstatechange=()=>{
        if(closed)return;
        if(connection.connectionState==='connected')display('✅ 已接通，正在语音通话');
        else if(connection.connectionState==='failed')display('音频连接失败，请检查网络或服务器 TURN 配置');
        else if(connection.connectionState==='disconnected')display('连接中断，正在尝试恢复…');
      };
      return connection;
    }
    async function handleSignal(item){
      const signal=item.signal;
      if(signal.type==='offer'&&role==='owner'){
        const pc=await prepare();
        await pc.setRemoteDescription({type:'offer',sdp:signal.sdp});
        for(const candidate of queued.splice(0))await pc.addIceCandidate(candidate).catch(()=>{});
        const answer=await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await send({type:'answer',sdp:pc.localDescription.sdp});
        answered=true;
        display('正在建立音频连接…');
      }else if(signal.type==='answer'&&role==='caller'&&connection){
        await connection.setRemoteDescription({type:'answer',sdp:signal.sdp});
        for(const candidate of queued.splice(0))await connection.addIceCandidate(candidate).catch(()=>{});
        display('正在建立音频连接…');
      }else if(signal.type==='candidate'){
        if(connection?.remoteDescription)await connection.addIceCandidate(signal.candidate).catch(()=>{});
        else queued.push(signal.candidate);
      }
    }
    async function refresh(){
      if(closed||busy)return;
      busy=true;
      try{
        const data=await api('/api/voice/state',{...identity(),after:last});
        if(['ended','declined','expired'].includes(data.state)){
          display(data.state==='declined'?'对方已拒接':data.state==='expired'?'无人接听，呼叫已超时':'通话已结束');
          await stop();return;
        }
        if(role==='caller'&&data.state==='accepted'&&!connection){
          const pc=await prepare();
          const offer=await pc.createOffer({offerToReceiveAudio:true});
          await pc.setLocalDescription(offer);
          await send({type:'offer',sdp:pc.localDescription.sdp});
          display('车主已接听，正在连接…');
        }
        for(const message of data.events||[]){
          if(closed)break;
          await handleSignal(message);
        }
        // Consume only events that were successfully handled. The next poll can pick up missing ones.
        if(!closed)last=data.cursor||last;
      }catch(e){
        if(!closed)display('通话连接异常：'+e.message);
      }finally{busy=false;}
    }
    poll=setInterval(refresh,1100);
    refresh();
    return {stop,send};
  }
  function elements(parent){
    const area=document.createElement('section');area.className='voice-call-area';
    area.style.cssText='margin-top:12px;padding:14px;border-radius:14px;background:#f2f7fb;text-align:center';
    const line=document.createElement('p');line.setAttribute('role','status');line.style.cssText='font-size:15px;color:#34506b;margin:6px 0 12px';
    const hangup=document.createElement('button');hangup.type='button';hangup.textContent='挂断';hangup.style.cssText='width:100%;padding:13px;background:#be334b;color:white;border:0;border-radius:12px;font-size:16px;font-weight:700';
    const audio=document.createElement('audio');audio.autoplay=true;audio.playsInline=true;
    area.appendChild(line);area.appendChild(audio);area.appendChild(hangup);
    parent.appendChild(area);
    return {area,line,hangup,audio,show:message=>status(line,message)};
  }
  function mountCaller({button,getRequest}){
    if(!button)return;
    button.disabled=false;
    button.title='匿名网络语音通话';
    button.removeAttribute('aria-label');
    button.style.cssText='display:block;width:100%;margin:0;padding:16px 12px;border-radius:16px;border:none;background:#2475c4;color:white;font-size:17px;font-weight:700';
    let active=null;
    button.addEventListener('click',async()=>{
      if(active)return;
      const request=getRequest();
      if(!request?.requestId||!request?.pollToken){alert('请先发送通知车主');return;}
      button.disabled=true;
      const ui=elements(button.parentElement);
      ui.show('正在申请麦克风权限…');
      let local;
      try{
        local=await mic();
        ui.show('正在通知车主接听…');
        const call=await api('/api/voice/start',{requestId:request.requestId,pollToken:request.pollToken});
        if(!call.turnConfigured)ui.show('等待车主接听（未配置 TURN，部分移动网络可能无法连通）');
        else ui.show('正在呼叫车主…');
        active=session({role:'caller',token:request.pollToken,callId:call.callId,local,iceServers:call.iceServers,
          display:ui.show,remoteAudio:ui.audio,onFinish:()=>{active=null;button.disabled=false;}});
      }catch(e){
        if(local)for(const track of local.getTracks())track.stop();
        ui.show('呼叫失败：'+e.message);
        button.disabled=false;
      }
      ui.hangup.addEventListener('click',async()=>{
        if(active)await active.stop(true);
        ui.area.remove();button.disabled=false;
      });
    });
  }
  function mountOwner({token,container}){
    if(!container)return;
    const header=document.createElement('h3');header.textContent='📞 网络语音';
    header.style.cssText='font-size:19px;color:#273e58;margin:18px 0 8px';
    const statusNode=document.createElement('p');statusNode.setAttribute('role','status');
    statusNode.textContent='等待可能的语音呼叫…';
    const row=document.createElement('div');row.style.cssText='display:flex;gap:10px';
    const answer=document.createElement('button');answer.textContent='接听语音';
    const decline=document.createElement('button');decline.textContent='拒接';
    const callStyle='width:50%;font-size:16px;padding:13px;border-radius:12px';
    answer.style.cssText=callStyle+';background:#0a9e6a';
    decline.style.cssText=callStyle+';background:#8796a7';
    answer.hidden=decline.hidden=true;
    row.appendChild(answer);row.appendChild(decline);
    container.appendChild(header);container.appendChild(statusNode);container.appendChild(row);
    const ui=elements(container);ui.area.hidden=true;
    let active=null,offer=null,pollBusy=false;
    const poll=async()=>{
      if(active||pollBusy)return;
      pollBusy=true;
      try{
        const data=await api('/api/voice/incoming',{ownerToken:token});
        const incoming=data.incoming;
        if(incoming?.state==='ringing'){
          offer=incoming;
          answer.hidden=decline.hidden=false;
          statusNode.textContent='有人请求语音通话，是否接听？';
          if(navigator.vibrate)navigator.vibrate(100);
        }else if(!incoming){
          offer=null;
          answer.hidden=decline.hidden=true;
          statusNode.textContent='等待可能的语音呼叫…';
        }
      }catch(e){statusNode.textContent='无法检查来电：'+e.message;}
      finally{pollBusy=false;}
    };
    const interval=setInterval(poll,1600);poll();
    answer.addEventListener('click',async()=>{
      if(!offer||active)return;
      answer.disabled=true;decline.disabled=true;
      let local;
      try{
        statusNode.textContent='正在申请麦克风权限…';
        local=await mic();
        const accepted=await api('/api/voice/accept',{callId:offer.callId,ownerToken:token});
        answer.hidden=decline.hidden=true;
        ui.area.hidden=false;
        ui.show('已接听，等待对方建立连接…');
        statusNode.textContent='正在通话';
        active=session({role:'owner',token,callId:accepted.callId,local,iceServers:accepted.iceServers,
          display:ui.show,remoteAudio:ui.audio,onFinish:()=>{
            active=null;ui.area.hidden=true;answer.disabled=decline.disabled=false;
            statusNode.textContent='通话已结束';
          }});
      }catch(e){
        if(local)for(const track of local.getTracks())track.stop();
        statusNode.textContent='接听失败：'+e.message;
        answer.disabled=decline.disabled=false;
      }
    });
    decline.addEventListener('click',async()=>{
      if(!offer)return;
      try{await api('/api/voice/decline',{ownerToken:token,callId:offer.callId});statusNode.textContent='已拒接';}
      catch(e){statusNode.textContent='拒接失败：'+e.message;}
      answer.hidden=decline.hidden=true;
    });
    ui.hangup.addEventListener('click',async()=>{if(active)await active.stop(true);});
    window.addEventListener('pagehide',()=>{clearInterval(interval);if(active)active.stop(true);});
  }
  window.MoveCarVoice={mountCaller,mountOwner};
})();
