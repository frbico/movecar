import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

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
  const sourceFile=path.join(runtimeDir,'cert-source.json');
  const certStatusFile=path.join(runtimeDir,'cert-sync-status.json');
  const healthFile=path.join(runtimeDir,'host-health-status.json');
  const firewallFile=path.join(runtimeDir,'firewall-status.json');
  const safeJson=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
  const sourceMode=()=>safeJson(sourceFile)?.mode||'none';
  function writeCertSource(mode,directory=''){
    const turnHost=hostname(setting('turn_host'));
    atomicFile(sourceFile,JSON.stringify({mode,directory,turnHost}),0o600);
  }
  function setCertSource({mode,directory}){
    if(!['auto','directory','upload'].includes(mode))throw err('证书来源方式无效');
    if(mode==='directory'&&(typeof directory!=='string'||!directory.startsWith('/')||
      directory.length>1024||[...directory].some(ch=>ch.charCodeAt(0)<32)))
      throw err('请输入服务器上的绝对证书目录，不能填写文件内容');
    writeCertSource(mode,mode==='directory'?directory.trim():'');
    return {ok:true,mode,manualUpload:mode==='upload',message:mode==='upload'?'请从浏览器上传 PEM 文件':'正在由宿主机安全检查证书目录，请稍后刷新状态'};
  }
  const firebaseExists=()=>fs.existsSync(firebaseFile)&&fs.statSync(firebaseFile).size>0;
  const configured=()=>fs.existsSync(certFile)&&fs.existsSync(keyFile);
  function tlsValidFor(host){
    if(!host||!configured())return false;
    try {const c=new crypto.X509Certificate(fs.readFileSync(certFile));return !!(net.isIP(host)?c.checkIP(host):c.checkHost(host))&&Date.parse(c.validTo)>Date.now()+86400000;}catch{return false;}
  }
  function refreshTurn(){
    // No externally supplied config lines, paths or arbitrary shell commands.
    const tls=configured()&&tlsValidFor(setting('turn_host'));
    const lines=[
      'fingerprint','use-auth-secret','static-auth-secret='+turnSecret,
      'realm=movecar','server-name=movecar','listening-port=3478','tls-listening-port=5349',
      'min-port=49160','max-port=49191','no-cli','no-loopback-peers','no-multicast-peers',
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
    if(turnSecret)refreshTurn();
    const host=hostname(setting('turn_host'));
    const tls=tlsValidFor(host);
    return {
      publicUrl:setting('public_url'),turnHost:host,
      setupComplete:setting('setup_completed')==='1'&&setting('setup_verified_host')===externalIp,
      certificateSource:sourceMode(),certificateDirectory:safeJson(sourceFile)?.directory||'',
      certificateCheck:safeJson(certStatusFile),firewall:safeJson(firewallFile),turnHealth:safeJson(healthFile),
      firebaseConfigured:firebaseExists(),turnEnabled:!!host,
      turnTlsEnabled:tls,turnUdpPort:3478,turnTlsPort:5349,
      proxyTargets:['http://127.0.0.1:8888','http://movecar:8888'],
      websiteProxyRequired:true,
      nextSteps:!host?['在 DNS 中为 TURN 域名添加直连 A 记录','在后台填写 TURN 域名']:
        ['确认域名已指向服务器公网 IP','开放 3478 UDP/TCP、49160-49191 UDP、5349 TCP（若启用 TLS）']
    };
  }
  function ice(){
    if(turnSecret)refreshTurn();
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
    if(setting('public_url')!==url.origin||setting('turn_host')!==host)save('setup_completed','0');
    save('public_url',url.origin);save('turn_host',host);
    const source=safeJson(sourceFile);
    // Health probe must run even when TLS is deliberately skipped.
    writeCertSource(source?.mode||'none',source?.directory||'');
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
    if(!(net.isIP(host)?c.checkIP(host):c.checkHost(host)))throw err('证书不包含当前 TURN 域名/IP（请检查泛域名证书覆盖范围）');
    const certPublic=c.publicKey.export({type:'spki',format:'der'});
    const keyPublic=crypto.createPublicKey(k).export({type:'spki',format:'der'});
    if(!certPublic.equals(keyPublic))throw err('证书与私钥不匹配');
    const expiry=Date.parse(c.validTo);
    if(!Number.isFinite(expiry)||expiry<Date.now()+86400000)throw err('证书已过期或即将在 24 小时内过期');
    atomicFile(certFile,cert,0o600);
    atomicFile(keyFile,key,0o600);
    writeCertSource('upload');
    refreshTurn();
    return {ok:true,turnTlsEnabled:true,expiresAt:c.validTo};
  }
  function removeTls(){
    for(const p of [certFile,keyFile])try{fs.unlinkSync(p);}catch(e){if(e.code!=='ENOENT')throw e;}
    writeCertSource('upload');
    refreshTurn();return {ok:true,turnTlsEnabled:false};
  }
  async function verify(){
    const c=config();
    const checks=[];
    const add=(key,label,ok,message,required=true)=>checks.push({key,label,ok:!!ok,message,required});
    add('url','HTTPS 网站地址',!!c.publicUrl,'先在上一步填写网站 HTTPS 地址');
    add('turnHost','TURN 地址',c.turnEnabled,'先填写 TURN 域名');
    add('firebase','Firebase 服务账号',c.firebaseConfigured,'通过后台上传 Firebase Admin SDK JSON');
    if(c.turnEnabled){
      try{
        const addresses=net.isIP(c.turnHost)?[c.turnHost]:await dns.resolve4(c.turnHost);
        const publicIp=externalIp.split('/')[0];
        const match=publicIp?addresses.includes(publicIp):addresses.length>0;
        add('dns','TURN DNS 解析',match,match?'TURN DNS 已解析到服务器':'TURN DNS 未指向本服务器公网 IPv4');
      }catch{add('dns','TURN DNS 解析',false,'TURN 域名解析失败或尚未生效');}
    }
    if(c.publicUrl){
      try{
        const response=await fetch(c.publicUrl+'/healthz',{signal:AbortSignal.timeout(6500),redirect:'error'});
        add('https','网站公网 HTTPS',response.ok&&(await response.text()).trim()==='ok',
          '检查域名解析、反向代理和网站 HTTPS 是否已生效');
      }catch{add('https','网站公网 HTTPS',false,'服务器暂时无法经 HTTPS 访问站点 /healthz（部分 VPS 可能不支持公网回环）');}
    }
    const health=c.turnHealth;
    const live=health&&health.turnHost===c.turnHost&&Date.now()-health.checkedAt<180000;
    add('turn','本机 TURN 鉴权分配',live&&health.ok,health?.message||'后台检测进程尚未完成，请检查安装程序或刷新');
    const fw=c.firewall;
    add('firewall','主机防火墙',fw?.automatic!==false,fw?.message||'未检测到主机防火墙状态；云厂商端口仍需手动放行',false);
    add('tls','TURN TLS 备用通道',c.turnTlsEnabled,
      '推荐复用现有网站的泛域名证书，以提高受限网络的接通机会',false);
    const pass=checks.filter(item=>item.required).every(item=>item.ok);
    return {ready:pass,checks,config:c,externalCloudFirewallVerified:false};
  }
  async function complete(){
    const report=await verify();
    if(!report.ready)throw err('必需项尚未通过检查，暂时不能完成首次部署');
    save('setup_verified_host',externalIp);
    save('setup_completed','1');
    return {ok:true,setupComplete:true};
  }
  if(turnSecret)refreshTurn();
  if(setting('turn_host')&&!fs.existsSync(sourceFile))writeCertSource('none');
  return {config,configure,ice,saveFirebase,saveTls,removeTls,refreshTurn,setCertSource,verify,complete};
}
