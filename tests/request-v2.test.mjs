import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
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
  const oldDb=new DatabaseSync(path.join(dir,'test.sqlite'));
  oldDb.exec("CREATE TABLE move_requests(id TEXT PRIMARY KEY,owner_digest TEXT NOT NULL UNIQUE,poll_digest TEXT NOT NULL UNIQUE,message TEXT NOT NULL,location_json TEXT,status TEXT NOT NULL DEFAULT 'waiting',photo_sent INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,confirmed_at INTEGER)");
  oldDb.close();
  const calls=[];
  let failNextPush=false;
  const mock=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    calls.push(JSON.parse(body));res.setHeader('Content-Type','application/json');
    res.end(failNextPush?'{"code":1}':'{"code":0}');failNextPush=false;
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
    for(const body of calls.slice(0,2).map(x=>x.desp)){
      assert.ok(body.includes('\n\n'),'Markdown must include blank lines');
      assert.ok(body.includes('[车主点击确认挪车]('),'Owner confirmation must be an independent link');
      assert.ok(!body.includes('\\n'),'SC3 must not display literal escaped newlines');
      assert.ok(!/高德地图|Google 地图|Apple 地图|未分享位置|定位|经纬度|120\.16|121\.45/.test(body),'Messages must not contain location or map links');
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
    assert.equal(Object.hasOwn(firstInfo,'location'),false);
    assert.equal((await api('/api/confirm-move',{token:firstToken})).status,200);
    const status=async a=>(await (await api('/api/request-status',a)).json()).status;
    assert.equal(await status(first),'confirmed');
    assert.equal(await status(second),'waiting');
    assert.equal((await api('/api/confirm-move',{token:firstToken})).status,200);
    assert.equal(await status(second),'waiting');
    const visitorPhone=()=>api('/api/visitor-phone',{requestId:first.requestId,pollToken:first.pollToken,phone:'13800138000'});
    assert.equal((await visitorPhone()).status,403,'phone option is off by default');
    const enablePhone=await fetch(origin+'/api/admin/settings',{method:'POST',
      headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},
      body:JSON.stringify({publicUrl:'',phoneNumber:'',rateLimitSeconds:0,visitorPhoneEnabled:true})});
    assert.equal(enablePhone.status,200,await enablePhone.clone().text());
    assert.equal((await(await fetch(origin+'/api/site-config')).json()).visitorPhoneEnabled,true);
    assert.equal((await api('/api/visitor-phone',{requestId:first.requestId,pollToken:second.pollToken,phone:'13800138000'})).status,410);
    assert.equal((await api('/api/visitor-phone',{requestId:first.requestId,pollToken:first.pollToken,phone:'1380013800'})).status,400);
    failNextPush=true;
    assert.equal((await visitorPhone()).status,502,'failed push can be retried');
    assert.equal((await(await fetch(origin+'/api/owner-request/'+firstToken)).json()).visitorPhone,null);
    const sentPhone=await visitorPhone();assert.equal(sentPhone.status,200,await sentPhone.clone().text());
    assert.match(calls.at(-1).desp,/13800138000/);
    assert.equal((await visitorPhone()).status,409,'the same request cannot send a second number');
    assert.equal((await(await fetch(origin+'/api/owner-request/'+firstToken)).json()).visitorPhone,'13800138000');
    const privateHistory=await(await fetch(origin+'/api/admin/requests',{headers:{Cookie:cookie}})).json();
    assert.equal(privateHistory.items.find(item=>item.id===first.requestId).visitorPhone,'13800138000');
    assert.equal(Object.hasOwn(await (await api('/api/request-status',first)).json(),'visitorPhone'),false);
    // Accept original PNG data without a browser Canvas decode or re-encoding step.
    const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(9*1024*1024+77,55)]); // 9+ MiB is valid
    const upload=(token,type,bytes)=>fetch(origin+'/api/photo',{method:'POST',headers:{'Content-Type':type,'X-Photo-Token':token},body:bytes});
    const tooLarge=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(10*1024*1024,55)]);
    const tooLargeResponse=await upload(first.photoToken,'image/png',tooLarge);
    assert.equal(tooLargeResponse.status,413,'File exceeding 10 MiB must be rejected without consuming the grant');
    const firstImage=await upload(first.photoToken,'image/png',png);
    assert.equal(firstImage.status,200,await firstImage.clone().text());
    const pngUrl=calls.at(-1).desp.match(/https?:\/\/127\.0\.0\.1:\d+\/api\/photo\/[A-Za-z0-9_-]{43}/)[0];
    const savedPng=await fetch(pngUrl);
    assert.equal(savedPng.headers.get('content-type'),'image/png');
    assert.deepEqual(Buffer.from(await savedPng.arrayBuffer()),png);
    // HEIC originals are passed through as-is; they do not require browser decoding.
    const heic=Buffer.alloc(64);
    heic.writeUInt32BE(64,0);heic.write('ftyp',4);heic.write('heic',8);
    const mismatch=await upload(second.photoToken,'image/jpeg',heic);
    assert.equal(mismatch.status,415);
    const secondImage=await upload(second.photoToken,'image/heic',heic);
    assert.equal(secondImage.status,200,await secondImage.clone().text());
    const heicUrl=calls.at(-1).desp.match(/https?:\/\/127\.0\.0\.1:\d+\/api\/photo\/[A-Za-z0-9_-]{43}/)[0];
    const savedHeic=await fetch(heicUrl);
    assert.equal(savedHeic.headers.get('content-type'),'image/heic');
    assert.deepEqual(Buffer.from(await savedHeic.arrayBuffer()),heic);
    // Admin retention changes take effect immediately and cascade-delete associated photos.
    const cap=await fetch(origin+'/api/admin/settings',{method:'POST',
      headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},
      body:JSON.stringify({publicUrl:'',phoneNumber:'',rateLimitSeconds:0,requestRetentionLimit:1})});
    assert.equal(cap.status,200,await cap.clone().text());
    const info=await (await fetch(origin+'/api/admin/config',{headers:{Cookie:cookie}})).json();
    assert.equal(info.requestRetentionLimit,1);
    assert.equal(info.requestCount,1);
    assert.equal((await api('/api/request-status',{requestId:first.requestId,pollToken:first.pollToken})).status,410);
    assert.equal(await status(second),'waiting');
    assert.equal((await fetch(pngUrl)).status,404);
    assert.equal((await fetch(heicUrl)).status,200);
    const invalidLimit=await fetch(origin+'/api/admin/settings',{method:'POST',
      headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},
      body:JSON.stringify({publicUrl:'',phoneNumber:'',rateLimitSeconds:0,requestRetentionLimit:0})});
    assert.equal(invalidLimit.status,400);
    // History is admin-only, stays after link expiry and supports scoped deletion.
    assert.equal((await fetch(origin+'/api/admin/requests')).status,401);
    const history=await fetch(origin+'/api/admin/requests?page=1&size=20',{headers:{Cookie:cookie}});
    assert.equal(history.status,200);
    const records=await history.json();
    assert.equal(records.total,1);
    assert.equal(records.items[0].id,second.requestId);
    assert.match(records.items[0].photoUrl,/^\/api\/photo\/[A-Za-z0-9_-]{43}$/);
    const branded=await fetch(origin+'/api/admin/settings',{method:'POST',
      headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},
      body:JSON.stringify({publicUrl:'',phoneNumber:'',rateLimitSeconds:0,requestRetentionLimit:1,siteName:'一键联系车主',wechatId:'wx_demo123'})});
    assert.equal(branded.status,200,await branded.clone().text());
    const publicBrand=await(await fetch(origin+'/api/site-config')).json();
    assert.equal(publicBrand.siteName,'一键联系车主');
    assert.equal(publicBrand.wechatId,'wx_demo123');
    const pngIcon=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(64,19)]);
    const iconUpload=await fetch(origin+'/api/admin/site-icon',{method:'PUT',
      headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'image/png'},body:pngIcon});
    assert.equal(iconUpload.status,200,await iconUpload.clone().text());
    const iconResponse=await fetch(origin+'/site-icon');
    assert.equal(iconResponse.status,200);
    assert.equal(iconResponse.headers.get('content-type'),'image/png');
    assert.deepEqual(Buffer.from(await iconResponse.arrayBuffer()),pngIcon);
    const failedIcon=await fetch(origin+'/api/admin/site-icon',{method:'PUT',
      headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'image/png'},body:Buffer.from('<svg><script>alert(1)</script></svg>')});
    assert.equal(failedIcon.status,415);
    const removeRow=await fetch(origin+'/api/admin/requests/delete',{method:'POST',
      headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},
      body:JSON.stringify({id:second.requestId})});
    assert.equal(removeRow.status,200,await removeRow.clone().text());
    assert.equal((await(await fetch(origin+'/api/admin/requests',{headers:{Cookie:cookie}})).json()).total,0);
    assert.equal((await fetch(heicUrl)).status,404,'Deleting a history entry must delete its photo');
    const clearIcon=await fetch(origin+'/api/admin/site-icon/clear',{method:'POST',
      headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:'{}'});
    assert.equal(clearIcon.status,200);
    assert.equal((await fetch(origin+'/site-icon')).status,404);
  }finally{
    const done=processServer.exitCode===null?new Promise(r=>processServer.once('exit',r)):Promise.resolve();
    if(processServer.exitCode===null)processServer.kill('SIGTERM');await done;
    await close(mock);fs.rmSync(dir,{recursive:true,force:true});
  }
});
