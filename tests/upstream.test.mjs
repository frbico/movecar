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
    const home=await fetch(origin);assert.equal(home.status,200);const homeHTML=await home.text();assert.match(homeHTML,/html/i);assert.match(homeHTML,/id="photoCard"/);assert.match(homeHTML,/photo-ui\.js/);assert.match(homeHTML,/const delayed = false/);assert.match(homeHTML,/window\.moveCarPhotoGrant/);
    const photoscript=await fetch(`${origin}/photo-ui.js`);assert.equal(photoscript.status,200);assert.match(await photoscript.text(),/photoSendBtn/);
    const admin=await fetch(`${origin}/admin`);assert.equal(admin.status,200);
  } finally{
    const exit=proc.exitCode===null?new Promise(r=>proc.once('exit',r)):Promise.resolve();
    if(proc.exitCode===null)proc.kill('SIGTERM');
    await exit;fs.rmSync(dir,{recursive:true,force:true});
  }
});
