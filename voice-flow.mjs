/**
 * Ephemeral authenticated WebRTC signaling for each individual move request.
 * No audio passes through Node: SRTP goes P2P when possible or via optional TURN.
 * Call state intentionally disappears on restart; request tokens remain in SQLite.
 */
import crypto from 'node:crypto';

export function createVoiceFlow({db,setting,random,hash,notifyChannels,inputJson,json,reply}) {
  const callerRecord=db.prepare('SELECT id FROM move_requests WHERE id=? AND poll_digest=? AND expires_at>?');
  const ownerRecord=db.prepare('SELECT id FROM move_requests WHERE owner_digest=? AND expires_at>?');
  const calls=new Map();
  const attempts=new Map();
  const RING_MS=75000,MAX_MS=15*60000,COOLDOWN_MS=20000;
  const tokenOk=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
  const matchesCaller=data=>tokenOk(data.requestId)&&tokenOk(data.pollToken)&&callerRecord.get(data.requestId,hash(data.pollToken),Date.now());
  const matchesOwner=data=>tokenOk(data.ownerToken)&&ownerRecord.get(hash(data.ownerToken),Date.now());
  const ownerLink=(origin,id)=>{
    const sig=crypto.createHmac('sha256',setting('owner_signing_key')).update('movecar-owner-v2:'+id).digest('base64url');
    return origin+'/owner-confirm/'+sig;
  };
  function iceConfig() {
    const list=(raw,prefix)=>String(raw||'').split(',').map(v=>v.trim()).filter(x=>x.startsWith(prefix)&&!/[\s<>"']/u.test(x)).slice(0,6);
    const iceServers=[];
    const stun=list(process.env.STUN_URLS??'stun:stun.l.google.com:19302','stun:');
    if(stun.length)iceServers.push({urls:stun});
    const turn=list(process.env.TURN_URLS,'turn:').concat(list(process.env.TURN_URLS,'turns:')).slice(0,6);
    const secret=process.env.TURN_SHARED_SECRET;
    if(turn.length&&secret&&secret.length>=12){
      const username=String(Math.floor(Date.now()/1000)+3600)+':movecar';
      const credential=crypto.createHmac('sha1',secret).update(username).digest('base64');
      iceServers.push({urls:turn,username,credential});
    }
    return {iceServers,turnConfigured:iceServers.some(s=>!!s.credential)};
  }
  function alive(call) {
    const now=Date.now();
    if(call.state==='ringing'&&now>call.ringDeadline)call.state='expired';
    if(call.state==='accepted'&&now>call.maxDeadline)call.state='ended';
    return call;
  }
  function cleanup(){
    for(const [id,call] of calls){
      alive(call);
      if((call.state==='ended'||call.state==='declined'||call.state==='expired')&&Date.now()>call.ringDeadline+MAX_MS)calls.delete(id);
    }
    for(const [id,entry] of attempts){if(Date.now()>entry.reset)attempts.delete(id);}
  }
  const timer=setInterval(cleanup,60000);timer.unref?.();
  function authorize(data,call){
    if(!call||!tokenOk(data.callId)||data.callId!==call.callId)return false;
    if(data.role==='caller')return !!callerRecord.get(call.requestId,hash(data.token||''),Date.now());
    if(data.role==='owner'){
      if(!tokenOk(data.token))return false;
      const record=ownerRecord.get(hash(data.token),Date.now());
      return !!record&&record.id===call.requestId;
    }
    return false;
  }
  const fail=(res,status,message)=>json(res,status,{error:message});
  return {
    cleanup,
    async handle(req,res,origin,u) {
      const route=u.pathname;
      if(!route.startsWith('/api/voice/'))return false;
      if(req.method!=='POST'){reply(res,405,'Method not allowed');return true;}
      const data=await inputJson(req);
      if(route==='/api/voice/start'){
        const record=matchesCaller(data);
        if(!record){fail(res,403,'挪车请求无效或已过期');return true;}
        const previous=calls.get(record.id);
        if(previous&&['ringing','accepted'].includes(alive(previous).state)){
          json(res,200,{callId:previous.callId,state:previous.state,...iceConfig()});return true;
        }
        const rate=attempts.get(record.id)||{count:0,reset:Date.now()+600000,last:0};
        if(Date.now()>rate.reset){rate.count=0;rate.reset=Date.now()+600000;}
        if(rate.count>=3||Date.now()-rate.last<COOLDOWN_MS){
          fail(res,429,'呼叫过于频繁，请稍后再试');return true;
        }
        const call={requestId:record.id,callId:random(),state:'ringing',ringDeadline:Date.now()+RING_MS,maxDeadline:Date.now()+MAX_MS,seq:0,events:[]};
        calls.set(record.id,call);
        rate.count++;rate.last=Date.now();attempts.set(record.id,rate);
        try{
          await notifyChannels({
            title:'📞 MoveCar · 语音来电',
            message:'有人正在请求与您语音通话。请打开下面的车主链接，点击「接听语音」。',
            ownerUrl:ownerLink(origin,record.id),
            richMarkdown:true
          });
          json(res,200,{callId:call.callId,state:call.state,...iceConfig()});return true;
        }catch{
          calls.delete(record.id);
          fail(res,502,'语音呼叫通知发送失败，请稍后重试');return true;
        }
      }
      if(route==='/api/voice/incoming'){
        const record=matchesOwner(data);
        if(!record){fail(res,403,'车主身份无效或链接过期');return true;}
        const call=calls.get(record.id);
        if(!call){json(res,200,{incoming:null});return true;}
        alive(call);
        json(res,200,{incoming:['ringing','accepted'].includes(call.state)?{callId:call.callId,state:call.state}:null});return true;
      }
      const call=[...calls.values()].find(c=>c.callId===data.callId);
      if(route==='/api/voice/accept'||route==='/api/voice/decline'){
        const record=matchesOwner(data);
        if(!record||!call||call.requestId!==record.id){fail(res,403,'通话授权无效');return true;}
        alive(call);
        if(route.endsWith('/accept')){
          if(call.state!=='ringing'){fail(res,409,'来电已结束或已被接听');return true;}
          call.state='accepted';
          json(res,200,{callId:call.callId,state:call.state,...iceConfig()});return true;
        }
        if(!['ringing','accepted'].includes(call.state)){fail(res,409,'来电已结束');return true;}
        call.state='declined';json(res,200,{state:call.state});return true;
      }
      if(!authorize(data,call)){fail(res,403,'无权访问此通话');return true;}
      alive(call);
      if(route==='/api/voice/state'){
        const after=data.after===undefined?0:data.after;
        if(!Number.isSafeInteger(after)||after<0){fail(res,400,'轮询序号无效');return true;}
        const events=call.events.filter(e=>e.seq>after&&e.from!==data.role).slice(0,100);
        json(res,200,{state:call.state,events,cursor:call.seq});return true;
      }
      if(route==='/api/voice/signal'){
        const s=data.signal;
        if(!s||typeof s!=='object'||Array.isArray(s)||!['offer','answer','candidate','hangup'].includes(s.type)){
          fail(res,400,'信令类型不合法');return true;
        }
        if(s.type==='hangup'){
          if(['ringing','accepted'].includes(call.state))call.state='ended';
          json(res,200,{state:call.state});return true;
        }
        if(call.state!=='accepted'){fail(res,409,'等待车主接听');return true;}
        if(s.type==='offer'||s.type==='answer'){
          if((s.type==='offer'&&data.role!=='caller')||(s.type==='answer'&&data.role!=='owner')||
            typeof s.sdp!=='string'||s.sdp.length<20||s.sdp.length>65000){
            fail(res,400,'SDP 信令无效');return true;
          }
          // Reject SDP that is missing standard WebRTC markers; leave negotiation to the browser.
          if(!s.sdp.startsWith('v=0')||!s.sdp.includes('m=audio')){
            fail(res,400,'仅支持音频通话');return true;
          }
        }
        if(s.type==='candidate'){
          if(!s.candidate||typeof s.candidate!=='object'||typeof s.candidate.candidate!=='string'||
             s.candidate.candidate.length>2048||
             (s.candidate.sdpMid!=null&&typeof s.candidate.sdpMid!=='string')||
             (s.candidate.sdpMLineIndex!=null&&(!Number.isInteger(s.candidate.sdpMLineIndex)||s.candidate.sdpMLineIndex<0||s.candidate.sdpMLineIndex>50))){
            fail(res,400,'ICE 信令无效');return true;
          }
        }
        const signal=s.type==='candidate'?{type:'candidate',candidate:{
          candidate:s.candidate.candidate,sdpMid:s.candidate.sdpMid??null,sdpMLineIndex:s.candidate.sdpMLineIndex??null,
          usernameFragment:typeof s.candidate.usernameFragment==='string'?s.candidate.usernameFragment.slice(0,256):undefined
        }}:{type:s.type,sdp:s.sdp};
        call.seq++;
        call.events.push({seq:call.seq,from:data.role,signal});
        if(call.events.length>120)call.events.splice(0,call.events.length-120);
        json(res,200,{ok:true,seq:call.seq});return true;
      }
      fail(res,404,'语音接口不存在');return true;
    }
  };
}
