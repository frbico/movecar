import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createUpdateService} from '../update-service.mjs';

const SHA1='a'.repeat(40),SHA2='b'.repeat(40);
const fixture=()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'movecar-upgrade-'));
 fs.writeFileSync(path.join(dir,'release.json'),JSON.stringify({version:'0.5.1'}));
 let requested=[];
 const fetcher=async (url)=> {
   requested.push(url);
   return {ok:true,status:200,json:async()=>url.includes('api.github.com')?
     {object:{sha:SHA2}}:{version:'0.5.2',changes:['修复升级失败','网页后台一键更新']}};
 };
 const service=createUpdateService({runtimeDir:dir,releasePath:path.join(dir,'release.json'),
   localSha:SHA1,fetcher});
 return {dir,service,requested,clean:()=>fs.rmSync(dir,{recursive:true,force:true})};
};
test('checks only the pinned repository stable channel; renders safe changelog',async()=>{
 const f=fixture();
 try{
  const result=await f.service.check();
  assert.equal(result.current.sha,SHA1);
  assert.equal(result.latest.sha,SHA2);
  assert.equal(result.available,true);
  assert.ok(f.requested[0].includes('frbico/movecar/git/ref/heads/release/stable'));
  assert.deepEqual(result.latest.changes,['修复升级失败','网页后台一键更新']);
 }finally{f.clean();}
});
test('queues a single bounded update request, never executes shell commands',async()=>{
 const f=fixture();
 try{
  await assert.rejects(()=>f.service.requestUpdate('$(rm -rf /)'),/版本 ID/);
  await assert.rejects(()=>f.service.requestUpdate(SHA1),/重新检查/);
  const r=await f.service.requestUpdate(SHA2);
  assert.equal(r.ok,true);
  const marker=JSON.parse(fs.readFileSync(path.join(f.dir,'update-request.json'),'utf8'));
  assert.equal(marker.sha,SHA2);
  assert.equal(marker.channel,'release/stable');
  assert.ok(/^[0-9a-f-]{36}$/.test(marker.id));
  assert.equal(fs.statSync(path.join(f.dir,'update-request.json')).mode&0o777,0o600);
  await assert.rejects(()=>f.service.requestUpdate(SHA2),/已经有更新任务/);
 }finally{f.clean();}
});
test('no update available when the current installed commit equals remote',async()=>{
 const f=fixture();
 try{
  const service=createUpdateService({
   runtimeDir:f.dir,releasePath:path.join(f.dir,'release.json'),localSha:SHA2,
   fetcher:async (u)=>({ok:true,status:200,json:async()=>u.includes('api.github.com')?{object:{sha:SHA2}}:{version:'0.5.2'}})
  });
  assert.equal((await service.check()).available,false);
  assert.equal((await service.requestUpdate(SHA2)).ok,false);
 }finally{f.clean();}
});
