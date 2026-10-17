/**
 * MoveCar anonymous 1:1 WebRTC voice calls.
 * No npm packages on the Node 24 server. Optional Firebase HTTP v1 via service account.
 * A call is ephemeral; only the single paired owner's FCM token is persisted in SQLite.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const PAGE_HEADERS={
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; media-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'Cache-Control':'no-store',
};
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const token=()=>crypto.randomBytes(32).toString('base64url');
const id=()=>crypto.randomBytes(18).toString('base64url');
const bad=(code,message)=>Object.assign(Error(message),{status:code});
const eq=(a,b)=>{
  const x=Buffer.from(String(a)),y=Buffer.from(String(b));
  return x.length===y.length&&crypto.timingSafeEqual(x,y);
};
const validFcm=x=>typeof x==='string'&&x.length>=20&&x.length<=4096&&/^[\x21-\x7e]+$/.test(x);
const validToken=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{43}$/.test(x);
const readStatic=name=>fs.readFileSync(new URL(name,import.meta.url));

export function createVoiceService({db,json,reply,inputJson,pairingSecret=process.env.VOICE_PAIRING_SECRET||'',serviceAccountPath=process.env.FCM_SERVICE_ACCOUNT||'',pushCall=null,turnUrls=process.env.VOICE_TURN_URLS||'',turnSecret=process.env.VOICE_TURN_SHARED_SECRET||'',now=()=>Date.now()}){
  db.exec(`CREATE TABLE IF NOT EXISTS voice_owner_device (
    id INTEGER PRIMARY KEY CHECK(id=1), auth_digest TEXT NOT NULL,
    fcm_token TEXT NOT NULL, updated_at INTEGER NOT NULL
  );`);
  const getDevice=db.prepare('SELECT auth_digest,fcm_token FROM voice_owner_device WHERE id=1');
  const saveDevice=db.prepare('INSERT INTO voice_owner_device(id,auth_digest,fcm_token,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET auth_digest=excluded.auth_digest,fcm_token=excluded.fcm_token,updated_at=excluded.updated_at');
  const updateFcm=db.prepare('UPDATE voice_owner_device SET fcm_token=?,updated_at=? WHERE id=1 AND auth_digest=?');
  const enabled=pairingSecret.length>=20 && Boolean(pushCall||serviceAccountPath);
  const calls=new Map();
  const limit=new Map();
  let cachedAccess=null;
  function originAllowed(req){
    const given=req.headers.origin;
    if(!given)return true; // non-browser clients; IP rate limits still apply
    const host=req.headers.host;
    if(!host)return false;
    try{
      const u=new URL(given);
      // Reverse proxy should preserve Host. Do not trust client-controlled forwarding headers.
      return ['https:','http:'].includes(u.protocol)&&u.host.toLowerCase()===host.toLowerCase();
    }catch{return false;}
  }
  function requireOrigin(req){if(!originAllowed(req))throw bad(403,'请求来源不允许');}
  function requireOwner(req){
    const auth=(req.headers.authorization||'').match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    const device=getDevice.get();
    if(!device||!auth||!eq(sha(auth),device.auth_digest))throw bad(401,'手机未配对或登录已失效');
    return device;
  }
  function cleanup(){
    for(const [k,c] of calls){
      if(c.status==='ringing'&&now()>c.created+35000)c.status='missed';
      if(c.status==='active'&&now()>c.created+10*60*1000)c.status='ended';
      if(now()>c.created+15*60*1000)calls.delete(k);
    }
    for(const [ip,r] of limit)if(now()>r.since+86400000)limit.delete(ip);
  }
  const cleanupTimer=setInterval(cleanup,10000);cleanupTimer.unref?.();
  function iceServers(){
    const out=[{urls:['stun:stun.l.google.com:19302']}];
    if(turnUrls&&turnSecret){
      const urls=turnUrls.split(',').map(s=>s.trim()).filter(s=>/^(turn|turns):[^\s]+$/.test(s)).slice(0,4);
      if(urls.length){
        const username=`${Math.floor(now()/1000)+3600}:movecar`;
        const credential=crypto.createHmac('sha1',turnSecret).update(username).digest('base64');
        out.push({urls,username,credential});
      }
    }
    return out;
  }
  async function fcmAccess(){
    if(cachedAccess&&cachedAccess.expires>now()+60000)return cachedAccess.value;
    const sa=JSON.parse(fs.readFileSync(serviceAccountPath,'utf8'));
    if(sa.type!=='service_account'||!sa.private_key||!sa.client_email||!/^[A-Za-z0-9_-]+$/.test(sa.project_id))throw bad(503,'Firebase 服务账号配置不正确');
    const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
    const iat=Math.floor(now()/1000);
    const assertionData=`${b64({alg:'RS256',typ:'JWT'})}.${b64({iss:sa.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat,exp:iat+3600})}`;
    const signature=crypto.sign('RSA-SHA256',Buffer.from(assertionData),sa.private_key).toString('base64url');
    const body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:assertionData+'.'+signature});
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw bad(502,'无法向 Google 获取推送授权');
    const result=await response.json();
    if(!result.access_token)throw bad(502,'Google 推送授权无效');
    cachedAccess={value:result.access_token,expires:now()+Number(result.expires_in||3600)*1000};
    return cachedAccess.value;
  }
  async function sendPush(callId,deviceToken){
    if(pushCall)return pushCall({callId,deviceToken});
    const sa=JSON.parse(fs.readFileSync(serviceAccountPath,'utf8'));
    const access=await fcmAccess();
    const response=await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`,{
      method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},
      body:JSON.stringify({message:{token:deviceToken,data:{type:'incoming_call',callId},android:{priority:'HIGH',ttl:'35s'}}}),
      signal:AbortSignal.timeout(10000)
    });
    if(!response.ok)throw bad(502,'FCM 未接受来电通知，请检查设备注册');
  }
  function getCall(callId){
    cleanup();const c=calls.get(callId);
    if(!c)throw bad(404,'通话不存在或已过期');
    return c;
  }
  function role(c,provided){
    if(!validToken(provided))throw bad(403,'通话凭证无效');
    const dig=sha(provided);
    if(eq(dig,c.callerHash))return 'caller';
    if(c.ownerHash&&eq(dig,c.ownerHash))return 'owner';
    throw bad(403,'通话凭证无效');
  }
  function enforceRate(req){
    const ip=String(req.socket.remoteAddress||'unknown');
    const r=limit.get(ip)||{since:now(),last:0,count:0};
    if(now()-r.since>86400000){r.since=now();r.count=0;}
    if(now()-r.last<90000||r.count>=8)throw bad(429,'语音呼叫过于频繁，请稍后重试');
    // One ringing/active call at a time for the single owner.
    if([...calls.values()].some(c=>['ringing','active'].includes(c.status)))throw bad(409,'车主正在通话或已有来电');
    r.count++;r.last=now();limit.set(ip,r);
  }
  function send(res,status,body,headers={}){reply(res,status,body,headers);}
  async function handle(req,res,u){
    const route=u.pathname;
    if(route==='/voice-entry.js' || route==='/voice-page.js'){
      if(req.method!=='GET')return send(res,405,'Method not allowed'),true;
      return send(res,200,readStatic(route.slice(1)),{'Content-Type':'text/javascript; charset=utf-8',...PAGE_HEADERS}),true;
    }
    if(route==='/voice/caller'||route==='/voice/owner'){
      if(req.method!=='GET')return send(res,405,'Method not allowed'),true;
      return send(res,200,readStatic('voice-page.html'),{'Content-Type':'text/html; charset=utf-8',...PAGE_HEADERS}),true;
    }
    if(!route.startsWith('/api/voice/'))return false;
    if(route==='/api/voice/config'){
      if(req.method!=='GET')return send(res,405,'Method not allowed'),true;
      json(res,200,{enabled,ready:enabled&&!!getDevice.get()});return true;
    }
    if(!enabled)throw bad(503,'服务器尚未启用语音模块');
    if(req.method!=='POST')return send(res,405,'Method not allowed'),true;
    const data=await inputJson(req);
    if(route==='/api/voice/device/register'){
      requireOrigin(req);
      if(typeof data.pairingSecret!=='string'||!eq(data.pairingSecret,pairingSecret))throw bad(403,'配对码错误');
      if(!validFcm(data.fcmToken))throw bad(400,'FCM Token 格式不正确');
      const ownerToken=token();saveDevice.run(sha(ownerToken),data.fcmToken,now());
      json(res,200,{ok:true,deviceAuth:ownerToken});return true;
    }
    if(route==='/api/voice/device/token'){
      const device=requireOwner(req);
      if(!validFcm(data.fcmToken))throw bad(400,'FCM Token 格式不正确');
      updateFcm.run(data.fcmToken,now(),device.auth_digest);
      json(res,200,{ok:true});return true;
    }
    if(route==='/api/voice/start'){
      requireOrigin(req);
      const device=getDevice.get();if(!device)throw bad(503,'车主尚未连接语音接听 APP');
      enforceRate(req);
      const callId=id(),callerToken=token();
      const c={id:callId,callerHash:sha(callerToken),ownerHash:null,status:'ringing',created:now(),seq:0,events:[]};
      calls.set(callId,c);
      try{await sendPush(callId,device.fcm_token);}catch(e){calls.delete(callId);throw e;}
      json(res,200,{callId,token:callerToken,expiresIn:35,iceServers:iceServers()});return true;
    }
    const match=route.match(/^\/api\/voice\/calls\/([A-Za-z0-9_-]{24})\/(answer|reject|events|signal|end)$/);
    if(!match)throw bad(404,'接口不存在');
    const c=getCall(match[1]),action=match[2];
    if(action==='answer'||action==='reject'){
      requireOwner(req);
      if(c.status!=='ringing')throw bad(409,'来电已经结束');
      if(action==='reject'){c.status='rejected';json(res,200,{ok:true});return true;}
      const ownerToken=token();c.ownerHash=sha(ownerToken);c.status='active';
      json(res,200,{ok:true,ownerToken,iceServers:iceServers()});return true;
    }
    const who=role(c,data.token);
    if(action==='events'){
      const after=Number(data.after??0);
      if(!Number.isSafeInteger(after)||after<0)throw bad(400,'事件序号无效');
      json(res,200,{status:c.status,events:c.events.filter(e=>e.seq>after&&e.from!==who),lastSeq:c.seq,iceServers:iceServers()});return true;
    }
    if(action==='end'){
      if(['ringing','active'].includes(c.status))c.status='ended';
      json(res,200,{ok:true});return true;
    }
    if(c.status!=='active')throw bad(409,'通话尚未接通或已经结束');
    const kind=data.kind, payload=data.payload;
    if(!['offer','answer','ice'].includes(kind)||!payload||typeof payload!=='object'||Array.isArray(payload))throw bad(400,'信令格式无效');
    if(kind==='offer'&&who!=='caller'||kind==='answer'&&who!=='owner')throw bad(403,'信令方向不允许');
    if(kind==='offer'||kind==='answer'){
      if(payload.type!==kind||typeof payload.sdp!=='string'||payload.sdp.length>16000)throw bad(400,'SDP 格式无效');
    }else if(typeof payload.candidate!=='string'||payload.candidate.length>2048||!Number.isInteger(payload.sdpMLineIndex)&&payload.sdpMLineIndex!==null)throw bad(400,'ICE 格式无效');
    if(c.events.length>=150)throw bad(429,'通话信令数量超限');
    c.events.push({seq:++c.seq,from:who,kind,payload});
    json(res,200,{ok:true,seq:c.seq});return true;
  }
  return {handle,cleanup,close:()=>clearInterval(cleanupTimer),_debug:{calls}};
}
