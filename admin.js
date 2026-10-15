'use strict';
const $ = id => document.getElementById(id);
let csrf = '';
let toastTimer;
const alertMsg = message => {
  const el = $('toast');el.textContent=message;el.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4200);
};
async function api(path, data, method='POST') {
  const r=await fetch(path,{method: data===undefined?'GET':method,credentials:'same-origin',headers:{...(data===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const body=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(body.error||`HTTP ${r.status}`);
  return body;
}
function showLogin(){$('panel').hidden=true;$('loginView').hidden=false;csrf='';}
async function showPanel(){
  const sess=await api('/api/admin/session');csrf=sess.csrf;
  const config=await api('/api/admin/config');
  $('publicUrl').value=config.publicUrl||'';
  $('phoneNumber').value=config.phoneNumber||'';
  $('rateLimit').value=config.rateLimitSeconds??60;
  $('barkState').textContent=config.barkConfigured?'已启用':'未配置';
  $('wechatState').textContent=config.serverchanConfigured?'已启用':'未配置';
  $('barkUrl').value='';$('sendkey').value='';$('clearBark').checked=false;$('clearWechat').checked=false;
  $('panel').hidden=false;$('loginView').hidden=true;
}
$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();const btn=e.currentTarget.querySelector('button');btn.disabled=true;
  try{await api('/api/admin/login',{password:$('loginPassword').value});$('loginPassword').value='';await showPanel();alertMsg('登录成功');}
  catch(err){alertMsg(err.message);}finally{btn.disabled=false;}
});
$('settingsForm').addEventListener('submit',async e=>{
  e.preventDefault();const btn=e.submitter;btn.disabled=true;
  try{
    await api('/api/admin/settings',{
      publicUrl:$('publicUrl').value.trim(),phoneNumber:$('phoneNumber').value.trim(),rateLimitSeconds:Number($('rateLimit').value),
      barkUrl:$('barkUrl').value.trim(),serverchanSendKey:$('sendkey').value.trim(),
      clearBark:$('clearBark').checked,clearServerchan:$('clearWechat').checked
    });
    await showPanel();alertMsg('设置已保存并立即生效，无需重启容器');
  }catch(err){alertMsg(err.message);}finally{btn.disabled=false;}
});
$('testPush').addEventListener('click',async e=>{
  const btn=e.currentTarget;btn.disabled=true;
  try{await api('/api/admin/test-push',{});alertMsg('测试通知发送成功，请检查手机');}catch(err){alertMsg(err.message);}finally{btn.disabled=false;}
});
$('passwordForm').addEventListener('submit',async e=>{
  e.preventDefault();const btn=e.submitter;btn.disabled=true;
  try{
    await api('/api/admin/password',{currentPassword:$('oldPassword').value,newPassword:$('newPassword').value});
    $('oldPassword').value='';$('newPassword').value='';showLogin();alertMsg('管理员密码已更新，请使用新密码重新登录');
  }catch(err){alertMsg(err.message);}finally{btn.disabled=false;}
});
$('logout').addEventListener('click',async()=>{
  try{await api('/api/admin/logout',{});}catch{}showLogin();alertMsg('已退出');
});
showPanel().catch(showLogin);
