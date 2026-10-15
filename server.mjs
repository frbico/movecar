/** MoveCar Docker adapter: original upstream Worker + SQLite + secure web administration. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const port = Number(process.env.PORT || 8888);
const dbPath = path.resolve(process.env.DB_PATH || './data/state.sqlite');
const sourcePath = path.resolve(process.env.SOURCE_PATH || './upstream/movecar.js');
const dataDir = path.dirname(dbPath);
const isTest = process.env.NODE_ENV === 'test';
const allowTestHttp = isTest && process.env.MOVECAR_TEST_HTTP_PUSH === '1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid port');
if (!fs.existsSync(sourcePath)) throw Error('Upstream Worker missing. Run bash scripts/fetch-upstream.sh');
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, expiry INTEGER);
 CREATE TABLE IF NOT EXISTS rate_limit (key TEXT PRIMARY KEY, until INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS admin_sessions (digest TEXT PRIMARY KEY, csrf TEXT NOT NULL, expiry INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS admin_sessions_exp ON admin_sessions(expiry);
 CREATE TABLE IF NOT EXISTS owner_sessions (digest TEXT PRIMARY KEY, expiry INTEGER NOT NULL);`);
const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key=?');
const putSettingStmt = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
const delSettingStmt = db.prepare('DELETE FROM settings WHERE key=?');
const kvGet = db.prepare('SELECT value FROM kv WHERE key=? AND (expiry IS NULL OR expiry>?)');
const kvPut = db.prepare('INSERT INTO kv(key,value,expiry) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expiry=excluded.expiry');
const rateGet = db.prepare('SELECT until FROM rate_limit WHERE key=?');
const ratePut = db.prepare('INSERT INTO rate_limit(key,until) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET until=excluded.until');
const sessionPut = db.prepare('INSERT INTO admin_sessions(digest,csrf,expiry) VALUES(?,?,?)');
const sessionGet = db.prepare('SELECT csrf,expiry FROM admin_sessions WHERE digest=? AND expiry>?');
const ownerSessionPut = db.prepare('INSERT INTO owner_sessions(digest,expiry) VALUES(?,?)');
const ownerSessionGet = db.prepare('SELECT expiry FROM owner_sessions WHERE digest=? AND expiry>?');
const setting = (name, fallback = '') => getSettingStmt.get(name)?.value ?? fallback;
const save = (name, value) => putSettingStmt.run(name, String(value));
const random = () => crypto.randomBytes(32).toString('base64url');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const initialFile = path.join(dataDir, 'admin-initial-password');
if (!setting('admin_hash')) {
  const password = random();
  const salt = crypto.randomBytes(16).toString('hex');
  const digest = crypto.scryptSync(password, salt, 64).toString('hex');
  save('admin_salt', salt);
  save('admin_hash', digest);
  fs.writeFileSync(initialFile, `${password}\n`, { flag: 'wx', mode: 0o600 });
  console.log('Admin password generated. Retrieve via ./show-admin-password.sh on the host.');
}
if (!setting('owner_signing_key')) save('owner_signing_key', random());
// Keep existing .env installs' PUBLIC_URL/PHONE_NUMBER only if explicit; never require them.
if (process.env.PUBLIC_URL && !getSettingStmt.get('public_url')) save('public_url', process.env.PUBLIC_URL);
if (process.env.PHONE_NUMBER && !getSettingStmt.get('phone_number')) save('phone_number', process.env.PHONE_NUMBER);

function validateOrigin(value) {
  if (!value) return '';
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== '/' || u.origin === 'null') throw Error('地址只能填写 http(s)://域名[:端口]，不允许路径');
  return u.origin;
}
function validateBark(value) {
  if (!value) return '';
  const u = new URL(value);
  if (u.protocol !== 'https:' && !(allowTestHttp && u.protocol === 'http:')) throw Error('Bark 地址必须使用 HTTPS');
  if (u.username || u.password || u.search || u.hash || u.pathname === '/' || !u.hostname) throw Error('Bark 地址无效');
  return u.toString().replace(/\/+$/, '');
}
function validateSendKey(key) {
  if (!key) return '';
  if (!/^SCT[A-Za-z0-9_-]{8,160}$/.test(key)) throw Error('请填写 Server酱 Turbo SendKey（SCT 开头）');
  return key;
}
function cookie(name, token, origin, maxAge = 3600) {
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${origin.startsWith('https:') ? '; Secure' : ''}`;
}
function parseCookies(str = '') {
  const ret = {};
  for (const p of str.split(';')) { const n = p.indexOf('='); if (n > 0) ret[p.slice(0,n).trim()] = p.slice(n+1).trim(); }
  return ret;
}
const constantEq = (a,b) => { const x=Buffer.from(String(a)), y=Buffer.from(String(b)); return x.length===y.length && crypto.timingSafeEqual(x,y); };
const sessions = req => parseCookies(req.headers.cookie);
function reply(res, status, body, headers={}) {
  res.writeHead(status, { 'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',...headers });
  res.end(body);
}
function json(res,status,obj,headers={}) { return reply(res,status,JSON.stringify(obj),{'Content-Type':'application/json; charset=utf-8',...headers}); }
async function inputJson(req) {
  let total = 0; const arr=[];
  for await(const chunk of req) { total+=chunk.length; if(total>16384) throw Object.assign(Error('请求过大'),{status:413}); arr.push(chunk); }
  try { const obj=JSON.parse(Buffer.concat(arr).toString('utf8')); if(!obj || typeof obj!=='object'||Array.isArray(obj)) throw Error(); return obj; }
  catch { throw Object.assign(Error('JSON 数据无效'),{status:400}); }
}
function requestHostOrigin(req) {
  const host=req.headers.host;
  if (!host || host.length>255 || !/^(?:\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+)(?::\d{1,5})?$/.test(host)) throw Object.assign(Error('Host 无效'),{status:400});
  return new URL('http://' + host).origin;
}
function requestOrigin(req) {
  // Public URL controls notification links, never the admin login origin.
  const configured=setting('public_url');
  return configured ? validateOrigin(configured) : requestHostOrigin(req);
}
function trustedAdminOrigin(req) {
  // Preserve CSRF security while allowing HTTPS reverse proxies that pass through Host.
  // Never trust arbitrary X-Forwarded-* headers.
  const site=req.headers['sec-fetch-site'];
  if (site==='cross-site'||site==='same-site') return null;
  const localOrigin=requestHostOrigin(req);
  const raw=req.headers.origin;
  if (!raw) return localOrigin; // non-browser CLI calls; writes still need the CSRF token
  let candidate;
  try { candidate=validateOrigin(raw); } catch { return null; }
  const sameHost=new URL(candidate).host.toLowerCase()===new URL(localOrigin).host.toLowerCase();
  const publicUrl=setting('public_url');
  if(sameHost||(publicUrl&&candidate===publicUrl)) return candidate;
  return null;
}
function checkCsrf(req,csrf) {
  return trustedAdminOrigin(req)!==null && constantEq(req.headers['x-csrf-token']||'',csrf);
}
function session(req) {
  const token=sessions(req).movecar_admin;
  if (!token || token.length>150) return null;
  return sessionGet.get(hash(token),Date.now())||null;
}
function signedOwnerLink(origin) {
  const exp=Math.floor(Date.now()/1000)+3600;
  const sig=crypto.createHmac('sha256',setting('owner_signing_key')).update(`owner:${exp}`).digest('hex');
  return `${origin}/owner-confirm?expires=${exp}&sig=${sig}`;
}
function verifyOwnerLink(url) {
  const exp=Number(url.searchParams.get('expires'));
  const sig=url.searchParams.get('sig')||'';
  if(!Number.isSafeInteger(exp) || exp<Math.floor(Date.now()/1000) || exp>Math.floor(Date.now()/1000)+3700) return false;
  const expected=crypto.createHmac('sha256',setting('owner_signing_key')).update(`owner:${exp}`).digest('hex');
  return constantEq(sig,expected);
}
function isOwner(req) {
  const token=sessions(req).movecar_owner;
  return token && ownerSessionGet.get(hash(token),Date.now());
}
async function outbound(url,options) {
  const r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!r.ok) throw Error(`推送服务 HTTP ${r.status}`);
  return r;
}
async function sendBark(barkUrl,title,message,ownerUrl,query='') {
  const original=new URL(barkUrl+'/');
  original.pathname += `${encodeURIComponent(title)}/${encodeURIComponent(message)}`;
  const params=new URLSearchParams(query);
  params.set('url',ownerUrl);
  original.search=params.toString();
  await outbound(original.toString());
}
async function sendWeChat(key,title,message,ownerUrl) {
  const endpoint=`https://sctapi.ftqq.com/${key}.send`;
  const body=new URLSearchParams({title,desp:`${message}\n\n[车主点击确认挪车](${ownerUrl})`});
  const url=(isTest && process.env.MOVECAR_TEST_WECHAT_ENDPOINT) || endpoint;
  const r=await outbound(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  const result=await r.json().catch(()=>({}));
  if(result.code!==0) throw Error('微信推送服务返回失败，请检查 SendKey 和剩余额度');
}
async function notifyChannels({title,message,ownerUrl,query=''}) {
  const tasks=[];
  const bark=setting('bark_url'), key=setting('serverchan_sendkey');
  if(bark) tasks.push(sendBark(bark,title,message,ownerUrl,query));
  if(key) tasks.push(sendWeChat(key,title,message,ownerUrl));
  if(!tasks.length) throw Object.assign(Error('尚未配置 Bark 或微信推送，请先进入 /admin 设置'),{status:503});
  const outcomes=await Promise.allSettled(tasks);
  if(!outcomes.some(r=>r.status==='fulfilled')) {
    console.error('All configured push channels failed (credentials hidden).');
    throw Object.assign(Error('推送失败，请管理员在后台测试推送渠道'),{status:502});
  }
  if(outcomes.some(r=>r.status==='rejected')) console.warn('One push channel failed; another succeeded.');
}
const MOVE_CAR_STATUS = {
  async get(key) { return kvGet.get(String(key),Date.now())?.value ?? null; },
  async put(key,value,opts={}) { let expiry=null; if(opts.expirationTtl != null){ const ttl=Number(opts.expirationTtl); if(!Number.isFinite(ttl)||ttl<=0) throw Error('TTL invalid'); expiry=Date.now()+ttl*1000; } kvPut.run(String(key),String(value),expiry); }
};
const WORKER_BARK='https://movecar-notify.invalid/bark';
let listener;
const globals={
  addEventListener(type,fn) { if(type!=='fetch'||typeof fn!=='function') throw Error('Unknown Worker event'); listener=fn; },
  MOVE_CAR_STATUS,BARK_URL:WORKER_BARK,Request,Response,Headers,URL,URLSearchParams,setTimeout,clearTimeout,console,
  fetch:async function workerPush(input) {
    const u=new URL(String(input));
    const base=new URL(WORKER_BARK);
    if(u.origin!==base.origin || !u.pathname.startsWith(base.pathname+'/')) throw Error('Unexpected upstream external request');
    const parts=u.pathname.slice(base.pathname.length+1).split('/').map(decodeURIComponent);
    const title=parts[0]||'挪车提醒';const message=parts.slice(1).join('/')||'请及时挪车';
    const linked=u.searchParams.get('url');
    if(!linked) throw Error('Missing confirmation URL');
    const target=new URL(linked);
    if(target.pathname!=='/owner-confirm') throw Error('Invalid confirmation URL');
    await notifyChannels({title,message,ownerUrl:signedOwnerLink(target.origin),query:u.search});
    return new Response(JSON.stringify({success:true}),{status:200});
  }
};
Object.defineProperty(globals,'PHONE_NUMBER',{get:()=>setting('phone_number')});
vm.runInNewContext(fs.readFileSync(sourcePath,'utf8'),globals,{filename:'upstream/movecar.js',timeout:2500});
if (!listener) throw Error('Upstream Worker registration missing');
function invokeWorker(request) { let result; listener({request,respondWith(p){result=Promise.resolve(p);}}); if(!result)throw Error('Upstream Worker returned no response'); return result; }
async function sendWorker(response,res,head=false){
  const headers=Object.fromEntries(response.headers);
  headers['cache-control']='no-store'; headers['x-content-type-options']='nosniff';headers['referrer-policy']='no-referrer';headers['x-frame-options']='DENY';
  if(headers['content-type']?.includes('text/html')) headers['content-security-policy']="frame-ancestors 'none'";
  const payload=head?null:Buffer.from(await response.arrayBuffer());res.writeHead(response.status,headers);res.end(payload);
}
function staticFile(res,name,type) {
  const txt=fs.readFileSync(path.join(import.meta.dirname,name));
  reply(res,200,txt,{'Content-Type':type,'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});
}
const failStats=new Map();
setInterval(()=>{
 const now=Date.now();db.prepare('DELETE FROM kv WHERE expiry IS NOT NULL AND expiry<=?').run(now);
 db.prepare('DELETE FROM rate_limit WHERE until<=?').run(now);
 db.prepare('DELETE FROM admin_sessions WHERE expiry<=?').run(now);
 db.prepare('DELETE FROM owner_sessions WHERE expiry<=?').run(now);
 for (const [ip,item] of failStats) if(item.until<now)failStats.delete(ip);
},3600000).unref();
const server=http.createServer(async(req,res)=>{
  try {
    const origin=requestOrigin(req);
    const u=new URL(req.url||'/',origin);
    const route=u.pathname;
    if(!['GET','HEAD','POST','PUT'].includes(req.method))return reply(res,405,'Method not allowed');
    if(route==='/healthz')return reply(res,200,'ok');
    if(route==='/admin'||route==='/admin/')return req.method==='GET'?staticFile(res,'admin.html','text/html; charset=utf-8'):reply(res,405,'Method not allowed');
    if(route==='/admin.js')return req.method==='GET'?staticFile(res,'admin.js','text/javascript; charset=utf-8'):reply(res,405,'Method not allowed');
    if(route==='/admin.css')return req.method==='GET'?staticFile(res,'admin.css','text/css; charset=utf-8'):reply(res,405,'Method not allowed');
    if(route.startsWith('/api/admin/')){
      if(route==='/api/admin/login'&&req.method==='POST'){
        const loginOrigin=trustedAdminOrigin(req);
        if (!loginOrigin) return json(res,403,{error:'来源不可信：请通过当前访问地址打开后台，检查代理是否保留 Host 头'});
        const ip=req.socket.remoteAddress||'unknown';const stat=failStats.get(ip)||{fails:0,until:0};
        if(stat.until>Date.now())return json(res,429,{error:'尝试次数过多，请 15 分钟后重试'});
        const data=await inputJson(req);const password=data.password;
        if(typeof password!=='string'||password.length>200)return json(res,400,{error:'密码格式错误'});
        const supplied=crypto.scryptSync(password,setting('admin_salt'),64).toString('hex');
        if(!constantEq(supplied,setting('admin_hash'))){
          stat.fails++;if(stat.fails>=5)stat.until=Date.now()+15*60*1000;failStats.set(ip,stat);
          return json(res,401,{error:'密码错误'});
        }
        failStats.delete(ip);
        const token=random(), csrf=random();sessionPut.run(hash(token),csrf,Date.now()+86400000);
        return json(res,200,{ok:true},{'Set-Cookie':cookie('movecar_admin',token,loginOrigin,86400)});
      }
      const auth=session(req);
      if(!auth)return json(res,401,{error:'请先登录'});
      if(route==='/api/admin/session'&&req.method==='GET')return json(res,200,{csrf:auth.csrf});
      if(route==='/api/admin/config'&&req.method==='GET')return json(res,200,{publicUrl:setting('public_url'),phoneNumber:setting('phone_number'),rateLimitSeconds:Number(setting('rate_limit_seconds','60')),barkConfigured:!!setting('bark_url'),serverchanConfigured:!!setting('serverchan_sendkey')});
      if(!['POST','PUT'].includes(req.method)||!checkCsrf(req,auth.csrf))return json(res,403,{error:'请求未通过验证'});
      if(route==='/api/admin/logout'){
        const tok=sessions(req).movecar_admin;db.prepare('DELETE FROM admin_sessions WHERE digest=?').run(hash(tok));
        return json(res,200,{ok:true},{'Set-Cookie':cookie('movecar_admin','',trustedAdminOrigin(req)||origin,0)});
      }
      if(route==='/api/admin/settings' && req.method==='POST') {
        const data=await inputJson(req);
        if(typeof data.publicUrl!=='string'||data.publicUrl.length>300)throw Object.assign(Error('访问地址无效'),{status:400});
        if(typeof data.phoneNumber!=='string'||data.phoneNumber.length>35)throw Object.assign(Error('电话号码无效'),{status:400});
        if(!Number.isInteger(data.rateLimitSeconds)||data.rateLimitSeconds<0||data.rateLimitSeconds>3600)throw Object.assign(Error('限流范围须在 0-3600 秒'),{status:400});
        let publicUrl;
        try { publicUrl=validateOrigin(data.publicUrl.trim()); } catch { throw Object.assign(Error('公网地址格式不正确'),{status:400}); }
        let bark=null,key=null;
        if(data.barkUrl){if(typeof data.barkUrl!=='string'||data.barkUrl.length>500)throw Object.assign(Error('Bark URL 不合法'),{status:400});try { bark=validateBark(data.barkUrl.trim()); } catch { throw Object.assign(Error('Bark 地址不正确（须使用 HTTPS）'),{status:400}); }}
        if(data.serverchanSendKey){if(typeof data.serverchanSendKey!=='string'||data.serverchanSendKey.length>200)throw Object.assign(Error('SendKey 不合法'),{status:400});try { key=validateSendKey(data.serverchanSendKey.trim()); } catch { throw Object.assign(Error('请填写 SCT 开头的 Server酱 Turbo SendKey'),{status:400}); }}
        save('public_url',publicUrl);save('phone_number',data.phoneNumber.trim());save('rate_limit_seconds',data.rateLimitSeconds);
        if(bark)save('bark_url',bark);else if(data.clearBark===true)delSettingStmt.run('bark_url');
        if(key)save('serverchan_sendkey',key);else if(data.clearServerchan===true)delSettingStmt.run('serverchan_sendkey');
        return json(res,200,{ok:true});
      }
      if(route==='/api/admin/test-push'&&req.method==='POST'){
        await inputJson(req);
        await notifyChannels({title:'MoveCar 测试通知',message:'后台推送渠道测试成功 ✅',ownerUrl:signedOwnerLink(origin)});
        return json(res,200,{ok:true,message:'测试推送已提交'});
      }
      if(route==='/api/admin/password'&&req.method==='POST'){
        const data=await inputJson(req);
        if(typeof data.currentPassword!=='string'||typeof data.newPassword!=='string'||data.newPassword.length<12||data.newPassword.length>128)throw Object.assign(Error('新密码至少 12 位，最多 128 位'),{status:400});
        const actual=crypto.scryptSync(data.currentPassword,setting('admin_salt'),64).toString('hex');
        if(!constantEq(actual,setting('admin_hash')))return json(res,403,{error:'原密码错误'});
        const salt=crypto.randomBytes(16).toString('hex');save('admin_salt',salt);save('admin_hash',crypto.scryptSync(data.newPassword,salt,64).toString('hex'));
        db.exec('DELETE FROM admin_sessions');
        try{fs.unlinkSync(initialFile);}catch(e){if(e.code!=='ENOENT')console.warn('Could not remove bootstrap password file');}
        return json(res,200,{ok:true,message:'密码修改成功，请重新登录'},{'Set-Cookie':cookie('movecar_admin','',trustedAdminOrigin(req)||origin,0)});
      }
      return json(res,404,{error:'接口不存在'});
    }
    const hasOwner=!!isOwner(req);
    if(route==='/owner-confirm'&&!hasOwner){
      if(!verifyOwnerLink(u))return reply(res,403,'车主确认链接无效或已过期，请重新发起挪车通知。');
      const tok=random();ownerSessionPut.run(hash(tok),Date.now()+3600000);
      res.writeHead(303,{'Location':'/owner-confirm','Set-Cookie':cookie('movecar_owner',tok,origin),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});return res.end();
    }
    if((route==='/api/get-location'||route==='/api/owner-confirm')&&!hasOwner)return reply(res,403,'车主认证失败');
    const methods={'/api/notify':'POST','/api/get-location':'GET','/api/owner-confirm':'POST','/api/check-status':'GET','/owner-confirm':'GET'};
    if(methods[route] && req.method!==methods[route])return reply(res,405,'Method not allowed');
    if(route==='/api/notify'){
      if(!setting('bark_url')&&!setting('serverchan_sendkey'))return json(res,503,{error:'车主尚未配置消息推送，请联系车主'});
      const key=req.socket.remoteAddress||'unknown',now=Date.now(),window=Number(setting('rate_limit_seconds','60'));
      if(window>0&&(rateGet.get(key)?.until??0)>now)return reply(res,429,'通知太频繁，请稍后再试',{'Retry-After':String(window)});
      const data=await inputJson(req);
      if(typeof data.message!=='string'||data.message.length>200) return reply(res,400,'留言长度须在 200 字以内');
      if(data.location!=null && (typeof data.location!=='object'||!Number.isFinite(data.location.lat)||!Number.isFinite(data.location.lng)||Math.abs(data.location.lat)>90||Math.abs(data.location.lng)>180))return reply(res,400,'位置数据无效');
      if(window>0)ratePut.run(key,now+window*1000);
      const request=new Request(new URL(route+u.search,origin),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:data.message,location:data.location||null,delayed:!data.location})});
      return sendWorker(await invokeWorker(request),res);
    }
    const bytes=req.method==='POST'?Buffer.from(JSON.stringify(await inputJson(req))):undefined;
    const reqWorker=new Request(new URL(route+u.search,origin),{method:req.method==='HEAD'?'GET':req.method,...(bytes?{body:bytes,headers:{'Content-Type':'application/json'}}:{})});
    return sendWorker(await invokeWorker(reqWorker),res,req.method==='HEAD');
  } catch(err) {
    const status=err.status||500;
    if(status>=500)console.error('Request failed:',err.message?.replace(/SCT[A-Za-z0-9_-]+/g,'[redacted]'));
    if(!res.headersSent) return (req.url||'').startsWith('/api/admin/')|| (req.url||'')==='/api/admin/config' ? json(res,status,{error:status===500?'内部错误':err.message}) : reply(res,status,status===500?'服务暂时不可用':err.message);
    res.end();
  }
});
server.requestTimeout=75000;
server.listen(port,'0.0.0.0',()=>console.log(`MoveCar listening on 0.0.0.0:${port} (admin /admin)`));
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0);}));
