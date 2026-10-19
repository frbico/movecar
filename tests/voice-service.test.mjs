import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import {createVoiceService} from '../voice-service.mjs';

function createHarness(options={}){
  const db=new DatabaseSync(':memory:');
  const messages=[];
  let clock=Date.now();
  const api=createVoiceService({db,pairingSecret:'test-voice-secret-which-is-long-and-private',
    now:()=>clock,allowLegacyPairing:true,pushCall:async (m)=>messages.push(m),
    stunUrls:options.stunUrls||'',turnUrls:options.turnUrls||'',turnSecret:options.turnSecret||'',
    callPolicy:()=>options.policy||{},
    json:(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(obj));},
    reply:(res,status,body,headers={})=>{res.writeHead(status,headers);res.end(body);},
    inputJson:async(req)=>{let b='';for await(const chunk of req)b+=chunk;if(b.length>16384)throw Error('too large');return JSON.parse(b||'{}');}
  });
  const server=http.createServer(async(req,res)=>{
    try{
      if(!await api.handle(req,res,new URL(req.url,'http://localhost'))) {res.statusCode=404;res.end('404');}
    }catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
  });
  return {db,api,server,messages,clockForward:ms=>{clock+=ms;}};
}
async function withServer(run,options={}){
  const h=createHarness(options);
  await new Promise(resolve=>h.server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${h.server.address().port}`;
  async function post(path,body={},auth=''){
    const r=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${auth}`}:{})},body:JSON.stringify(body)});
    return {status:r.status,body:await r.json()};
  }
  try {await run({...h,post,url});}
  finally {h.api.close();await new Promise(resolve=>h.server.close(resolve));h.db.close();}
}

test('owner pairing, caller starts, call offer/answer, finish',async()=>withServer(async({post,messages})=>{
  const reg=await post('/api/voice/device/register',{pairingSecret:'test-voice-secret-which-is-long-and-private',fcmToken:'fcm:abc_this-is-a-pretend-token-xxxxxxxxx'});
  assert.equal(reg.status,200);
  const deviceAuth=reg.body.deviceAuth;
  assert.equal(deviceAuth.length,43);
  const start=await post('/api/voice/start');
  assert.equal(start.status,200);
  assert.equal(messages.length,1);
  assert.equal(messages[0].callId,start.body.callId);
  const id=start.body.callId;
  const callerToken=start.body.token;
  const callRoute=s=>`/api/voice/calls/${id}/${s}`;
  assert.equal((await post(callRoute('answer'),{},'fake')).status,401);
  const answer=await post(callRoute('answer'),{},deviceAuth);
  assert.equal(answer.status,200);
  const ownerToken=answer.body.ownerToken;
  const offer={type:'offer',sdp:'v=0\r\n'};
  assert.equal((await post(callRoute('signal'),{token:callerToken,kind:'offer',payload:offer})).status,200);
  const ownerEvents=await post(callRoute('events'),{token:ownerToken,after:0});
  assert.equal(ownerEvents.body.status,'active');
  assert.equal(ownerEvents.body.events.length,1);
  assert.deepEqual(ownerEvents.body.events[0].payload,offer);
  assert.equal((await post(callRoute('signal'),{token:ownerToken,kind:'offer',payload:offer})).status,403);
  const sdp={type:'answer',sdp:'v=0\r\n'};
  assert.equal((await post(callRoute('signal'),{token:ownerToken,kind:'answer',payload:sdp})).status,200);
  const callerEvents=await post(callRoute('events'),{token:callerToken,after:0});
  assert.equal(callerEvents.body.events.length,1);
  assert.equal(callerEvents.body.events[0].kind,'answer');
  assert.equal((await post(callRoute('end'),{token:callerToken})).status,200);
  assert.equal((await post(callRoute('events'),{token:ownerToken,after:2})).body.status,'ended');
}));

test('rate limiting and expired missed calls',async()=>withServer(async({post,clockForward})=>{
  assert.equal((await post('/api/voice/device/register',{pairingSecret:'invalid-code-which-is-sufficiently-long',fcmToken:'fcm:abc_this-is-a-pretend-token-xxxxxxxxx'})).status,403);
  const reg=await post('/api/voice/device/register',{pairingSecret:'test-voice-secret-which-is-long-and-private',fcmToken:'fcm:abc_this-is-a-pretend-token-xxxxxxxxx'});
  const one=await post('/api/voice/start');
  assert.equal(one.status,200);
  assert.equal((await post('/api/voice/start')).status,409,'a ringing call is busy, not a daily-limit failure');
  clockForward(40000);
  assert.equal((await post(`/api/voice/calls/${one.body.callId}/events`,{token:one.body.token})).body.status,'missed');
  clockForward(51000);
  const two=await post('/api/voice/start');assert.equal(two.status,200);
  assert.equal((await post(`/api/voice/calls/${two.body.callId}/reject`,{},reg.body.deviceAuth)).status,200);
}));

test('ICE failure returns one-use fast-retry tickets, with bounded abuse protection',async()=>withServer(async({post})=>{
  const pairing=await post('/api/voice/device/register',{pairingSecret:'test-voice-secret-which-is-long-and-private',fcmToken:'fcm:abc_this-is-a-pretend-token-xxxxxxxxx'});
  assert.equal(pairing.status,200);
  let start=await post('/api/voice/start');
  assert.equal(start.status,200);
  let ticket='';
  for(let attempt=0;attempt<3;attempt++){
    const route=type=>`/api/voice/calls/${start.body.callId}/${type}`;
    const answer=await post(route('answer'),{},pairing.body.deviceAuth);
    assert.equal(answer.status,200);
    const ended=await post(route('end'),{token:start.body.token,reason:'ice_failed'});
    assert.equal(ended.status,200);
    if(attempt<2){
      ticket=ended.body.retryToken;
      assert.match(ticket,/^[A-Za-z0-9_-]{43}$/);
      assert.equal((await post('/api/voice/start')).status,429,'ordinary attempt still rate-limited');
      const retry=await post('/api/voice/start',{retryToken:ticket});
      assert.equal(retry.status,200,'fast retry accepted immediately after ICE failure');
      assert.equal((await post('/api/voice/start',{retryToken:ticket})).status,409,'a still-active retried call must return busy');
      start=retry;
    }else{
      assert.equal(ended.body.retryToken,undefined,'max two fast retries');
      assert.equal((await post('/api/voice/start',{retryToken:ticket})).status,429);
    }
  }
}));

test('owner-side ICE failure enables caller to request a fast retry ticket',async()=>withServer(async({post})=>{
  const pairing=await post('/api/voice/device/register',{pairingSecret:'test-voice-secret-which-is-long-and-private',fcmToken:'fcm:abc_this-is-a-pretend-token-xxxxxxxxx'});
  const start=await post('/api/voice/start');
  const p=type=>`/api/voice/calls/${start.body.callId}/${type}`;
  const answer=await post(p('answer'),{},pairing.body.deviceAuth);
  assert.equal((await post(p('end'),{token:answer.body.ownerToken,reason:'ice_failed'})).status,200);
  const ticket=await post(p('retry'),{token:start.body.token});
  assert.equal(ticket.status,200);
  assert.match(ticket.body.retryToken,/^[A-Za-z0-9_-]{43}$/);
  const retry=await post('/api/voice/start',{retryToken:ticket.body.retryToken});
  assert.equal(retry.status,200);
}));

test('ordinary hangup or rejection does not bypass anti-spam rate limit',async()=>withServer(async({post})=>{
  const pairing=await post('/api/voice/device/register',{pairingSecret:'test-voice-secret-which-is-long-and-private',fcmToken:'fcm:abc_this-is-a-pretend-token-xxxxxxxxx'});
  const start=await post('/api/voice/start');
  assert.equal((await post(`/api/voice/calls/${start.body.callId}/reject`,{},pairing.body.deviceAuth)).status,200);
  assert.equal((await post('/api/voice/start')).status,429);
}));

test('regional STUN and TURN UDP/TLS are issued with short-lived HMAC credentials',async()=>{
  const opts={stunUrls:'stun:hk.turn.example:3478,stun:tokyo.turn.example:3478',
    turnUrls:'turn:hk.turn.example:3478?transport=udp,turns:hk.turn.example:443?transport=tcp',
    turnSecret:'a-private-example-secret-which-is-not-used-in-production'};
  await withServer(async({post})=>{
    const paired=await post('/api/voice/device/register',{
      pairingSecret:'test-voice-secret-which-is-long-and-private',
      fcmToken:'fcm:abc_this-is-a-pretend-token-xxxxxxxxx'
    });
    assert.equal(paired.status,200);
    const created=await post('/api/voice/start');
    assert.equal(created.status,200);
    assert.deepEqual(created.body.iceServers[0].urls,opts.stunUrls.split(','));
    assert.deepEqual(created.body.iceServers[1].urls,opts.turnUrls.split(','));
    assert.match(created.body.iceServers[1].username,/^[0-9]+:movecar$/);
    assert.ok(created.body.iceServers[1].credential.length>20);
    assert.notEqual(created.body.iceServers[1].credential,opts.turnSecret);
    const answered=await post('/api/voice/calls/'+created.body.callId+'/answer',{},paired.body.deviceAuth);
    assert.equal(answered.status,200);
    assert.deepEqual(answered.body.iceServers[1].urls,opts.turnUrls.split(','));
  },opts);
});

test('owner policy switches to test mode immediately without redeploy and keeps single-call busy protection',async()=>{
 const policy={dailyLimit:1,cooldownSeconds:90,maxFastRetries:2,testMode:false};
 await withServer(async({post})=>{
  const registered=await post('/api/voice/device/register',{
    pairingSecret:'test-voice-secret-which-is-long-and-private',
    fcmToken:'fcm:abc_this-is-a-pretend-token-xxxxxxxxx'});
  assert.equal(registered.status,200);
  const one=await post('/api/voice/start');
  assert.equal(one.status,200);
  assert.equal((await post('/api/voice/start')).status,409,'one active ringing call is protected');
  assert.equal((await post('/api/voice/calls/'+one.body.callId+'/reject',{},registered.body.deviceAuth)).status,200);
  assert.equal((await post('/api/voice/start')).status,429,'one attempt exceeded daily quota');
  policy.testMode=true;
  for(let n=0;n<12;n++){
    const next=await post('/api/voice/start');
    assert.equal(next.status,200,'test mode can be used for repetitive network checks');
    assert.equal((await post('/api/voice/calls/'+next.body.callId+'/reject',{},registered.body.deviceAuth)).status,200);
  }
  policy.testMode=false;
  policy.dailyLimit=40;policy.cooldownSeconds=0;
  const after=await post('/api/voice/start');
  assert.equal(after.status,200,'new policy is applied to the existing server immediately');
 },{policy});
});

test('voice rate counters can be reset without deleting call history',async()=>{
 const policy={dailyLimit:1,cooldownSeconds:0,maxFastRetries:2,testMode:false};
 await withServer(async({post,api})=>{
  const dev=await post('/api/voice/device/register',{
    pairingSecret:'test-voice-secret-which-is-long-and-private',
    fcmToken:'fcm:abc_this-is-a-pretend-token-xxxxxxxxx'});
  const first=await post('/api/voice/start');
  await post('/api/voice/calls/'+first.body.callId+'/reject',{},dev.body.deviceAuth);
  assert.equal((await post('/api/voice/start')).status,429);
  const history=api.listCallHistory().length;
  api.resetCallRateLimits();
  assert.equal((await post('/api/voice/start')).status,200);
  assert.ok(api.listCallHistory().length>history,'reset does not erase call logs');
 },{policy});
});

test('server call-history clear is permanent and does not revoke active call services',async()=>withServer(async({post,api})=>{
  const token=await post('/api/voice/device/register',{
    pairingSecret:'test-voice-secret-which-is-long-and-private',
    fcmToken:'fcm:abc_this-is-a-pretend-token-xxxxxxxxx'
  });
  assert.equal(token.status,200);
  const call=await post('/api/voice/start');
  assert.equal(call.status,200);
  assert.equal(api.listCallHistory().length,1);
  assert.equal(api.clearCallHistory(),1);
  assert.equal(api.listCallHistory().length,0);
  // Clearing the database history must not interfere with the live in-memory
  // call state. Its reject/hangup flow must continue to work safely.
  const reject=await post('/api/voice/calls/'+call.body.callId+'/reject',{},token.body.deviceAuth);
  assert.equal(reject.status,200);
  assert.equal(api.listCallHistory().length,0);
}));

test('authenticated call diagnostics record only bounded quality fields, reject untrusted data and clear with history',async()=>withServer(async({post,api})=>{
  const reg=await post('/api/voice/device/register',{
    pairingSecret:'test-voice-secret-which-is-long-and-private',
    fcmToken:'fcm:abc_this-is-a-pretend-token-xxxxxxxxx'});
  const start=await post('/api/voice/start');
  const prefix='/api/voice/calls/'+start.body.callId+'/';
  const answer=await post(prefix+'answer',{},reg.body.deviceAuth);
  assert.equal(answer.status,200);
  const data={token:start.body.token,phase:'connected',route:'turn-udp',
    rttMs:140,reconnects:0,reason:''};
  assert.equal((await post(prefix+'diagnostic',data)).status,200);
  assert.equal((await post(prefix+'diagnostic',{...data,token:'invalid'})).status,403);
  assert.equal((await post(prefix+'diagnostic',{...data,reason:'candidate 192.168.1.1'})).status,400);
  assert.equal((await post(prefix+'diagnostic',{...data,rttMs:-1})).status,400);
  const reconnected={token:answer.body.ownerToken,phase:'recovered',route:'unknown',
    rttMs:null,reconnects:2,reason:''};
  assert.equal((await post(prefix+'diagnostic',reconnected)).status,200);
  let quality=api.listQuality();
  assert.equal(quality.length,2);
  assert.equal(quality.find(x=>x.peer==='caller').rttMs,140);
  assert.equal(quality.find(x=>x.peer==='owner').reconnects,2);
  assert.equal((await post(prefix+'signal',{token:start.body.token,kind:'offer',payload:{type:'offer',sdp:'v=0'}})).status,200);
  assert.equal((await post(prefix+'signal',{token:start.body.token,kind:'offer',payload:{type:'offer',sdp:'v=0\\r\\nrestart'}})).status,200,
    'caller can request a second SDP negotiation for ICE restart');
  api.clearCallHistory();
  assert.deepEqual(api.listQuality(),[]);
}));
