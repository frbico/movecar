/**
 * Native owner app API. Reuses the web administrator's salted password hash,
 * settings and request records. Mobile sessions are independent, hashed,
 * revocable bearer tokens: never expose the browser's CSRF cookies to the app.
 */
import crypto from 'node:crypto';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const token=()=>crypto.randomBytes(32).toString('base64url');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const same=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const keyPattern=/^[A-Za-z0-9_-]{43}$/;
const channelKeys=['bark','serverchan','sc3','app'];

export function createMobileOwner({db,setting,save,deleteSetting,inputJson,json,requestFlow,voice,notifyChannels,
  validateOrigin,validateBark,validateSendKey,validateSc3Key,iconUpload,iconSave,iconClear,iconGet}){
  db.exec('CREATE TABLE IF NOT EXISTS mobile_sessions(digest TEXT PRIMARY KEY, expiry INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS mobile_sessions_exp ON mobile_sessions(expiry);');
  const put=db.prepare('INSERT INTO mobile_sessions(digest,expiry) VALUES(?,?)');
  const find=db.prepare('SELECT expiry FROM mobile_sessions WHERE digest=? AND expiry>?');
  const del=db.prepare('DELETE FROM mobile_sessions WHERE digest=?');
  const denied=new Map();
  const username=()=>setting('admin_username','admin');
  function passwordOk(value){
    if(typeof value!=='string'||value.length<1||value.length>200)return false;
    const salt=setting('admin_salt'),digest=setting('admin_hash');
    return Boolean(salt&&digest)&&same(crypto.scryptSync(value,salt,64).toString('hex'),digest);
  }
  function getToken(req){
    const match=String(req.headers.authorization||'').match(/^Bearer ([A-Za-z0-9_-]{43})$/);
    const t=match?.[1];
    if(!t||!find.get(hash(t),Date.now()))throw fail(401,'登录已过期，请重新登录');
    return t;
  }
  function guardLogin(req){
    const ip=String(req.socket.remoteAddress||'unknown');
    const item=denied.get(ip)||{count:0,until:0};
    if(item.until>Date.now())throw fail(429,'登录次数过多，请稍后重试');
    return {ip,item};
  }
  function responseConfig(){
    return {
      username:username(),siteIconConfigured:!!iconGet.get(),siteName:setting('site_name','呼叫车主挪车'),publicUrl:setting('public_url'),
      phoneNumber:setting('phone_number'),wechatId:setting('wechat_id'),
      rateLimitSeconds:Number(setting('rate_limit_seconds','60')),
      requestRetentionLimit:requestFlow.retentionLimit(),requestCount:requestFlow.count(),
      channels:{
        bark:{configured:!!setting('bark_url'),enabled:setting('notify_bark_enabled','1')==='1'},
        sc3:{configured:!!setting('sc3_sendkey'),enabled:setting('notify_sc3_enabled','1')==='1'},
        serverchan:{configured:!!setting('serverchan_sendkey'),enabled:setting('notify_serverchan_enabled','1')==='1'},
        app:{configured:voice.isDeviceReady(),enabled:setting('notify_app_enabled','1')==='1'}
      }
    };
  }
  async function handle(req,res,u){
    const path=u.pathname;
    if(!path.startsWith('/api/mobile/'))return false;
    const action=path.slice('/api/mobile/'.length);
    if(action==='login'&&req.method==='POST'){
      const {ip,item}=guardLogin(req);
      const input=await inputJson(req);
      const supplied=typeof input.username==='string'?input.username:'';
      if(!same(supplied,username())||!passwordOk(input.password)){
        item.count++;if(item.count>=5)item.until=Date.now()+15*60*1000;
        denied.set(ip,item);
        json(res,401,{error:'账号或密码不正确'});return true;
      }
      denied.delete(ip);
      const t=token();
      put.run(hash(t),Date.now()+14*24*3600000);
      let deviceAuth=null;
      try{
        if(typeof input.fcmToken==='string'&&input.fcmToken)deviceAuth=voice.registerMobileDevice(input.fcmToken);
      }catch(e){del.run(hash(t));throw e;}
      json(res,200,{ok:true,token:t,expiresIn:14*86400,username:username(),deviceAuth});
      return true;
    }
    const current=getToken(req);
    if(action==='config'&&req.method==='GET'){json(res,200,responseConfig());return true;}
    if(action==='requests'&&req.method==='GET'){
      const page=Number(u.searchParams.get('page')||'1'),size=Number(u.searchParams.get('size')||'20');
      if(!Number.isInteger(page)||page<1||page>9999||!Number.isInteger(size)||size<1||size>100)throw fail(400,'分页参数无效');
      json(res,200,requestFlow.listHistory(page,size));return true;
    }
    if(action==='calls'&&req.method==='GET'){json(res,200,{items:voice.listCallHistory()});return true;}
    if(action==='site-icon'&&req.method==='PUT'){
      const {data,mime}=await iconUpload(req);
      iconSave.run(data,mime,Date.now());json(res,200,{ok:true});return true;
    }
    if(req.method!=='POST'){json(res,405,{error:'请求方法无效'});return true;}
    const data=await inputJson(req);
    if(action==='site-icon/clear'){iconClear.run();json(res,200,{ok:true});return true;}
    if(action==='logout'){
      voice.unregisterMobileDevice(data.deviceAuth);del.run(hash(current));json(res,200,{ok:true});return true;
    }
    if(action==='device'){
      const deviceAuth=voice.registerMobileDevice(data.fcmToken);
      json(res,200,{ok:true,deviceAuth});return true;
    }
    if(action==='requests/confirm'){
      if(typeof data.id!=='string'||!keyPattern.test(data.id))throw fail(400,'请求编号无效');
      const confirmed=requestFlow.confirmHistory(data.id);
      json(res,200,{ok:true,confirmed});return true;
    }
    if(action==='requests/delete'){
      if(typeof data.id!=='string'||!keyPattern.test(data.id))throw fail(400,'请求编号无效');
      json(res,200,{ok:true,deleted:requestFlow.deleteHistory(data.id)});return true;
    }
    if(action==='requests/clear'){
      if(data.confirm!==true)throw fail(400,'请确认清除');
      requestFlow.clearHistory();json(res,200,{ok:true});return true;
    }
    if(action==='channels/test'){
      if(!['all',...channelKeys].includes(data.channel))throw fail(400,'通知渠道无效');
      const channels=await notifyChannels({title:'MoveCar · 测试通知',message:'来自车主 APP 的测试消息',ownerUrl:setting('public_url')||'https://movecar.ssxi.de/',channel:data.channel});
      json(res,200,{ok:true,channels});return true;
    }
    if(action==='channels'){
      const definitions=[
        ['barkUrl','clearBark','bark_url',validateBark],
        ['sc3SendKey','clearSc3','sc3_sendkey',validateSc3Key],
        ['serverchanSendKey','clearServerchan','serverchan_sendkey',validateSendKey]
      ];
      const pending=[];
      for(const [field,clearField,name,validate] of definitions){
        const value=data[field];
        if(value!==undefined&&typeof value!=='string')throw fail(400,'通知配置格式不正确');
        if(value&&value.trim()){
          let checked;try{checked=validate(value.trim());}catch{throw fail(400,field+' 格式错误');}
          pending.push([name,checked]);
        }else if(data[clearField]===true)pending.push([name,null]);
      }
      for(const key of channelKeys){
        const k=key+'Enabled';
        if(data[k]!==undefined && typeof data[k]!=='boolean')throw fail(400,'通知开关格式错误');
      }
      for(const [name,value] of pending){if(value===null)deleteSetting(name);else save(name,value);}
      for(const key of channelKeys)if(typeof data[key+'Enabled']==='boolean')save('notify_'+key+'_enabled',data[key+'Enabled']?'1':'0');
      json(res,200,{ok:true,channels:responseConfig().channels});return true;
    }
    if(action==='settings'){
      if(typeof data.siteName!=='string'||data.siteName.trim().length<1||data.siteName.trim().length>40)throw fail(400,'站点名称须为 1–40 字');
      if(typeof data.publicUrl!=='string'||data.publicUrl.length>300)throw fail(400,'公网 URL 错误');
      if(typeof data.phoneNumber!=='string'||data.phoneNumber.length>35)throw fail(400,'电话格式错误');
      if(typeof data.wechatId!=='string'||data.wechatId.length>60||!(/^[\x20-\x7e]*$/).test(data.wechatId.trim()))throw fail(400,'微信号格式错误');
      if(!Number.isInteger(data.rateLimitSeconds)||data.rateLimitSeconds<0||data.rateLimitSeconds>3600)throw fail(400,'通知限流须在 0–3600 秒');
      if(!Number.isInteger(data.requestRetentionLimit)||data.requestRetentionLimit<1||data.requestRetentionLimit>500)throw fail(400,'记录保留须在 1–500 条');
      let publicUrl;try{publicUrl=validateOrigin(data.publicUrl.trim());}catch{throw fail(400,'请使用有效的站点根地址');}
      save('site_name',data.siteName.trim());save('public_url',publicUrl);save('phone_number',data.phoneNumber.trim());
      save('wechat_id',data.wechatId.trim());save('rate_limit_seconds',data.rateLimitSeconds);
      save('request_retention_limit',data.requestRetentionLimit);requestFlow.trimRetention();
      json(res,200,{ok:true});return true;
    }
    if(action==='account'){
      if(!passwordOk(data.currentPassword))throw fail(403,'当前密码错误');
      const newUsername=data.newUsername;
      if(typeof newUsername!=='string'||!(/^[A-Za-z0-9_.-]{3,40}$/).test(newUsername))throw fail(400,'用户名须为 3–40 位英文字母、数字或 ._-');
      const newPassword=data.newPassword;
      if(newPassword!==undefined&&newPassword!==''&&(typeof newPassword!=='string'||newPassword.length<12||newPassword.length>128))throw fail(400,'新密码须为 12–128 位');
      save('admin_username',newUsername);
      if(newPassword){const salt=crypto.randomBytes(16).toString('hex');save('admin_salt',salt);save('admin_hash',crypto.scryptSync(newPassword,salt,64).toString('hex'));}
      db.exec('DELETE FROM admin_sessions; DELETE FROM mobile_sessions');
      voice.unregisterMobileDevice(data.deviceAuth);
      json(res,200,{ok:true,reauth:true});return true;
    }
    json(res,404,{error:'未知车主接口'});return true;
  }
  function cleanup(){db.prepare('DELETE FROM mobile_sessions WHERE expiry<=?').run(Date.now());for(const [k,v] of denied)if(v.until&&v.until<Date.now())denied.delete(k);}
  return {handle,cleanup};
}
