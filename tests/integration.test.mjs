import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const startServer=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
const closeServer=s=>new Promise(r=>s.close(r));

test('one-click bootstrap, admin login, two channels, secure owner action and persistence',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'movecar-next-'));
  const barkCalls=[],wechatCalls=[];
  const barkServer=http.createServer((req,res)=>{barkCalls.push(`http://127.0.0.1:${barkServer.address().port}${req.url}`);res.writeHead(200,{'Content-Type':'application/json'});res.end('{"code":200}');});
  const wcServer=http.createServer((req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{wechatCalls.push(new URLSearchParams(Buffer.concat(chunks).toString()));res.writeHead(200,{'Content-Type':'application/json'});res.end('{"code":0}');});});
  await Promise.all([startServer(barkServer),startServer(wcServer)]);
  const socket=http.createServer((req,res)=>res.end());await startServer(socket);const port=socket.address().port;await closeServer(socket);
  const origin=`http://127.0.0.1:${port}`;
  const env={...process.env,PORT:String(port),SOURCE_PATH:path.join(root,'tests/fake-worker.js'),DB_PATH:path.join(dir,'state.sqlite'),NODE_ENV:'test',MOVECAR_TEST_HTTP_PUSH:'1',MOVECAR_TEST_WECHAT_ENDPOINT:`http://127.0.0.1:${wcServer.address().port}/send`};
  let proc,stderr='',adminCookie='',csrf='';
  const call=(url,options={})=>fetch(origin+url,options);
  async function start(){
    proc=spawn(process.execPath,['server.mjs'],{cwd:root,env,stdio:'pipe'});
    proc.stderr.on('data',d=>stderr+=d.toString());
    for(let i=0;i<200;i++){
      if(proc.exitCode!==null)throw Error(stderr);
      try{if((await call('/healthz')).ok)return;}catch{}
      await sleep(40);
    }
    throw Error('Server did not start: '+stderr);
  }
  async function stop(){if(!proc||proc.exitCode!==null)return;const exiting=new Promise(r=>proc.once('exit',r));proc.kill('SIGTERM');await exiting;}
  const admin=(url,body)=>call(url,{method:'POST',headers:{'Content-Type':'application/json','Cookie':adminCookie,'X-CSRF-Token':csrf,'Origin':origin},body:JSON.stringify(body)});
  try{
    await start();
    assert.equal((await call('/')).status,200);
    assert.equal((await call('/admin')).status,200);
    assert.match(await (await call('/admin')).text(),/管理后台/);
    assert.equal((await call('/api/admin/config')).status,401);
    assert.equal((await call('/api/notify',{method:'POST',body:'{}'})).status,503);
    const password=fs.readFileSync(path.join(dir,'admin-initial-password'),'utf8').trim();
    assert.ok(password.length>30);
    assert.equal((await admin('/api/admin/login',{password:'wrong'})).status,401);
    const logged=await admin('/api/admin/login',{password});assert.equal(logged.status,200);
    adminCookie=logged.headers.get('set-cookie').split(';')[0];
    // The browser may use HTTPS while its reverse proxy talks HTTP to Node.
    const proxied=await call('/api/admin/login',{method:'POST',headers:{Origin:`https://127.0.0.1:${port}`,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'},body:JSON.stringify({password})});
    assert.equal(proxied.status,200,await proxied.text());
    assert.match(proxied.headers.get('set-cookie'),/; Secure/);
    const proxyCookie=proxied.headers.get('set-cookie').split(';')[0];
    const proxySession=await call('/api/admin/session',{headers:{Cookie:proxyCookie}});
    assert.equal(proxySession.status,200);
    const proxyCsrf=(await proxySession.json()).csrf;
    const proxyUpdate=await call('/api/admin/settings',{method:'POST',headers:{Origin:`https://127.0.0.1:${port}`,'Sec-Fetch-Site':'same-origin',Cookie:proxyCookie,'X-CSRF-Token':proxyCsrf,'Content-Type':'application/json'},body:JSON.stringify({publicUrl:'',phoneNumber:'',rateLimitSeconds:60})});
    assert.equal(proxyUpdate.status,200,await proxyUpdate.text());
    const evil=await call('/api/admin/login',{method:'POST',headers:{Origin:'https://evil.example.test','Sec-Fetch-Site':'cross-site','Content-Type':'application/json'},body:JSON.stringify({password})});
    assert.equal(evil.status,403);
    assert.match(logged.headers.get('set-cookie'),/HttpOnly/);
    const session=await call('/api/admin/session',{headers:{Cookie:adminCookie}});csrf=(await session.json()).csrf;
    const before=await call('/api/admin/config',{headers:{Cookie:adminCookie}});
    assert.equal((await before.json()).serverchanConfigured,false);
    assert.equal((await call('/api/admin/settings',{method:'POST',headers:{Cookie:adminCookie},body:'{}'})).status,403);
    const settings={publicUrl:'',phoneNumber:'13800000000',rateLimitSeconds:0,barkUrl:`http://127.0.0.1:${barkServer.address().port}/bark/key`,serverchanSendKey:'SCT123456789ABCDEFG',clearBark:false,clearServerchan:false};
    const saved=await admin('/api/admin/settings',settings);assert.equal(saved.status,200,await saved.text());
    const cfg=await(await call('/api/admin/config',{headers:{Cookie:adminCookie}})).json();
    assert.equal(cfg.barkConfigured,true);assert.equal(cfg.serverchanConfigured,true);assert.equal(cfg.phoneNumber,'13800000000');
    // The configured public notification URL must not lock out direct-IP admin access.
    const configured=await admin('/api/admin/settings',{...settings,publicUrl:'https://car.example.test'});
    assert.equal(configured.status,200,await configured.text());
    const directLogin=await admin('/api/admin/login',{password});
    assert.equal(directLogin.status,200,await directLogin.text());
    await admin('/api/admin/settings',settings);
    assert.equal(JSON.stringify(cfg).includes('SCT123'),false);
    const testPush=await admin('/api/admin/test-push',{});assert.equal(testPush.status,200,await testPush.text());
    assert.equal(wechatCalls.length,1);assert.equal(barkCalls.length,1);
    assert.match(wechatCalls[0].get('desp'),/车主点击确认/);
    assert.equal((await call('/owner-confirm')).status,403);
    assert.equal((await call('/api/get-location')).status,403);
    const request=await call('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'请挪车',location:{lat:30.2,lng:120.1}})});
    const requestData=await request.clone().json();
    assert.equal(request.status,200,await request.text());
    assert.equal(wechatCalls.length,2);assert.equal(barkCalls.length,2);
    const link=new URL(barkCalls[1]).searchParams.get('url');
    assert.match(link,/\/owner-confirm\/[A-Za-z0-9_-]{43}$/);
    const token=link.split('/').pop();
    const ownerPage=await fetch(link);assert.equal(ownerPage.status,200);
    assert.match(await ownerPage.text(),/确认挪车请求/);
    const ownerInfo=await (await call('/api/owner-request/'+token)).json();
    assert.match(ownerInfo.location.amap,/uri.amap.com/);
    assert.match(ownerInfo.location.google,/google.com\/maps/);
    assert.equal((await call('/api/request-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:requestData.requestId,pollToken:'bad'})})).status,404);
    const post=async (url,body)=>call(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const beforeConfirm=await (await post('/api/request-status',{requestId:requestData.requestId,pollToken:requestData.pollToken})).json();
    assert.equal(beforeConfirm.status,'waiting');
    const confirm=await post('/api/confirm-move',{token});assert.equal(confirm.status,200);
    const confirmed=await (await post('/api/request-status',{requestId:requestData.requestId,pollToken:requestData.pollToken})).json();
    assert.equal(confirmed.status,'confirmed');
    // The photo endpoint only accepts a one-use capability created by a successful notification.
    const photoToken=requestData.photoToken;
    assert.match(photoToken,/^[a-zA-Z0-9_-]{43}$/);
    const jpg=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(64,32),Buffer.from([255,217])]);
    const photo=await call('/api/photo',{method:'POST',headers:{Origin:origin,'Content-Type':'image/jpeg','X-Photo-Token':photoToken},body:jpg});
    assert.equal(photo.status,200,await photo.text());
    assert.equal((await call('/api/photo',{method:'POST',headers:{Origin:origin,'Content-Type':'image/jpeg','X-Photo-Token':photoToken},body:jpg})).status,403);
    const photoMsg=wechatCalls.at(-1).get('desp');
    assert.match(photoMsg,/!\[现场照片\]\(http:\/\/127\.0\.0\.1:\d+\/api\/photo\/[a-zA-Z0-9_-]{43}\)/);
    const linkFromMessage=photoMsg.match(/https?:\/\/127\.0\.0\.1:\d+\/api\/photo\/[a-zA-Z0-9_-]{43}/)[0];
    const got=await fetch(linkFromMessage);
    assert.equal(got.status,200);
    assert.equal(got.headers.get('content-type'),'image/jpeg');
    assert.deepEqual(Buffer.from(await got.arrayBuffer()),jpg);
    await stop();await start();
    assert.equal((await call('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'重启成功',location:{lat:30,lng:120}})})).status,200);
    assert.equal((await call('/api/admin/config',{headers:{Cookie:adminCookie}})).status,200);
    const change=await admin('/api/admin/password',{currentPassword:password,newPassword:'new-password-12345'});
    assert.equal(change.status,200,await change.text());
    assert.equal(fs.existsSync(path.join(dir,'admin-initial-password')),false);
    assert.equal((await call('/api/admin/session',{headers:{Cookie:adminCookie}})).status,401);
    assert.equal((await admin('/api/admin/login',{password})).status,401);
    assert.equal((await admin('/api/admin/login',{password:'new-password-12345'})).status,200);
  }finally{await stop();await Promise.all([closeServer(barkServer),closeServer(wcServer)]);fs.rmSync(dir,{recursive:true,force:true});}
});
