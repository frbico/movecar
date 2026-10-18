import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {createMobileOwner} from '../mobile-owner.mjs';

test('native owner sign-in, authentication, notifications, records, and account revocation', async()=>{
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE admin_sessions(digest TEXT PRIMARY KEY)');
  const settings=new Map();
  const salt='salt-for-testing';
  settings.set('admin_salt',salt);
  settings.set('admin_hash',crypto.scryptSync('correct-password',salt,64).toString('hex'));
  let deviceAuth='';let revokeCount=0;let confirmationId='',deletedId='';let pushes=[];
  let callHistory=[{callId:'test',status:'ended',startedAt:123456,updatedAt:123457}];
  const voice={
    registerMobileDevice(fcm){assert.ok(fcm.length>10);deviceAuth=crypto.randomBytes(32).toString('base64url');return deviceAuth;},
    unregisterMobileDevice(auth){if(auth===deviceAuth){revokeCount++;deviceAuth='';return true;}return false;},
    revokeAllMobileDevices(){if(deviceAuth)revokeCount++;deviceAuth='';},
    isDeviceReady(){return !!deviceAuth;},
    getCallPolicy(){return {dailyLimit:Number(settings.get('voice_daily_limit')||8),
      cooldownSeconds:Number(settings.get('voice_cooldown_seconds')||90),
      maxFastRetries:Number(settings.get('voice_fast_retries')||2),
      testMode:settings.get('voice_test_mode')==='1'};},
    resetCallRateLimits(){return true;},
    listCallHistory(){return callHistory;},
    clearCallHistory(){const count=callHistory.length;callHistory=[];return count;}
  };
  const flow={
    retentionLimit:()=>Number(settings.get('request_retention_limit')||50),count:()=>1,
    listHistory:()=>({total:1,items:[{id:'A'.repeat(43),message:'Move please',status:'waiting'}]}),
    confirmHistory:id=>{confirmationId=id;return true;},
    deleteHistory:id=>{deletedId=id;return true;},clearHistory(){},trimRetention(){}
  };
  const api=createMobileOwner({db,voice,requestFlow:flow,
    setting:(k,f='')=>settings.get(k)??f,save:(k,v)=>settings.set(k,String(v)),deleteSetting:k=>settings.delete(k),
    validateOrigin:s=>s,validateBark:s=>s,validateSc3Key:s=>s,validateSendKey:s=>s,
    iconGet:{get:()=>null},iconSave:{run:()=>{}},iconClear:{run:()=>{}},iconUpload:async()=>({data:Buffer.from('fake'),mime:'image/png'}),
    notifyChannels:async call=>{pushes.push(call);return {[call.channel||'app']:'ok'};},
    inputJson:async req=>{let text='';for await(const c of req)text+=c;return JSON.parse(text||'{}');},
    json:(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(obj));}
  });
  const server=http.createServer(async(req,res)=>{
    try {if(!await api.handle(req,res,new URL(req.url,'http://localhost'))){res.statusCode=404;res.end();}}
    catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  const call=async(route,body,token)=>{
    const res=await fetch(origin+'/api/mobile/'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:res.status,data:await res.json()};
  };
  try {
    assert.equal((await call('config')).status,401);
    assert.equal((await call('login',{username:'wrong',password:'correct-password'})).status,401);
    assert.equal((await call('login',{username:'admin',password:'wrong'})).status,401);
    const login=await call('login',{username:'admin',password:'correct-password',fcmToken:'fcm-token-for-local-unit-test'});
    assert.equal(login.status,200);assert.ok(login.data.deviceAuth);const token=login.data.token;
    const config=await call('config',undefined,token);
    assert.equal(config.status,200);assert.equal(config.data.channels.app.configured,true);
    const initialCalls=await call('calls',undefined,token);
    assert.equal(initialCalls.data.items.length,1);
    assert.equal((await call('calls/clear',{},token)).status,400,'requires explicit confirmation');
    assert.equal((await call('calls/clear',{confirm:true})).status,401,'only signed-in owner may clear history');
    const cleared=await call('calls/clear',{confirm:true},token);
    assert.equal(cleared.status,200);
    assert.equal(cleared.data.deleted,1);
    assert.deepEqual((await call('calls',undefined,token)).data.items,[]);

    assert.equal(config.data.voicePolicy.dailyLimit,8);
    const newPolicy=await call('voice-policy',{
      dailyLimit:40,cooldownSeconds:5,maxFastRetries:4,testMode:true
    },token);
    assert.equal(newPolicy.status,200);
    assert.equal(newPolicy.data.voicePolicy.testMode,true);
    assert.equal((await call('voice-policy/reset',{},token)).status,200);

    assert.equal((await call('channels',{appEnabled:false,sc3SendKey:'sctp-not-a-real-secret',barkEnabled:false},token)).status,200);
    assert.equal(settings.get('notify_app_enabled'),'0');
    const channels=await call('config',undefined,token);
    assert.equal(channels.data.channels.app.enabled,false);
    assert.equal(JSON.stringify(channels.data).includes('sctp-not-a-real-secret'),false);
    assert.equal((await call('channels/test',{channel:'app'},token)).status,200);assert.equal(pushes[0].channel,'app');
    const requests=await call('requests',undefined,token);assert.equal(requests.data.total,1);
    assert.equal((await call('requests/confirm',{id:'A'.repeat(43)},token)).status,200);
    assert.equal(confirmationId,'A'.repeat(43));
    assert.equal((await call('requests/delete',{id:'A'.repeat(43)},token)).status,200);
    assert.equal(deletedId,'A'.repeat(43));
    assert.deepEqual((await call('calls',undefined,token)).data.items,[],'clearing history persists across other settings updates');
    assert.equal((await call('settings',{siteName:'My MoveCar',publicUrl:'https://car.example.com',phoneNumber:'',wechatId:'',rateLimitSeconds:10,requestRetentionLimit:75},token)).status,200);
    assert.equal(settings.get('site_name'),'My MoveCar');
    assert.equal((await call('account',{newUsername:'owner01',currentPassword:'wrong'},token)).status,403);
    assert.equal((await call('account',{newUsername:'owner01',currentPassword:'correct-password',newPassword:'new-secure-password',deviceAuth:login.data.deviceAuth},token)).status,200);
    assert.equal((await call('config',undefined,token)).status,401);
    assert.equal(revokeCount,1);
    assert.equal((await call('login',{username:'admin',password:'new-secure-password'})).status,401);
    const relog=await call('login',{username:'owner01',password:'new-secure-password',fcmToken:'second-valid-test-fcm-token'});
    assert.equal(relog.status,200);
    assert.equal((await call('logout',{deviceAuth:relog.data.deviceAuth},relog.data.token)).status,200);
    assert.equal((await call('config',undefined,relog.data.token)).status,401);
    assert.equal(revokeCount,2);
  } finally {await new Promise(r=>server.close(r));db.close();}
});