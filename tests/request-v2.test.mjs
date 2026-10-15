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
test('two independent requests, clickable maps, owner tokens, SC3 formatting and no login',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'movecar-isolated-'));
  const calls=[];
  const mock=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    calls.push(JSON.parse(body));res.setHeader('Content-Type','application/json');res.end('{"code":0}');
  });
  await listen(mock);
  const probe=http.createServer();await listen(probe);const port=probe.address().port;await close(probe);
  const origin='http://127.0.0.1:'+port;
  const env={...process.env,PORT:String(port),NODE_ENV:'test',SOURCE_PATH:path.join(root,'tests/fake-worker.js'),
    DB_PATH:path.join(dir,'test.sqlite'),MOVECAR_TEST_SC3_ENDPOINT:'http://127.0.0.1:'+mock.address().port+'/push'};
  let stderr='';
  const processServer=spawn(process.execPath,['server.mjs'],{cwd:root,env,stdio:'pipe'});
  processServer.stderr.on('data',d=>stderr+=d.toString());
  const api=(route,body)=>fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try {
    let ready=false;for(let i=0;i<150;i++){try{if((await fetch(origin+'/healthz')).ok){ready=true;break;}}catch{}await sleep(40)}
    assert.ok(ready,stderr);
    const password=fs.readFileSync(path.join(dir,'admin-initial-password'),'utf8').trim();
    const login=await api('/api/admin/login',{password});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const csrf=(await (await fetch(origin+'/api/admin/session',{headers:{Cookie:cookie}})).json()).csrf;
    const save=await fetch(origin+'/api/admin/settings',{method:'POST',headers:{Origin:origin,Cookie:cookie,
      'X-CSRF-Token':csrf,'Content-Type':'application/json'},
      body:JSON.stringify({publicUrl:'',phoneNumber:'',rateLimitSeconds:0,sc3SendKey:'sctp12345tABCDEFGH1234567'})});
    assert.equal(save.status,200,await save.text());
    const original=await api('/api/notify',{message:'请尽快挪车',location:{lat:30.21,lng:120.16}});
    assert.equal(original.status,200,await original.clone().text());
    const first=await original.json();
    const followup=await api('/api/notify',{message:'车辆挡住出口',location:{lat:31.25,lng:121.45}});
    assert.equal(followup.status,200,await followup.clone().text());
    const second=await followup.json();
    assert.notEqual(first.requestId,second.requestId);
    assert.notEqual(first.pollToken,second.pollToken);
    assert.notEqual(first.photoToken,second.photoToken);
    assert.equal(calls.length,2);
    for(const [index,coords] of [[0,'120.16,30.21'],[1,'121.45,31.25']]){
      const body=calls[index].desp;
      assert.ok(body.includes('\n\n'),'Markdown must include blank lines');
      assert.ok(body.includes('[📍 高德地图导航](https://uri.amap.com/marker?position='+coords),'Amap must have a clickable link');
      assert.ok(body.includes('[🗺️ Google 地图](https://www.google.com/maps?q='),'Google Maps must have a clickable link');
      assert.ok(body.includes('[车主点击确认挪车]('),'Owner confirmation must be an independent link');
      assert.ok(!body.includes('\\n'),'SC3 must not display literal escaped newlines');
    }
    assert.notEqual(calls[0].desp.match(/\/owner-confirm\/([A-Za-z0-9_-]{43})/)[1],
      calls[1].desp.match(/\/owner-confirm\/([A-Za-z0-9_-]{43})/)[1]);
    const firstToken=calls[0].desp.match(/\/owner-confirm\/([A-Za-z0-9_-]{43})/)[1];
    assert.equal((await fetch(origin+'/owner-confirm/'+firstToken)).status,200);
    const invalid=await api('/api/confirm-move',{token:'X'.repeat(43)});
    assert.equal(invalid.status,410);
    const withoutPoll=await api('/api/request-status',{requestId:first.requestId,pollToken:second.pollToken});
    assert.equal(withoutPoll.status,410);
    const firstInfo=await (await fetch(origin+'/api/owner-request/'+firstToken)).json();
    assert.equal(firstInfo.message,'请尽快挪车');
    assert.match(firstInfo.location.amap,/120.16,30.21/);
    assert.equal((await api('/api/confirm-move',{token:firstToken})).status,200);
    const status=async a=>(await (await api('/api/request-status',a)).json()).status;
    assert.equal(await status(first),'confirmed');
    assert.equal(await status(second),'waiting');
    assert.equal((await api('/api/confirm-move',{token:firstToken})).status,200);
    assert.equal(await status(second),'waiting');
  }finally{
    const done=processServer.exitCode===null?new Promise(r=>processServer.once('exit',r)):Promise.resolve();
    if(processServer.exitCode===null)processServer.kill('SIGTERM');await done;
    await close(mock);fs.rmSync(dir,{recursive:true,force:true});
  }
});