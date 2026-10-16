import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'upstream/movecar.js');

test('real downloaded upstream Worker serves homepage and admin without initial channel setup',{skip:!fs.existsSync(source)},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'movecar-real-'));
  const server=await import('node:net');
  const listener=server.createServer();
  await new Promise(r=>listener.listen(0,'127.0.0.1',r));
  const port=listener.address().port;
  await new Promise(r=>listener.close(r));
  let errors='';const proc=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),DB_PATH:path.join(dir,'state.sqlite'),SOURCE_PATH:source},stdio:'pipe'});
  proc.stderr.on('data',d=>errors+=d.toString());
  const origin=`http://127.0.0.1:${port}`;
  try{
    let ready=false;
    for(let i=0;i<100;i++){
      if(proc.exitCode!==null)throw Error(errors);
      try{if((await fetch(`${origin}/healthz`)).ok){ready=true;break;}}catch{}
      await new Promise(r=>setTimeout(r,50));
    }
    assert.ok(ready,'Real Worker did not start: '+errors);
    const home=await fetch(origin);assert.equal(home.status,200);const homeHTML=await home.text();assert.match(homeHTML,/html/i);assert.match(homeHTML,/request-ui\.js/);assert.doesNotMatch(homeHTML,/id="locationTipModal"|id="locIcon"|id="locStatus"|getCurrentPosition|navigator\.geolocation|位置获取失败|分享位置/);
    const photoscript=await fetch(`${origin}/request-ui.js`);
    assert.equal(photoscript.status,200);
    const script=await photoscript.text();
    assert.match(script,/photoChooseBtn/);
    assert.match(script,/10\*1024\*1024/);
    assert.doesNotMatch(script,/userLocation|locationData|geolocation/);
    const oldOwner=await fetch(`${origin}/owner-confirm`,{redirect:'manual'});
    assert.ok([403,303,200].includes(oldOwner.status));
    const admin=await fetch(`${origin}/admin`);assert.equal(admin.status,200);
  } finally{
    const exit=proc.exitCode===null?new Promise(r=>proc.once('exit',r)):Promise.resolve();
    if(proc.exitCode===null)proc.kill('SIGTERM');
    await exit;fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('real Worker sends immediately without GPS and uses formatted SC3 text',{skip:!fs.existsSync(source)},async()=>{
  const http=await import('node:http');
  const mock=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    mock.calls.push(JSON.parse(body));
    res.writeHead(200,{'Content-Type':'application/json'});res.end('{"code":0}');
  });
  mock.calls=[];await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  const portServer=http.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));
  const port=portServer.address().port;await new Promise(r=>portServer.close(r));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'movecar-real-push-'));
  const origin='http://127.0.0.1:'+port;
  const proc=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),NODE_ENV:'test',DB_PATH:path.join(dir,'state.sqlite'),SOURCE_PATH:source,MOVECAR_TEST_SC3_ENDPOINT:'http://127.0.0.1:'+mock.address().port+'/push'},stdio:'pipe'});
  let stderr='';proc.stderr.on('data',d=>stderr+=d);
  try{
    let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/healthz')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}
    assert.ok(ready,stderr);
    const password=fs.readFileSync(path.join(dir,'admin-initial-password'),'utf8').trim();
    const login=await fetch(origin+'/api/admin/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password})});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const session=await fetch(origin+'/api/admin/session',{headers:{Cookie:cookie}});
    const csrf=(await session.json()).csrf;
    const config=await fetch(origin+'/api/admin/settings',{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({publicUrl:'',phoneNumber:'',rateLimitSeconds:0,sc3SendKey:'sctp12345tABCDEFGH1234567'})});assert.equal(config.status,200);
    const start=Date.now();
    const notified=await fetch(origin+'/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'挡路',location:null,delayed:true})});
    assert.equal(notified.status,200,await notified.clone().text());
    assert.ok(Date.now()-start<7000,'The original 30-second delay was not bypassed');
    assert.equal(mock.calls.length,1);
    const desp=mock.calls[0].desp;
    assert.ok(desp.includes('\n'),'Body must have real newline');
    assert.ok(!desp.includes('\\n'),'Body must not contain literal escaped newline');
    assert.match(desp,/\/owner-confirm\/[A-Za-z0-9_-]{43}/);
    const ok=(await notified.json());assert.ok(ok.photoToken);
  }finally{
    const done=proc.exitCode===null?new Promise(r=>proc.once('exit',r)):Promise.resolve();
    if(proc.exitCode===null)proc.kill('SIGTERM');
    await done;await new Promise(r=>mock.close(r));fs.rmSync(dir,{recursive:true,force:true});
  }
});
