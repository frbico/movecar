/** MoveCar Docker adapter: original upstream Worker + SQLite + secure web administration. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { createRequestFlow } from './request-flow.mjs';
import { createVoiceService } from './voice-service.mjs';
import { createMobileOwner } from './mobile-owner.mjs';

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
 CREATE TABLE IF NOT EXISTS owner_sessions (digest TEXT PRIMARY KEY, expiry INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS photo_grants (digest TEXT PRIMARY KEY, expiry INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS photo_records (id TEXT PRIMARY KEY, data BLOB NOT NULL, expiry INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS site_icons (id INTEGER PRIMARY KEY CHECK(id=1), data BLOB NOT NULL, mime TEXT NOT NULL, updated_at INTEGER NOT NULL);`);
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
const photoGrantGet = db.prepare('SELECT expiry FROM photo_grants WHERE digest=? AND expiry>?');
const photoGrantPut = db.prepare('INSERT INTO photo_grants(digest,expiry) VALUES(?,?)');
const photoGrantUse = db.prepare('DELETE FROM photo_grants WHERE digest=? AND expiry>?');
const photoPut = db.prepare('INSERT INTO photo_records(id,data,expiry) VALUES(?,?,?)');
if (!db.prepare('PRAGMA table_info(photo_records)').all().some(c=>c.name==='mime')) db.exec("ALTER TABLE photo_records ADD COLUMN mime TEXT NOT NULL DEFAULT 'image/jpeg'");
const photoGet = db.prepare('SELECT data,mime FROM photo_records WHERE id=? AND expiry>?');
const iconGet=db.prepare('SELECT data,mime,updated_at FROM site_icons WHERE id=1');
const iconSave=db.prepare('INSERT INTO site_icons(id,data,mime,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,mime=excluded.mime,updated_at=excluded.updated_at');
const iconClear=db.prepare('DELETE FROM site_icons WHERE id=1');
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
function validateSc3Key(key) {
  if (!key) return '';
  if (typeof key !== 'string' || key.length > 240 || !/^sctp(\d{1,30})t[A-Za-z0-9_-]{6,200}$/.test(key)) {
    throw Error('请填写 Server酱³ SendKey（sctp 开头）');
  }
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
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
async function iconUpload(req,limit=262144){
  if(Number(req.headers['content-length'])>limit)throw Object.assign(Error('网站图标最大 256 KB'),{status:413});
  const parts=[];let bytes=0;
  for await(const part of req){bytes+=part.length;if(bytes>limit)throw Object.assign(Error('网站图标最大 256 KB'),{status:413});parts.push(part);}
  const data=Buffer.concat(parts);
  const head=(a,b)=>data.toString('ascii',a,b);
  let mime='';
  if(data.length>=8 && data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';
  else if(data.length>=4&&data[0]===255&&data[1]===216&&data[2]===255&&data[data.length-2]===255&&data[data.length-1]===217)mime='image/jpeg';
  else if(data.length>=12&&head(0,4)==='RIFF'&&head(8,12)==='WEBP')mime='image/webp';
  else if(data.length>=6&&data[0]===0&&data[1]===0&&data[2]===1&&data[3]===0&&data.readUInt16LE(4)>=1)mime='image/x-icon';
  if(!mime)throw Object.assign(Error('图标仅支持 PNG、JPEG、WebP 或 ICO'),{status:415});
  return {data,mime};
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
  return `${origin}/owner-confirm/${exp}/${sig}`;
}
function verifyOwnerLink(url) {
  const match=url.pathname.match(/^\/owner-confirm\/(\d{10,12})\/([a-f0-9]{64})$/);
  const exp=Number(match?.[1] || url.searchParams.get('expires'));
  const sig=match?.[2] || url.searchParams.get('sig') || '';
  if(!Number.isSafeInteger(exp) || exp<Math.floor(Date.now()/1000) || exp>Math.floor(Date.now()/1000)+3700) return false;
  const expected=crypto.createHmac('sha256',setting('owner_signing_key')).update(`owner:${exp}`).digest('hex');
  return constantEq(sig,expected);
}
function isOwner(req) {
  const token=sessions(req).movecar_owner;
  return token && ownerSessionGet.get(hash(token),Date.now());
}
async function inputPhoto(req,limit=10*1024*1024) {
  let total=0;const chunks=[];
  for await(const chunk of req) {
    total+=chunk.length;
    if(total>limit)throw Object.assign(Error('照片太大，请选择不超过 10 MB 的图片'),{status:413});
    chunks.push(chunk);
  }
  const b=Buffer.concat(chunks);
  if(b.length<32)throw Object.assign(Error('照片内容为空或不完整'),{status:415});
  const four=(from,to)=>b.toString('ascii',from,to);
  let mime='';
  if(b[0]===255&&b[1]===216&&b[2]===255&&b[b.length-2]===255&&b[b.length-1]===217)mime='image/jpeg';
  else if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';
  else if(four(0,4)==='RIFF'&&four(8,12)==='WEBP')mime='image/webp';
  else if(four(4,8)==='ftyp'&&['heic','heix','hevc','hevx','mif1','msf1','heis','heim'].includes(four(8,12)))mime='image/heic';
  if(!mime)throw Object.assign(Error('仅支持 JPEG、PNG、WebP、HEIC/HEIF 原图'),{status:415});
  const claimed=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
  if(claimed!==mime && !(mime==='image/heic'&&claimed==='image/heif'))
    throw Object.assign(Error('图片类型与文件内容不匹配'),{status:415});
  return {bytes:b,mime};
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
async function sendSc3(key,title,message,ownerUrl,richMarkdown=false) {
  const uid = validateSc3Key(key).match(/^sctp(\d+)t/)[1];
  const endpoint = `https://${uid}.push.ft07.com/send/${key}.send`;
  const url = (isTest && process.env.MOVECAR_TEST_SC3_ENDPOINT) || endpoint;
  const normalizedMessage=String(message).split('\\n').join('\n');
  const short = richMarkdown ? '查看留言和确认按钮' : normalizedMessage.replace(/\s+/g,' ').slice(0,80);
  const safeMessage = normalizedMessage.replace(/([\\`*_\[\]<>])/g,'\\$1');
  const body = JSON.stringify({title,short,desp:`${richMarkdown?normalizedMessage:safeMessage}\n\n[车主点击确认挪车](${ownerUrl})`,tags:'挪车'});
  const r = await outbound(url,{method:'POST',headers:{'Content-Type':'application/json'},body});
  const result = await r.json().catch(()=>({}));
  if(result.code!==0) throw Error('Server酱³ 返回失败，请检查 SendKey 和手机注册状态');
}
async function notifyChannels({title,message,ownerUrl,query='',channel='all',richMarkdown=false}) {
  const tasks=[];
  const names=[];
  const wanted = name => (channel==='all' || channel===name) && setting('notify_'+name+'_enabled','1')==='1';
  const bark=setting('bark_url'), turbo=setting('serverchan_sendkey'), sc3=setting('sc3_sendkey');
  if(bark && wanted('bark')) { names.push('bark'); tasks.push(sendBark(bark,title,message,ownerUrl,query)); }
  if(turbo && wanted('serverchan')) { names.push('serverchan'); tasks.push(sendWeChat(turbo,title,message,ownerUrl)); }
  if(sc3 && wanted('sc3')) { names.push('sc3'); tasks.push(sendSc3(sc3,title,message,ownerUrl,richMarkdown)); }
  if(voice.isDeviceReady() && wanted('app')) {names.push('app');tasks.push(voice.notifyOwner({title,message,ownerUrl}));}
  if(!tasks.length) throw Object.assign(Error(channel==='all'?'尚未配置推送渠道，请先进入 /admin 设置':'所选渠道尚未配置，请先保存密钥'),{status:503});
  const results=await Promise.allSettled(tasks);
  const statuses=Object.fromEntries(results.map((item,index)=>[names[index],item.status==='fulfilled'?'ok':'failed']));
  if(!results.some(item=>item.status==='fulfilled')) {
    console.error('All selected push channels failed (credentials hidden).');
    throw Object.assign(Error('所选推送渠道均发送失败，请检查密钥、额度与设备注册状态'),{status:502});
  }
  if(results.some(item=>item.status==='rejected')) console.warn('Some push channels failed; others succeeded (credentials hidden).');
  return statuses;
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
    const title=parts[0]||'挪车提醒';const message=(parts.slice(1).join('/')||'请及时挪车').split('\\n').join('\n');
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
  const isHtml=headers['content-type']?.includes('text/html');
  if(isHtml) headers['content-security-policy']="frame-ancestors 'none'";
  let payload=head?null:Buffer.from(await response.arrayBuffer());
  if(isHtml&&payload){
    let html=payload.toString('utf8');
    if(html.includes('id="successView"')){
      // Remove the original Worker GPS consent modal and location-status panel.
      html=html.replace(/<!-- 页面加载时的位置提示弹窗 -->[\s\S]*?(?=\s*<div class="container" id="mainView">)/,'');
      html=html.replace(/<div class="card loc-card">[\s\S]*?(?=<button id="notifyBtn")/,'');
      const geoStart=html.indexOf('      // 页面加载时显示提示弹窗');
      const geoEnd=html.indexOf('      function addTag(text)',geoStart);
      if(geoStart!==-1&&geoEnd>geoStart)html=html.slice(0,geoStart)+html.slice(geoEnd);
      html=html.replace('正在赶来，点击查看车主位置','正在赶来，请稍候');
      html=html.replace(/<div id="ownerMapLinks" class="map-links"[\s\S]*?<\/div>/,'');
      if(!html.includes('</body>'))throw Error('上游页面缺少 body 结束标签');
      const siteName=escapeHTML(setting('site_name','呼叫车主挪车'));
      html=html.replace('<h1>呼叫车主挪车</h1>',`<h1>${siteName}</h1>`);
      html=html.replace(/<title>[^<]*<\/title>/,`<title>${siteName}</title>`);
      if(iconGet.get()) {
        html=html.replace('<div class="icon-wrap"><span>🚗</span></div>','<div class="icon-wrap"><img src="/site-icon" alt="网站图标" style="width:70px;height:70px;object-fit:contain"></div>');
        html=html.replace('</head>','<link rel="icon" href="/site-icon"></head>');
      }
      html=html.replace('</body>','<script src="/request-ui.js" defer></script><script src="/voice-entry.js" defer></script></body>');
      headers['content-security-policy']="frame-ancestors 'none'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'";
    }else if(html.includes('id="confirmBtn"')){
      // Existing/legacy owner links must not ask the owner for location either.
      const geoStart=html.indexOf('      // 点击确认按钮时，触发浏览器授权');
      const geoEnd=html.indexOf('      // 发送确认',geoStart);
      if(geoStart!==-1&&geoEnd>geoStart){
        html=html.slice(0,geoStart)+"      async function confirmMove() { ownerLocation=null; await doConfirm(); }\n\n"+html.slice(geoEnd);
      }
    }
    payload=Buffer.from(html,'utf8');
  }
  res.writeHead(response.status,headers);res.end(payload);
}
function staticFile(res,name,type) {
  const txt=fs.readFileSync(path.join(import.meta.dirname,name));
  reply(res,200,txt,{'Content-Type':type,'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});
}
const requestFlow=createRequestFlow({db,setting,random,hash,notifyChannels,inputJson,inputPhoto,json,reply,rateGet,ratePut});
const voice=createVoiceService({db,json,reply,inputJson});
const mobile=createMobileOwner({db,setting,save,deleteSetting:name=>delSettingStmt.run(name),inputJson,json,requestFlow,voice,notifyChannels,validateOrigin,validateBark,validateSendKey,validateSc3Key});
const failStats=new Map();
setInterval(()=>{
 const now=Date.now();db.prepare('DELETE FROM kv WHERE expiry IS NOT NULL AND expiry<=?').run(now);
 db.prepare('DELETE FROM rate_limit WHERE until<=?').run(now);
 db.prepare('DELETE FROM admin_sessions WHERE expiry<=?').run(now);
 db.prepare('DELETE FROM owner_sessions WHERE expiry<=?').run(now);
 db.prepare('DELETE FROM photo_grants WHERE expiry<=?').run(now);
 db.prepare('DELETE FROM photo_records WHERE expiry<=?').run(now);
 requestFlow.cleanup();mobile.cleanup();
 for (const [ip,item] of failStats) if(item.until<now)failStats.delete(ip);
},3600000).unref();
const server=http.createServer(async(req,res)=>{
  try {
    const origin=requestOrigin(req);
    const u=new URL(req.url||'/',origin);
    const route=u.pathname;
    if(!['GET','HEAD','POST','PUT'].includes(req.method))return reply(res,405,'Method not allowed');
    if(route==='/healthz')return reply(res,200,'ok');
    if(route==='/site-icon'){
      if(req.method!=='GET')return reply(res,405,'Method not allowed');
      const icon=iconGet.get();
      return icon?reply(res,200,icon.data,{'Content-Type':icon.mime,'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; sandbox"}):reply(res,404,'网站图标尚未设置');
    }
    if(route==='/api/site-config'){
      if(req.method!=='GET')return reply(res,405,'Method not allowed');
      return json(res,200,{wechatId:setting('wechat_id'),siteName:setting('site_name','呼叫车主挪车')});
    }
    if(route==='/admin'||route==='/admin/')return req.method==='GET'?staticFile(res,'admin.html','text/html; charset=utf-8'):reply(res,405,'Method not allowed');
    if(route==='/admin.js')return req.method==='GET'?staticFile(res,'admin.js','text/javascript; charset=utf-8'):reply(res,405,'Method not allowed');
    if(route==='/admin.css')return req.method==='GET'?staticFile(res,'admin.css','text/css; charset=utf-8'):reply(res,405,'Method not allowed');
    if(route==='/photo-ui.js')return req.method==='GET'?staticFile(res,'photo-ui.js','text/javascript; charset=utf-8'):reply(res,405,'Method not allowed');
    if(await mobile.handle(req,res,u))return;
    if(await voice.handle(req,res,u))return;
    if(await requestFlow.handle(req,res,origin,u))return;
    if(route.startsWith('/api/admin/')){
      if(route==='/api/admin/login'&&req.method==='POST'){
        const loginOrigin=trustedAdminOrigin(req);
        if (!loginOrigin) return json(res,403,{error:'来源不可信：请通过当前访问地址打开后台，检查代理是否保留 Host 头'});
        const ip=req.socket.remoteAddress||'unknown';const stat=failStats.get(ip)||{fails:0,until:0};
        if(stat.until>Date.now())return json(res,429,{error:'尝试次数过多，请 15 分钟后重试'});
        const data=await inputJson(req);const password=data.password;
        const account=typeof data.username==='string'?data.username:'admin';
        if(typeof password!=='string'||password.length>200)return json(res,400,{error:'密码格式错误'});
        const supplied=crypto.scryptSync(password,setting('admin_salt'),64).toString('hex');
        if(!constantEq(supplied,setting('admin_hash'))||!constantEq(account,setting('admin_username','admin'))){
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
      if(route==='/api/admin/config'&&req.method==='GET')return json(res,200,{publicUrl:setting('public_url'),phoneNumber:setting('phone_number'),rateLimitSeconds:Number(setting('rate_limit_seconds','60')),requestRetentionLimit:requestFlow.retentionLimit(),requestCount:requestFlow.count(),siteName:setting('site_name','呼叫车主挪车'),wechatId:setting('wechat_id'),adminUsername:setting('admin_username','admin'),appConfigured:voice.isDeviceReady(),appEnabled:setting('notify_app_enabled','1')==='1',barkEnabled:setting('notify_bark_enabled','1')==='1',sc3Enabled:setting('notify_sc3_enabled','1')==='1',serverchanEnabled:setting('notify_serverchan_enabled','1')==='1',siteIconConfigured:!!iconGet.get(),siteIconUpdatedAt:iconGet.get()?.updated_at||null,barkConfigured:!!setting('bark_url'),serverchanConfigured:!!setting('serverchan_sendkey'),sc3Configured:!!setting('sc3_sendkey')});
      if(route==='/api/admin/requests'&&req.method==='GET'){
        const page=Number(u.searchParams.get('page')||'1'),size=Number(u.searchParams.get('size')||'20');
        if(!Number.isInteger(page)||page<1||page>9999||!Number.isInteger(size)||size<1||size>100)return json(res,400,{error:'分页参数无效'});
        return json(res,200,requestFlow.listHistory(page,size));
      }
      if(!['POST','PUT'].includes(req.method)||!checkCsrf(req,auth.csrf))return json(res,403,{error:'请求未通过验证'});
      if(route==='/api/admin/requests/delete'&&req.method==='POST'){
        const data=await inputJson(req);
        if(typeof data.id!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.id))return json(res,400,{error:'请求编号无效'});
        return json(res,200,{ok:true,deleted:requestFlow.deleteHistory(data.id)});
      }
      if(route==='/api/admin/requests/clear'&&req.method==='POST'){
        const data=await inputJson(req);
        if(data.confirm!==true)return json(res,400,{error:'请确认清空全部已保留记录'});
        requestFlow.clearHistory();return json(res,200,{ok:true});
      }
      if(route==='/api/admin/site-icon'&&req.method==='PUT'){
        if(trustedAdminOrigin(req)===null)return json(res,403,{error:'来源不可信'});
        const {data,mime}=await iconUpload(req);
        iconSave.run(data,mime,Date.now());return json(res,200,{ok:true});
      }
      if(route==='/api/admin/site-icon/clear'&&req.method==='POST'){
        iconClear.run();return json(res,200,{ok:true});
      }
      if(route==='/api/admin/logout'){
        const tok=sessions(req).movecar_admin;db.prepare('DELETE FROM admin_sessions WHERE digest=?').run(hash(tok));
        return json(res,200,{ok:true},{'Set-Cookie':cookie('movecar_admin','',trustedAdminOrigin(req)||origin,0)});
      }
      if(route==='/api/admin/settings' && req.method==='POST') {
        const data=await inputJson(req);
        if(typeof data.publicUrl!=='string'||data.publicUrl.length>300)throw Object.assign(Error('访问地址无效'),{status:400});
        if(typeof data.phoneNumber!=='string'||data.phoneNumber.length>35)throw Object.assign(Error('电话号码无效'),{status:400});
        if(!Number.isInteger(data.rateLimitSeconds)||data.rateLimitSeconds<0||data.rateLimitSeconds>3600)throw Object.assign(Error('限流范围须在 0-3600 秒'),{status:400});
        if(data.requestRetentionLimit!==undefined && (!Number.isInteger(data.requestRetentionLimit)||data.requestRetentionLimit<1||data.requestRetentionLimit>500))throw Object.assign(Error('挪车记录保留条数须在 1-500 之间'),{status:400});
        if(data.siteName!==undefined && (typeof data.siteName!=='string'||data.siteName.trim().length<1||data.siteName.trim().length>40))throw Object.assign(Error('站点名称须在 1-40 字以内'),{status:400});
        if(data.wechatId!==undefined && (typeof data.wechatId!=='string'||data.wechatId.trim().length>60||(!/^[\x20-\x7E]*$/.test(data.wechatId.trim()))))throw Object.assign(Error('微信号长度最多 60，且须为普通英文/数字字符'),{status:400});
        let publicUrl;
        try { publicUrl=validateOrigin(data.publicUrl.trim()); } catch { throw Object.assign(Error('公网地址格式不正确'),{status:400}); }
        let bark=null,key=null;
        if(data.barkUrl){if(typeof data.barkUrl!=='string'||data.barkUrl.length>500)throw Object.assign(Error('Bark URL 不合法'),{status:400});try { bark=validateBark(data.barkUrl.trim()); } catch { throw Object.assign(Error('Bark 地址不正确（须使用 HTTPS）'),{status:400}); }}
        if(data.serverchanSendKey){if(typeof data.serverchanSendKey!=='string'||data.serverchanSendKey.length>200)throw Object.assign(Error('SendKey 不合法'),{status:400});try { key=validateSendKey(data.serverchanSendKey.trim()); } catch { throw Object.assign(Error('请填写 SCT 开头的 Server酱 Turbo SendKey'),{status:400}); }}
        let sc3Key=null;
        if(data.sc3SendKey){
          try { sc3Key=validateSc3Key(data.sc3SendKey.trim()); }
          catch { throw Object.assign(Error('请填写 sctp 开头的 Server酱³ SendKey'),{status:400}); }
        }
        save('public_url',publicUrl);save('phone_number',data.phoneNumber.trim());save('rate_limit_seconds',data.rateLimitSeconds);
        if(data.requestRetentionLimit!==undefined){save('request_retention_limit',data.requestRetentionLimit);requestFlow.trimRetention();}
        if(data.siteName!==undefined)save('site_name',data.siteName.trim());
        if(data.wechatId!==undefined)save('wechat_id',data.wechatId.trim());
        if(bark)save('bark_url',bark);else if(data.clearBark===true)delSettingStmt.run('bark_url');
        if(key)save('serverchan_sendkey',key);else if(data.clearServerchan===true)delSettingStmt.run('serverchan_sendkey');
        if(sc3Key)save('sc3_sendkey',sc3Key);else if(data.clearSc3===true)delSettingStmt.run('sc3_sendkey');
        for(const name of ['app','bark','sc3','serverchan']) {
          if(data[name+'Enabled']!==undefined){
            if(typeof data[name+'Enabled']!=='boolean')throw Object.assign(Error('通知开关格式错误'),{status:400});
            save('notify_'+name+'_enabled',data[name+'Enabled']?'1':'0');
          }
        }
        return json(res,200,{ok:true});
      }
      if(route==='/api/admin/test-push'&&req.method==='POST'){
        const data=await inputJson(req);
        const channel=data.channel??'all';
        if(!['all','bark','serverchan','sc3','app'].includes(channel))return json(res,400,{error:'测试渠道无效'});
        const channels=await notifyChannels({title:'MoveCar 测试通知',message:'后台推送渠道测试成功 ✅',ownerUrl:signedOwnerLink(origin),channel});
        return json(res,200,{ok:true,message:'测试推送已提交',channels});
      }
      if(route==='/api/admin/password'&&req.method==='POST'){
        const data=await inputJson(req);
        if(typeof data.currentPassword!=='string'||typeof data.newPassword!=='string'||data.newPassword.length<12||data.newPassword.length>128)throw Object.assign(Error('新密码至少 12 位，最多 128 位'),{status:400});
        const actual=crypto.scryptSync(data.currentPassword,setting('admin_salt'),64).toString('hex');
        if(!constantEq(actual,setting('admin_hash')))return json(res,403,{error:'原密码错误'});
        const salt=crypto.randomBytes(16).toString('hex');save('admin_salt',salt);save('admin_hash',crypto.scryptSync(data.newPassword,salt,64).toString('hex'));
        db.exec('DELETE FROM admin_sessions; DELETE FROM mobile_sessions');
        try{fs.unlinkSync(initialFile);}catch(e){if(e.code!=='ENOENT')console.warn('Could not remove bootstrap password file');}
        return json(res,200,{ok:true,message:'密码修改成功，请重新登录'},{'Set-Cookie':cookie('movecar_admin','',trustedAdminOrigin(req)||origin,0)});
      }
      return json(res,404,{error:'接口不存在'});
    }
    const hasOwner=!!isOwner(req);
    if((route==='/owner-confirm'||route.startsWith('/owner-confirm/'))&&!hasOwner){
      if(!verifyOwnerLink(u))return reply(res,403,'车主确认链接无效或已过期，请重新发起挪车通知。');
      const tok=random();ownerSessionPut.run(hash(tok),Date.now()+3600000);
      res.writeHead(303,{'Location':'/owner-confirm','Set-Cookie':cookie('movecar_owner',tok,origin),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});return res.end();
    }
    if(route==='/api/get-location')return reply(res,410,'定位功能已停用');
    if(route==='/api/owner-confirm'&&!hasOwner)return reply(res,403,'车主认证失败');
    const methods={'/api/notify':'POST','/api/get-location':'GET','/api/owner-confirm':'POST','/api/check-status':'GET','/owner-confirm':'GET','/api/photo':'POST'};
    if(methods[route] && req.method!==methods[route])return reply(res,405,'Method not allowed');
    if(route.startsWith('/api/photo/') && req.method==='GET'){
      const id=route.slice('/api/photo/'.length);
      if(!/^[a-zA-Z0-9_-]{43}$/.test(id))return reply(res,404,'照片不存在');
      const record=photoGet.get(id,Date.now());
      if(!record)return reply(res,404,'照片已过期或不存在');
      return reply(res,200,record.data,{'Content-Type':record.mime,'Cache-Control':'private, no-store','Content-Disposition':'inline; filename="car-photo.jpg"','Content-Security-Policy':"default-src 'none'; sandbox"});
    }
    if(route==='/api/photo'&&req.method==='POST'){
      if(trustedAdminOrigin(req)===null)return json(res,403,{error:'来源不可信'});
      if(req.headers['content-type']!=='image/jpeg')return json(res,415,{error:'仅接受 JPEG 图片'});
      const token=req.headers['x-photo-token'];
      if(typeof token!=='string'||!/^[a-zA-Z0-9_-]{43}$/.test(token))return json(res,403,{error:'拍照授权无效'});
      const digest=hash(token),now=Date.now();
      if(!photoGrantGet.get(digest,now))return json(res,403,{error:'请先成功发送一次挪车通知，再上传照片'});
      const bytes=await inputPhoto(req);
      if(photoGrantUse.run(digest,Date.now()).changes!==1)return json(res,409,{error:'这次挪车通知已上传过照片'});
      const id=random();photoPut.run(id,bytes,Date.now()+3600000);
      const imageUrl=`${origin}/api/photo/${id}`;
      const message=`现场照片已上传。\n\n![现场照片](${imageUrl})\n\n[查看现场照片](${imageUrl})`;
      try {
        await notifyChannels({title:'📷 挪车现场照片',message,ownerUrl:signedOwnerLink(origin),richMarkdown:true});
        return json(res,200,{ok:true});
      }catch(e){
        console.error('Photo saved but push failed (credentials hidden):',e.status||'unknown');
        return json(res,502,{ok:false,error:'照片已保存，但补充通知发送失败，请联系车主'});
      }
    }
    if(route==='/api/notify'){
      if(!setting('bark_url')&&!setting('serverchan_sendkey')&&!setting('sc3_sendkey'))return json(res,503,{error:'车主尚未配置消息推送，请联系车主'});
      const key=req.socket.remoteAddress||'unknown',now=Date.now(),window=Number(setting('rate_limit_seconds','60'));
      if(window>0&&(rateGet.get(key)?.until??0)>now)return reply(res,429,'通知太频繁，请稍后再试',{'Retry-After':String(window)});
      const data=await inputJson(req);
      if(typeof data.message!=='string'||data.message.length>200) return reply(res,400,'留言长度须在 200 字以内');
      // Legacy adapter ignores location data; location collection is disabled.
      // Failed notifications should not prevent a retry: set rate limit after success.
      const request=new Request(new URL(route+u.search,origin),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:data.message,delayed:false})});
      const response=await invokeWorker(request);
      if(response.ok) {
        const delivered=await response.clone().json().catch(()=>({}));
        if(delivered.success===true){
          if(window>0)ratePut.run(key,Date.now()+window*1000);
          const photoToken=random();
          photoGrantPut.run(hash(photoToken),Date.now()+20*60*1000);
          return json(res,200,{...delivered,photoToken});
        }
      }
      return sendWorker(response,res);
    }
    const bytes=req.method==='POST'?Buffer.from(JSON.stringify(await inputJson(req))):undefined;
    const reqWorker=new Request(new URL((route.startsWith('/owner-confirm/')?'/owner-confirm':route)+u.search,origin),{method:req.method==='HEAD'?'GET':req.method,...(bytes?{body:bytes,headers:{'Content-Type':'application/json'}}:{})});
    return sendWorker(await invokeWorker(reqWorker),res,req.method==='HEAD');
  } catch(err) {
    const status=err.status||500;
    if(status>=500)console.error('Request failed:',err.message?.replace(/(?:SCT[A-Za-z0-9_-]+|sctp[0-9]+t[A-Za-z0-9_-]+)/g,'[redacted]'));
    if(!res.headersSent) return (req.url||'').startsWith('/api/voice/') ? json(res,status,{error:status===500?'内部错误':err.message}) : (req.url||'').startsWith('/api/admin/')|| (req.url||'')==='/api/admin/config' ? json(res,status,{error:status===500?'内部错误':err.message}) : reply(res,status,status===500?'服务暂时不可用':err.message);
    res.end();
  }
});
server.requestTimeout=75000;
server.listen(port,'0.0.0.0',()=>console.log(`MoveCar listening on 0.0.0.0:${port} (admin /admin)`));
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0);}));
