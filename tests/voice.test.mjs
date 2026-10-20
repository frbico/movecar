import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createVoiceFlow} from '../voice-flow.mjs';

const random=()=>crypto.randomBytes(32).toString('base64url');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
test('WebRTC signal is per-request authorized, preserves ordering and cannot expose another caller',async()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE move_requests(
    id TEXT PRIMARY KEY,owner_digest TEXT,poll_digest TEXT,expires_at INTEGER,status TEXT
  )`);
  const signing='test-owner-hmac-secret';
  const requestId=random(),pollToken=random(),otherRequest=random(),otherPoll=random();
  const ownerFor=id=>crypto.createHmac('sha256',signing).update('movecar-owner-v2:'+id).digest('base64url');
  const ownerToken=ownerFor(requestId),otherOwner=ownerFor(otherRequest);
  const insert=db.prepare('INSERT INTO move_requests VALUES(?,?,?,?,?)');
  insert.run(requestId,hash(ownerToken),hash(pollToken),Date.now()+3600000,'waiting');
  insert.run(otherRequest,hash(otherOwner),hash(otherPoll),Date.now()+3600000,'waiting');
  const pushed=[];
  const setting=key=>key==='owner_signing_key'?signing:'';
  const flow=createVoiceFlow({db,setting,random,hash,
    notifyChannels:async data=>{pushed.push(data);return [{channel:'mock',success:true}];},
    inputJson:async req=>req.payload,
    json:(res,code,body,headers)=>{res.code=code;res.body=body;res.headers=headers||{};},
    reply:(res,code,body)=>{res.code=code;res.body=body;}
  });
  const hit=async(route,payload={})=>{
    const res={};const result=await flow.handle({method:'POST',payload},res,'https://car.example',new URL('https://car.example'+route));
    assert.equal(result,true);return res;
  };
  try{
    let r=await hit('/api/voice/start',{requestId,pollToken:otherPoll});
    assert.equal(r.code,403,'a different request token cannot start the call');
    r=await hit('/api/voice/start',{requestId,pollToken});
    assert.equal(r.code,200);
    const {callId}=r.body;
    assert.equal(typeof callId,'string');assert.equal(callId.length,43);
    assert.equal(r.body.state,'ringing');
    assert.equal(pushed.length,1);
    assert.ok(pushed[0].ownerUrl.endsWith(ownerToken));
    r=await hit('/api/voice/incoming',{ownerToken:otherOwner});
    assert.equal(r.code,200);assert.equal(r.body.incoming,null);
    r=await hit('/api/voice/incoming',{ownerToken});
    assert.equal(r.body.incoming.callId,callId);
    r=await hit('/api/voice/state',{callId,role:'caller',token:otherPoll});
    assert.equal(r.code,403);
    r=await hit('/api/voice/accept',{ownerToken:otherOwner,callId});
    assert.equal(r.code,403);
    r=await hit('/api/voice/signal',{role:'caller',token:pollToken,callId,signal:{type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111'}});
    assert.equal(r.code,409,'cannot negotiate until owner accepts');
    r=await hit('/api/voice/accept',{ownerToken,callId});
    assert.equal(r.code,200);assert.equal(r.body.state,'accepted');
    const offer='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111';
    r=await hit('/api/voice/signal',{role:'caller',token:pollToken,callId,signal:{type:'offer',sdp:offer}});
    assert.equal(r.code,200);
    r=await hit('/api/voice/state',{role:'owner',token:ownerToken,callId,after:0});
    assert.equal(r.code,200);assert.equal(r.body.events[0].signal.type,'offer');
    const cursor=r.body.cursor;
    r=await hit('/api/voice/signal',{role:'owner',token:ownerToken,callId,signal:{type:'answer',sdp:offer}});
    assert.equal(r.code,200);
    r=await hit('/api/voice/state',{role:'caller',token:pollToken,callId,after:0});
    assert.equal(r.code,200);assert.equal(r.body.events.length,1);
    assert.equal(r.body.events[0].signal.type,'answer');
    r=await hit('/api/voice/state',{role:'owner',token:ownerToken,callId,after:cursor});
    assert.equal(r.body.events.length,0,'owner must not receive its own answer');
    r=await hit('/api/voice/signal',{role:'caller',token:pollToken,callId,signal:{type:'candidate',candidate:{candidate:'candidate:0 1 udp 111 127.0.0.1 30000 typ host',sdpMid:'0',sdpMLineIndex:0}}});
    assert.equal(r.code,200);
    r=await hit('/api/voice/state',{role:'owner',token:ownerToken,callId,after:cursor});
    assert.equal(r.body.events.length,1);assert.equal(r.body.events[0].signal.type,'candidate');
    r=await hit('/api/voice/signal',{role:'owner',token:ownerToken,callId,signal:{type:'offer',sdp:offer}});
    assert.equal(r.code,400,'owner cannot impersonate caller');
    r=await hit('/api/voice/signal',{role:'caller',token:pollToken,callId,signal:{type:'hangup'}});
    assert.equal(r.code,200);assert.equal(r.body.state,'ended');
    r=await hit('/api/voice/state',{role:'owner',token:ownerToken,callId,after:0});
    assert.equal(r.body.state,'ended');
    r=await hit('/api/voice/start',{requestId,pollToken});
    assert.equal(r.code,429,'outgoing call cannot bypass per-request cooldown');
  }finally{flow.cleanup();db.close();}
});
test('TURN REST credentials are short-lived HMAC and are not part of public settings',async()=>{
  const prev={urls:process.env.TURN_URLS,secret:process.env.TURN_SHARED_SECRET};
  process.env.TURN_URLS='turn:relay.example.net:3478?transport=udp,turns:relay.example.net:5349';
  process.env.TURN_SHARED_SECRET='very-long-test-shared-secret';
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE move_requests (id TEXT,owner_digest TEXT,poll_digest TEXT,expires_at INTEGER)');
  const id=random(),poll=random();
  db.prepare('INSERT INTO move_requests VALUES(?,?,?,?)').run(id,hash(random()),hash(poll),Date.now()+50000);
  const flow=createVoiceFlow({db,setting:()=>'',random,hash,notifyChannels:async()=>{},
    inputJson:async req=>req.payload,json:(res,code,body)=>{res.code=code;res.body=body},reply:()=>{}});
  try{
    const res={};
    await flow.handle({method:'POST',payload:{requestId:id,pollToken:poll}},res,'https://car.example',new URL('https://car.example/api/voice/start'));
    assert.equal(res.code,200);
    assert.equal(res.body.turnConfigured,true);
    const turn=res.body.iceServers.find(x=>x.username);
    assert.ok(turn.urls.includes('turn:relay.example.net:3478?transport=udp'));
    assert.ok(turn.username.endsWith(':movecar'));
    assert.equal(turn.credential,crypto.createHmac('sha1',process.env.TURN_SHARED_SECRET).update(turn.username).digest('base64'));
  }finally{
    flow.cleanup();db.close();
    for(const key of ['urls','secret']){
      const envKey=key==='urls'?'TURN_URLS':'TURN_SHARED_SECRET';
      if(prev[key]===undefined)delete process.env[envKey];else process.env[envKey]=prev[key];
    }
  }
});
