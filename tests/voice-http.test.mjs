import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
const close=s=>new Promise(r=>s.close(r));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test('real HTTP voice flow uses unique request tokens and owner notification link',async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'move-voice-http-'));
  const pushes=[];
  const mock=http.createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;
    pushes.push(JSON.parse(body));res.setHeader('Content-Type','application/json');res.end('{"code":0}');
  });
  await listen(mock);
  const probe=http.createServer();await listen(probe);const port=probe.address().port;await close(probe);
  const origin='http://127.0.0.1:'+port;
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,NODE_ENV:'test',SOURCE_PATH:path.join(root,'tests/fake-worker.js'),DB_PATH:path.join(tmp,'db.sqlite'),PORT:String(port),MOVECAR_TEST_SC3_ENDPOINT:'http://127.0.0.1:'+mock.address().port+'/push'},stdio:'pipe'});
  let stderr='';child.stderr.on('data',d=>stderr+=String(d));
  const post=(route,body,headers={})=>fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const json=async(r)=>({code:r.status,body:await r.json()});
  try{
    let ready=false;for(let i=0;i<140;i++){try{if((await fetch(origin+'/healthz')).ok){ready=true;break;}}catch{}await sleep(50);}
    assert.ok(ready,stderr);
    const password=fs.readFileSync(path.join(tmp,'admin-initial-password'),'utf8').trim();
    const login=await post('/api/admin/login',{password});
    assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const csrf=(await (await fetch(origin+'/api/admin/session',{headers:{Cookie:cookie}})).json()).csrf;
    const setup=await post('/api/admin/settings',{publicUrl:'',phoneNumber:'',rateLimitSeconds:0,sc3SendKey:'sctp12345tABCDEFGH1234567'},
      {Origin:origin,Cookie:cookie,'X-CSRF-Token':csrf});
    assert.equal(setup.status,200,await setup.clone().text());
    const notified=await json(await post('/api/notify',{message:'您好，麻烦挪车'}));
    assert.equal(notified.code,200);
    assert.equal(pushes.length,1);
    const ownerToken=pushes[0].desp.match(/\/owner-confirm\/([A-Za-z0-9_-]{43})/)[1];
    const ownerPage=await fetch(origin+'/owner-confirm/'+ownerToken);
    assert.equal(ownerPage.status,200);
    assert.match(await ownerPage.text(),/voice-client.js/);
    assert.equal((await fetch(origin+'/voice-client.js')).status,200);
    const invalid=await json(await post('/api/voice/start',{requestId:notified.body.requestId,pollToken:'Z'.repeat(43)}));
    assert.equal(invalid.code,403);
    const started=await json(await post('/api/voice/start',{requestId:notified.body.requestId,pollToken:notified.body.pollToken}));
    assert.equal(started.code,200);
    assert.equal(started.body.state,'ringing');
    assert.equal(pushes.length,2,'voice call notifies the owner independently');
    assert.ok(pushes[1].desp.includes(ownerToken),'call notification links to same authorized owner view');
    const incoming=await json(await post('/api/voice/incoming',{ownerToken}));
    assert.equal(incoming.code,200);assert.equal(incoming.body.incoming.callId,started.body.callId);
    const accepted=await json(await post('/api/voice/accept',{ownerToken,callId:started.body.callId}));
    assert.equal(accepted.body.state,'accepted');
    const sdp='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111';
    const offer=await json(await post('/api/voice/signal',{role:'caller',token:notified.body.pollToken,callId:started.body.callId,signal:{type:'offer',sdp}}));
    assert.equal(offer.code,200);
    const voiceEvent=await json(await post('/api/voice/state',{role:'owner',token:ownerToken,callId:started.body.callId,after:0}));
    assert.equal(voiceEvent.body.events[0].signal.sdp,sdp);
    const hangup=await json(await post('/api/voice/signal',{role:'owner',token:ownerToken,callId:started.body.callId,signal:{type:'hangup'}}));
    assert.equal(hangup.body.state,'ended');
    const after=await json(await post('/api/voice/state',{role:'caller',token:notified.body.pollToken,callId:started.body.callId,after:0}));
    assert.equal(after.body.state,'ended');
  }finally{
    const exit=child.exitCode===null?new Promise(r=>child.once('exit',r)):Promise.resolve();
    if(child.exitCode===null)child.kill('SIGTERM');
    await exit;await close(mock);fs.rmSync(tmp,{recursive:true,force:true});
  }
});
