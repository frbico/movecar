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
