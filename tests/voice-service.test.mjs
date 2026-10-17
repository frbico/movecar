import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import {createVoiceService} from '../voice-service.mjs';

function createHarness(){
  const db=new DatabaseSync(':memory:');
  const messages=[];
  let clock=Date.now();
  const api=createVoiceService({db,pairingSecret:'test-voice-secret-which-is-long-and-private',
    now:()=>clock,allowLegacyPairing:true,pushCall:async (m)=>messages.push(m),
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
async function withServer(run){
  const h=createHarness();
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
  assert.equal((await post('/api/voice/start')).status,429);
  clockForward(40000);
  assert.equal((await post(`/api/voice/calls/${one.body.callId}/events`,{token:one.body.token})).body.status,'missed');
  clockForward(51000);
  const two=await post('/api/voice/start');assert.equal(two.status,200);
  assert.equal((await post(`/api/voice/calls/${two.body.callId}/reject`,{},reg.body.deviceAuth)).status,200);
}));
