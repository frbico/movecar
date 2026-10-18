import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createInfrastructure} from '../infrastructure.mjs';

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'movecar-setup-'));
  const saved=new Map();
  const service=createInfrastructure({
    setting:(k)=>saved.get(k)||'',
    save:(k,v)=>saved.set(k,String(v)),
    dataDir:root,
    runtimeDir:path.join(root,'runtime'),
    firebaseFile:path.join(root,'firebase-service-account.json'),
    turnSecret:'a'.repeat(64),
    externalIp:'8.8.8.8'
  });
  return {root,saved,service,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('generic TURN config works before any domains or certificates are entered',()=>{
 const f=fixture();
 try{
  assert.equal(f.service.config().turnEnabled,false);
  const conf=fs.readFileSync(path.join(f.root,'runtime','turnserver.conf'),'utf8');
  assert.match(conf,/^no-tls$/m);
  assert.match(conf,/^min-port=49160$/m);
  assert.equal(f.service.ice(),null);
 }finally{f.close();}
});
test('website and TURN host are saved live and invalid or unsafe values are rejected',()=>{
 const f=fixture();
 try{
  const cfg=f.service.configure({siteUrl:'https://movecar.example.com',turnHost:'turn.example.com'});
  assert.equal(cfg.turnHost,'turn.example.com');
  assert.equal(cfg.publicUrl,'https://movecar.example.com');
  assert.deepEqual(f.service.ice(),{
   stunUrls:'stun:turn.example.com:3478',
   turnUrls:'turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp'
  });
  assert.throws(()=>f.service.configure({siteUrl:'http://example.com',turnHost:'turn.example.com'}));
  assert.throws(()=>f.service.configure({siteUrl:'https://example.com/a',turnHost:'turn.example.com'}));
  assert.throws(()=>f.service.configure({siteUrl:'https://example.com',turnHost:'turn.example.com\nno-auth'}));
 }finally{f.close();}
});
test('Admin SDK service account secret uploads stay private and on disk, invalid config rejected',()=>{
 const f=fixture();
 try{
  assert.throws(()=>f.service.saveFirebase(JSON.stringify({project_id:'wrong'})));
  const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const key=privateKey.export({type:'pkcs8',format:'pem'});
  const input={type:'service_account',project_id:'demo-test',client_email:'bot@demo-test.iam.gserviceaccount.com',private_key:key};
  const result=f.service.saveFirebase(JSON.stringify(input));
  assert.equal(result.firebaseConfigured,true);
  assert.equal(f.service.config().firebaseConfigured,true);
  assert.equal(fs.statSync(path.join(f.root,'firebase-service-account.json')).mode&0o777,0o600);
  assert.ok(!JSON.stringify(f.service.config()).includes(key));
 }finally{f.close();}
});
test('Uploaded PEM enables TURN TLS immediately; different host removes TLS URLs',()=>{
 const f=fixture();
 try{
  f.service.configure({siteUrl:'https://movecar.example.com',turnHost:'turn.example.com'});
  const cert=path.join(f.root,'cert.pem'),key=path.join(f.root,'key.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','3','-sha256',
   '-subj','/CN=turn.example.com','-addext','subjectAltName=DNS:turn.example.com',
   '-keyout',key,'-out',cert],{stdio:'ignore'});
  assert.throws(()=>f.service.saveTls(fs.readFileSync(cert,'utf8'), 'not a private key'));
  const out=f.service.saveTls(fs.readFileSync(cert,'utf8'),fs.readFileSync(key,'utf8'));
  assert.equal(out.turnTlsEnabled,true);
  assert.match(f.service.ice().turnUrls,/turns:turn.example.com:5349/);
  assert.match(fs.readFileSync(path.join(f.root,'runtime','turnserver.conf'),'utf8'),/pkey=\/runtime\/tls\/privkey.pem/);
  f.service.configure({siteUrl:'https://new.example.com',turnHost:'other.example.com'});
  assert.equal(f.service.config().turnTlsEnabled,false);
  assert.doesNotMatch(f.service.ice().turnUrls,/turns:/);
  assert.equal(f.service.removeTls().turnTlsEnabled,false);
 }finally{f.close();}
});

test('certificate source can be set from the backend without uploading a private key',()=>{
 const f=fixture();
 try{
  f.service.configure({siteUrl:'https://car.example.com',turnHost:'turn.example.com'});
  assert.equal(f.service.setCertSource({mode:'auto'}).mode,'auto');
  const src=JSON.parse(fs.readFileSync(path.join(f.root,'runtime','cert-source.json'),'utf8'));
  assert.equal(src.turnHost,'turn.example.com');
  assert.equal(src.mode,'auto');
  assert.equal(f.service.setCertSource({mode:'directory',directory:'/www/sites/car/ssl'}).mode,'directory');
  assert.equal(f.service.config().certificateDirectory,'/www/sites/car/ssl');
  assert.throws(()=>f.service.setCertSource({mode:'directory',directory:'../../etc/ssl'}));
  assert.throws(()=>f.service.setCertSource({mode:'directory',directory:'/www/ssl\naccess=1'}));
 }finally{f.close();}
});
test('first-login wizard cannot complete without required website/Firebase/TURN health',async()=>{
 const f=fixture();
 try{
  const state=await f.service.verify();
  assert.equal(state.ready,false);
  assert.ok(state.checks.find(x=>x.key==='firebase'&&!x.ok));
  await assert.rejects(()=>f.service.complete(),/必需项尚未通过/);
  assert.equal(f.service.config().setupComplete,false);
  const state2=f.service.configure({siteUrl:'https://car.example.com',turnHost:'8.8.8.8'});
  assert.equal(state2.turnHost,'8.8.8.8');
  assert.equal(f.service.ice().stunUrls,'stun:8.8.8.8:3478');
 }finally{f.close();}
});

test('completed onboarding becomes editable configuration rather than first-run wizard again',()=>{
 const f=fixture();
 try{
  f.service.configure({siteUrl:'https://first.example.com',turnHost:'turn.first.example.com'});
  f.saved.set('setup_completed','1');
  f.saved.set('setup_verified_host','8.8.8.8');
  assert.equal(f.service.config().onboardingFinished,true);
  assert.equal(f.service.config().setupComplete,true);
  // Editing a site/domain invalidates current-host readiness, but not the
  // persistent "finished once" marker used to show ordinary settings.
  f.service.configure({siteUrl:'https://second.example.com',turnHost:'turn.second.example.com'});
  const updated=f.service.config();
  assert.equal(updated.setupComplete,false);
  assert.equal(updated.onboardingFinished,true);
  assert.equal(updated.publicUrl,'https://second.example.com');
  assert.equal(updated.turnHost,'turn.second.example.com');
  assert.equal(f.saved.get('setup_finished_once'),'1');
 }finally{f.close();}
});
