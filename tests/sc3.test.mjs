import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
const close=s=>new Promise(r=>s.close(r));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('Server酱³ 保存、单独测试、密钥脱敏与清除',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'movecar-sc3-'));
 let received=[];
 const mock=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;received.push(JSON.parse(body));res.setHeader('Content-Type','application/json');res.end('{"code":0}')});
 await listen(mock);
 const reserve=http.createServer();await listen(reserve);const port=reserve.address().port;await close(reserve);
 const origin='http://127.0.0.1:'+port;
 const env={...process.env,PORT:String(port),DB_PATH:path.join(dir,'state.sqlite'),SOURCE_PATH:path.join(process.cwd(),'tests/fake-worker.js'),NODE_ENV:'test',MOVECAR_TEST_SC3_ENDPOINT:'http://127.0.0.1:'+mock.address().port+'/test'};
 const p=spawn(process.execPath,['server.mjs'],{env,stdio:'pipe'});let err='';p.stderr.on('data',d=>err+=d);
 const send=(url,options)=>fetch(origin+url,options);
 let cookie='',csrf='';
 const admin=(route,payload)=>send(route,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,Origin:origin},body:JSON.stringify(payload)});
 try{
   let live=false;for(let i=0;i<150;i++){try{if((await send('/healthz')).ok){live=true;break}}catch{}await sleep(40)}
   assert.ok(live,err);
   const password=fs.readFileSync(path.join(dir,'admin-initial-password'),'utf8').trim();
   const login=await admin('/api/admin/login',{password});assert.equal(login.status,200);
   cookie=login.headers.get('set-cookie').split(';')[0];
   csrf=(await(await send('/api/admin/session',{headers:{Cookie:cookie}})).json()).csrf;
   const base={publicUrl:'',phoneNumber:'',rateLimitSeconds:0};
   assert.equal((await admin('/api/admin/settings',{...base,sc3SendKey:'SCTinvalid'})).status,400);
   const key='sctp12345tABCDEFGH1234567';
   assert.equal((await admin('/api/admin/settings',{...base,sc3SendKey:key})).status,200);
   const config=await(await send('/api/admin/config',{headers:{Cookie:cookie}})).json();
   assert.equal(config.sc3Configured,true);assert.ok(!JSON.stringify(config).includes(key));
   const response=await admin('/api/admin/test-push',{channel:'sc3'});
   assert.equal(response.status,200,await response.text());
   assert.deepEqual((await response.json()).channels,{sc3:'ok'});
   assert.equal(received.length,1);
   assert.equal(received[0].tags,'挪车');
   assert.match(received[0].desp,/owner-confirm\?expires=/);
   assert.equal((await admin('/api/admin/settings',{...base,clearSc3:true})).status,200);
   assert.equal((await admin('/api/admin/test-push',{channel:'sc3'})).status,503);
 }finally{
  if(p.exitCode===null){const done=new Promise(r=>p.once('exit',r));p.kill('SIGTERM');await done}
  await close(mock);fs.rmSync(dir,{recursive:true,force:true});
 }
});