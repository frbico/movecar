import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createRequestFlow} from '../request-flow.mjs';

test('FCM receives plain text while rich channels retain Markdown',async()=>{
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE photo_records(id TEXT PRIMARY KEY,data BLOB,expiry INTEGER,mime TEXT)');
  const pushes=[];
  let response;
  let serial=0;
  const flow=createRequestFlow({
    db,
    setting:(key,fallback)=>key==='owner_signing_key'?'test-signing-key':fallback,
    random:()=>String(++serial).padStart(43,'A'),
    hash:value=>value,
    notifyChannels:async payload=>{pushes.push(payload);return {app:'ok'};},
    inputJson:async()=>({message:'车挡住出口了'}),
    inputPhoto:async()=>({bytes:Buffer.from('photo'),mime:'image/png'}),
    json:(_res,status,body)=>{response={status,...body};},
    reply:()=>{},
    rateGet:{get:()=>null},
    ratePut:{run:()=>{}},
    notificationAvailable:()=>true
  });
  const origin='https://car.example';
  await flow.handle({method:'POST',socket:{remoteAddress:'127.0.0.1'}},{},origin,
    new URL(origin+'/api/notify'));
  assert.equal(response.status,200);
  assert.match(pushes[0].message,/^## /);
  assert.match(pushes[0].appMessage,/留言：车挡住出口了/);
  assert.doesNotMatch(pushes[0].appMessage,/##|\*\*|!\[/);

  await flow.handle({method:'POST',headers:{'content-type':'image/png',
    'x-photo-token':response.photoToken}},{},origin,new URL(origin+'/api/photo'));
  assert.equal(response.status,200);
  assert.match(pushes[1].message,/!\[现场照片\]/);
  assert.equal(pushes[1].appMessage,'对方补充了一张现场照片，打开 APP 查看。');
  db.close();
});
