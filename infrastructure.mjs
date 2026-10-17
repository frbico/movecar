import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Configuration lives in the authenticated admin console, not an installer.
// TURN is a private server-side service; the browser only receives short-lived
// REST credentials, never the long-term shared key.
const err=(m)=>Object.assign(new Error(m),{status:400});
const hostname=(value)=>{
  const s=String(value||'').trim().toLowerCase();
  if(s && (s.length>253||!s.includes('.')||!s.split('.').every(x=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x))))
    throw err('TURN 地址只能填写域名，不包含 https://、端口或路径');
  return s;
};
function atomicFile(file,contents,mode=0o600){
  const tmp=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
  try{fs.writeFileSync(tmp,contents,{mode,flag:'wx'});fs.renameSync(tmp,file);}
  finally{try{fs.unlinkSync(tmp);}catch{}}
}
export function createInfrastructure({setting,save,dataDir,turnSecret=process.env.VOICE_TURN_SHARED_SECRET||'',
  externalIp=process.env.TURN_EXTERNAL_IP||'',runtimeDir=process.env.MOVECAR_RUNTIME_DIR||path.join(dataDir,'turn-runtime'),
  firebaseFile=process.env.FCM_SERVICE_ACCOUNT||path.join(dataDir,'firebase-service-account.json')}){
  fs.mkdirSync(runtimeDir,{recursive:true,mode:0o700});
  const tlsDir=path.join(runtimeDir,'tls');
  fs.mkdirSync(tlsDir,{recursive:true,mode:0o700});
  const certFile=path.join(tlsDir,'fullchain.pem'),keyFile=path.join(tlsDir,'privkey.pem');
  const conf=path.join(runtimeDir,'turnserver.conf');
  const firebaseExists=()=>fs.existsSync(firebaseFile)&&fs.statSync(firebaseFile).size>0;
  const configured=()=>fs.existsSync(certFile)&&fs.existsSync(keyFile);
  function tlsValidFor(host){
    if(!host||!configured())return false;
    try {const c=new crypto.X509Certificate(fs.readFileSync(certFile));return !!c.checkHost(host)&&Date.parse(c.validTo)>Date.now()+86400000;}catch{return false;}
  }
  function refreshTurn(){
    // No externally supplied config lines, paths or arbitrary shell commands.
    const tls=configured()&&tlsValidFor(setting('turn_host'));
    const lines=[
      'fingerprint','use-auth-secret','static-auth-secret='+turnSecret,
      'realm=movecar','server-name=movecar','listening-port=3478','tls-listening-port=5349',
      'min-port=49160','max-port=49260','no-cli','no-loopback-peers','no-multicast-peers',
      'stale-nonce=600','user-quota=12','total-quota=100',
      'denied-peer-ip=10.0.0.0-10.255.255.255',
      'denied-peer-ip=172.16.0.0-172.31.255.255',
      'denied-peer-ip=192.168.0.0-192.168.255.255',
      'denied-peer-ip=169.254.0.0-169.254.255.255',
      'denied-peer-ip=127.0.0.0-127.255.255.255',
      ...(externalIp?['external-ip='+externalIp]:[]),
      ...(tls?['cert=/runtime/tls/fullchain.pem','pkey=/runtime/tls/privkey.pem','no-dtls','no-tlsv1','no-tlsv1_1']:
        ['no-tls','no-dtls'])
    ];
    if(!turnSecret) return false;
    if(!/^[a-f0-9]{64}$/.test(turnSecret))throw new Error('Invalid server-generated TURN secret');
    if(externalIp&&!/^(?:\d{1,3}\.){3}\d{1,3}(?:\/(?:\d{1,3}\.){3}\d{1,3})?$/.test(externalIp))
      throw new Error('Invalid TURN_EXTERNAL_IP');
    const text=lines.join('\n')+'\n';
    if(!fs.existsSync(conf)||fs.readFileSync(conf,'utf8')!==text)atomicFile(conf,text,0o600);
    return tls;
  }
  function config(){
    const host=hostname(setting('turn_host'));
    const tls=tlsValidFor(host);
    return {
      publicUrl:setting('public_url'),turnHost:host,
      firebaseConfigured:firebaseExists(),turnEnabled:!!host,
      turnTlsEnabled:tls,turnUdpPort:3478,turnTlsPort:5349,
      proxyTargets:['http://127.0.0.1:8888','http://movecar:8888'],
      websiteProxyRequired:true,
      nextSteps:!host?['在 DNS 中为 TURN 域名添加直连 A 记录','在后台填写 TURN 域名']:
        ['确认域名已指向服务器公网 IP','开放 3478 UDP/TCP、49160-49260 UDP、5349 TCP（若启用 TLS）']
    };
  }
  function ice(){
    const host=hostname(setting('turn_host'));
    const tls=tlsValidFor(host);
    if(!host)return null;
    return {
      stunUrls:'stun:'+host+':3478',
      turnUrls:'turn:'+host+':3478?transport=udp,turn:'+host+':3478?transport=tcp'+
        (tls?',turns:'+host+':5349?transport=tcp':'')
    };
  }
  function configure({siteUrl,turnHost}){
    if(typeof siteUrl!=='string'||typeof turnHost!=='string')throw err('请填写正确的网站地址与 TURN 域名');
    let url;
    try{
      url=new URL(siteUrl.trim());
      if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')
        throw Error();
    }catch{throw err('网站必须填写 HTTPS 根地址，例如 https://movecar.example.com');}
    const host=hostname(turnHost);
    if(!host)throw err('请填写 TURN 域名，和网站可以使用同一个 IP');
    save('public_url',url.origin);save('turn_host',host);
    refreshTurn();return config();
  }
  function saveFirebase(content){
    if(typeof content!=='string'||content.length>45000)throw err('Firebase 私钥文件无效或超过 45 KB');
    let obj;
    try{obj=JSON.parse(content);}catch{throw err('Firebase 私钥不是有效 JSON');}
    if(obj.type!=='service_account'||typeof obj.project_id!=='string'||!obj.project_id||
       typeof obj.client_email!=='string'||!obj.client_email.endsWith('.gserviceaccount.com')||
       typeof obj.private_key!=='string'||!obj.private_key.includes('BEGIN PRIVATE KEY'))throw err('请选择 Firebase Admin SDK 的服务账号 JSON，不能使用 google-services.json');
    try{crypto.createPrivateKey(obj.private_key);}catch{throw err('Firebase 服务账号私钥解析失败');}
    atomicFile(firebaseFile,JSON.stringify(obj),0o600);
    return {ok:true,firebaseConfigured:true,projectId:obj.project_id};
  }
  function saveTls(cert,key){
    if(typeof cert!=='string'||typeof key!=='string'||cert.length>38000||key.length>38000)
      throw err('证书或私钥超出允许长度');
    const host=hostname(setting('turn_host'));
    if(!host)throw err('请先保存 TURN 域名');
    let c,k;
    try{c=new crypto.X509Certificate(cert);k=crypto.createPrivateKey(key);}
    catch{throw err('请上传有效 PEM 证书和私钥文件');}
    if(!c.checkHost(host))throw err('证书不包含当前 TURN 域名（请检查泛域名证书覆盖范围）');
    const certPublic=c.publicKey.export({type:'spki',format:'der'});
    const keyPublic=crypto.createPublicKey(k).export({type:'spki',format:'der'});
    if(!certPublic.equals(keyPublic))throw err('证书与私钥不匹配');
    const expiry=Date.parse(c.validTo);
    if(!Number.isFinite(expiry)||expiry<Date.now()+86400000)throw err('证书已过期或即将在 24 小时内过期');
    atomicFile(certFile,cert,0o600);
    atomicFile(keyFile,key,0o600);
    refreshTurn();
    return {ok:true,turnTlsEnabled:true,expiresAt:c.validTo};
  }
  function removeTls(){
    for(const p of [certFile,keyFile])try{fs.unlinkSync(p);}catch(e){if(e.code!=='ENOENT')throw e;}
    refreshTurn();return {ok:true,turnTlsEnabled:false};
  }
  if(turnSecret)refreshTurn();
  return {config,configure,ice,saveFirebase,saveTls,removeTls,refreshTurn};
}
