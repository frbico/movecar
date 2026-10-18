'use strict';
const $=id=>document.getElementById(id);let csrf='',view='overview',timer,historyPage=1,historyTotal=0,setupLocked=false,setupStep=0,setupConfig=null,setupEditing=-1;
function toast(t,error=false){const el=$('toast');el.textContent=t;el.classList.toggle('error',error);el.classList.add('show');clearTimeout(timer);timer=setTimeout(()=>el.classList.remove('show'),4600)}
async function api(path,data){const get=data===undefined;const r=await fetch(path,{method:get?'GET':'POST',credentials:'same-origin',headers:get?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(get?{}:{body:JSON.stringify(data)})});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'HTTP '+r.status);return j}
function loginView(){$('appShell').hidden=true;$('loginView').hidden=false;csrf=''}
function switchView(next){if(setupLocked&&next!=='setup'){next='setup';toast('请先完成首次部署检测');}view=next;document.querySelectorAll('.view').forEach(x=>x.hidden=x.id!=='view-'+next);document.querySelectorAll('[data-view]').forEach(x=>{x.classList.toggle('active',x.dataset.view===next);if(x.dataset.view===next)x.setAttribute('aria-current','page');else x.removeAttribute('aria-current')});$('pageName').textContent={overview:'控制台',channels:'通知渠道',settings:'基本设置',setup:'部署与迁移',history:'挪车记录',security:'账户安全'}[next];if(next==='history')void loadHistory();if(next==='setup')void deploymentStatus();}
function base(){return{publicUrl:$('publicUrl').value.trim(),phoneNumber:$('phoneNumber').value.trim(),rateLimitSeconds:Number($('rateLimit').value),requestRetentionLimit:Number($('requestRetentionLimit').value),siteName:$('siteName').value.trim(),wechatId:$('wechatId').value.trim()}}
async function panel(){const s=await api('/api/admin/session');csrf=s.csrf;const c=await api('/api/admin/config');$('publicUrl').value=c.publicUrl||'';$('phoneNumber').value=c.phoneNumber||'';$('rateLimit').value=c.rateLimitSeconds??60;$('siteName').value=c.siteName||'呼叫车主挪车';$('wechatId').value=c.wechatId||'';document.title=(c.siteName||'MoveCar')+' · 后台';document.querySelector('.brand').firstChild.textContent='🚙 '+(c.siteName||'MoveCar')+' ';$('siteIconStatus').textContent=c.siteIconConfigured?'已上传自定义图标':'使用默认图标';$('siteIconPreview').hidden=!c.siteIconConfigured;if(c.siteIconConfigured)$('siteIconPreview').src='/site-icon?t='+(c.siteIconUpdatedAt||Date.now());let ico=document.querySelector('link[rel="icon"]');if(c.siteIconConfigured){if(!ico){ico=document.createElement('link');ico.rel='icon';document.head.appendChild(ico);}ico.href='/site-icon?t='+(c.siteIconUpdatedAt||Date.now());}else if(ico)ico.remove();$('requestRetentionLimit').value=c.requestRetentionLimit??50;$('requestRetentionUsage').textContent='当前已保留 '+(c.requestCount??0)+' 条挪车记录，上限 '+(c.requestRetentionLimit??50)+' 条。';const map=[['bark',c.barkConfigured&&c.barkEnabled],['sc3',c.sc3Configured&&c.sc3Enabled],['wechat',c.serverchanConfigured&&c.serverchanEnabled]];$('appOverview').textContent=c.appConfigured?(c.appEnabled?'已连接 · 通知开启':'已连接 · 通知关闭'):'尚未配对';$('appState').textContent=c.appConfigured?'已绑定 FCM':'未配对';for(const [name,enabled] of [['app',c.appEnabled],['bark',c.barkEnabled],['sc3',c.sc3Enabled],['serverchan',c.serverchanEnabled]])$(name+'Enabled').checked=!!enabled;for(const [name,on]of map){$(name+'State').textContent=on?'已启用':'未配置';$(name+'Overview').textContent=on?'已启用':'未配置'}$('activeCount').textContent=map.filter(x=>x[1]).length+(c.appConfigured&&c.appEnabled?1:0);for(const id of ['barkUrl','sendkey','sc3SendKey'])$(id).value='';for(const id of ['clearBark','clearWechat','clearSc3'])$(id).checked=false;const deployment=await api('/api/admin/deployment');setupLocked=!deployment.onboardingFinished;
document.querySelectorAll('.sidebar .nav,.sidebar .side-link').forEach(el=>{el.hidden=setupLocked&&el.dataset.view!=='setup';});
$('setupHeading').textContent=setupLocked?'首次部署向导':'部署配置';
$('setupIntroduction').textContent=setupLocked?'依次完成四步配置，必要检测合格后即可使用管理后台。':'查看当前环境配置，点击对应修改按钮直接编辑；修改域名后只需重新检测，不会重复进入首次向导。';
if(setupLocked){view='setup';setupStep=0;setupEditing=-1;}
else setupEditing=-1;
renderSetupStep();
$('appShell').hidden=false;$('loginView').hidden=true;switchView(view)}
$('loginForm').onsubmit=async e=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;try{await api('/api/admin/login',{username:$('loginUsername').value,password:$('loginPassword').value});$('loginPassword').value='';view='overview';await panel();toast('登录成功')}catch(e){toast(e.message,true)}finally{btn.disabled=false}};
async function save(payload,btn){btn.disabled=true;try{await api('/api/admin/settings',payload);await panel();toast('设置已保存，立即生效')}catch(e){toast(e.message,true)}finally{btn.disabled=false}}
$('channelsForm').onsubmit=e=>{e.preventDefault();void save({...base(),barkUrl:$('barkUrl').value.trim(),serverchanSendKey:$('sendkey').value.trim(),sc3SendKey:$('sc3SendKey').value.trim(),clearBark:$('clearBark').checked,clearServerchan:$('clearWechat').checked,clearSc3:$('clearSc3').checked,appEnabled:$('appEnabled').checked,barkEnabled:$('barkEnabled').checked,sc3Enabled:$('sc3Enabled').checked,serverchanEnabled:$('serverchanEnabled').checked},e.submitter)};
$('settingsForm').onsubmit=e=>{e.preventDefault();void save(base(),e.submitter)};
$('passwordForm').onsubmit=async e=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;try{await api('/api/admin/password',{currentPassword:$('oldPassword').value,newPassword:$('newPassword').value});$('oldPassword').value='';$('newPassword').value='';loginView();toast('密码修改成功，请重新登录')}catch(e){toast(e.message,true)}finally{btn.disabled=false}};
$('logout').onclick=async()=>{try{await api('/api/admin/logout',{})}catch{}loginView();toast('已退出登录')};
document.querySelectorAll('[data-view],[data-go]').forEach(b=>b.onclick=()=>switchView(b.dataset.view||b.dataset.go));
document.querySelectorAll('[data-test-channel]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const r=await api('/api/admin/test-push',{channel:b.dataset.testChannel});const ok=Object.entries(r.channels||{}).filter(x=>x[1]==='ok').map(x=>x[0]);const bad=Object.entries(r.channels||{}).filter(x=>x[1]!=='ok').map(x=>x[0]);toast('发送成功：'+(ok.join('、')||'无')+(bad.length?'；失败：'+bad.join('、'):'。请检查手机'),bad.length>0)}catch(e){toast(e.message,true)}finally{b.disabled=false}});

// Historical records are limited to configured retention (default latest 50), never exposed publicly.
async function loadHistory(){
 try{
   const result=await api('/api/admin/requests?page='+historyPage+'&size=20');
   historyTotal=result.total;
   $('historyTotal').textContent='· 共 '+historyTotal+' 条';
   $('historyPage').textContent='第 '+historyPage+' / '+Math.max(1,Math.ceil(historyTotal/20))+' 页';
   $('historyPrev').disabled=historyPage<=1;
   $('historyNext').disabled=historyPage*20>=historyTotal;
   const body=$('historyRows');body.replaceChildren();
   if(!result.items.length){const tr=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=5;cell.textContent='暂无挪车记录';tr.appendChild(cell);body.appendChild(tr);return;}
   for(const item of result.items){
     const tr=document.createElement('tr');
     const created=document.createElement('td');created.textContent=new Date(item.createdAt).toLocaleString('zh-CN');
     const msg=document.createElement('td');msg.className='history-message';msg.textContent=item.message;
     const status=document.createElement('td');status.textContent=({waiting:'等待确认',confirmed:'车主已确认',expired:'已过期'})[item.status]||item.status;
     const photo=document.createElement('td');if(item.photoUrl){const link=document.createElement('a');link.href=item.photoUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent='查看照片 ↗';photo.appendChild(link);}else photo.textContent=item.photoSent?'已过期':'无照片';
     const action=document.createElement('td'),remove=document.createElement('button');remove.type='button';remove.className='outline';remove.textContent='删除';remove.addEventListener('click',async()=>{if(!confirm('确定删除这条记录及其关联照片？'))return;remove.disabled=true;try{await api('/api/admin/requests/delete',{id:item.id});toast('记录已删除');await loadHistory();}catch(e){toast(e.message,true)}finally{remove.disabled=false}});action.appendChild(remove);
     tr.append(created,msg,status,photo,action);body.appendChild(tr);
   }
 }catch(e){toast('加载历史记录失败：'+e.message,true)}
}
$('historyRefresh').onclick=()=>loadHistory();
$('historyPrev').onclick=()=>{if(historyPage>1){historyPage--;void loadHistory()}};
$('historyNext').onclick=()=>{if(historyPage*20<historyTotal){historyPage++;void loadHistory()}};
$('historyClear').onclick=async()=>{
 if(!confirm('将永久删除所有已保留的挪车记录和关联照片，且无法恢复。确认继续？'))return;
 try{await api('/api/admin/requests/clear',{confirm:true});historyPage=1;await loadHistory();toast('历史记录已清空');}catch(e){toast(e.message,true)}
};
$('siteIconUpload').onclick=async()=>{
 const file=$('siteIconFile').files?.[0];if(!file){toast('请选择图标文件',true);return;}
 if(file.size>262144){toast('图标不能超过 256 KB',true);return;}
 const btn=$('siteIconUpload');btn.disabled=true;
 try{
   const response=await fetch('/api/admin/site-icon',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':file.type||'application/octet-stream','X-CSRF-Token':csrf},body:file});
   const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'图标上传失败');
   $('siteIconFile').value='';await panel();toast('图标已更新');
 }catch(e){toast(e.message,true)}finally{btn.disabled=false}
};
$('siteIconClear').onclick=async()=>{
 if(!confirm('恢复默认网站图标？'))return;
 try{await api('/api/admin/site-icon/clear',{});await panel();toast('已恢复默认图标');}catch(e){toast(e.message,true)}
};

panel().catch(loginView);
function secureUpload(){
 if(location.protocol==='https:'||['localhost','127.0.0.1','::1'].includes(location.hostname))return true;
 toast('请先使用 HTTPS 或 SSH 本地端口转发访问后台，再上传服务器私钥',true);
 return false;
}
function managedText(id,value){$(id).textContent=value==null||value===''?'—':String(value);}
function certificateSourceLabel(src){
 return ({auto:'服务器自动查找',directory:'服务器目录自动同步',upload:'后台手动上传',none:'尚未设置'})[src]||'尚未设置';
}
function formatCertExpiry(str){
 if(!str)return '—';
 const d=new Date(str);return Number.isNaN(d.getTime())?str:d.toLocaleString('zh-CN');
}
function renderManagedDetails(c){
 managedText('managedSite',c.publicUrl||'未配置');
 managedText('managedTurn',c.turnHost||'未配置');
 managedText('managedTurnUdp',c.turnHost?'turn:'+c.turnHost+':3478?transport=udp':'未配置');
 managedText('managedTurnTls',c.turnHost&&c.turnTlsEnabled?'turns:'+c.turnHost+':5349?transport=tcp':'未启用（可选）');
 managedText('managedFirebase',c.firebaseConfigured?'已配置 Firebase Admin SDK':'尚未导入');
 managedText('managedFirebaseProject',c.firebaseProjectId||'—');
 managedText('managedTlsStatus',c.turnTlsEnabled?'已启用 · TCP 5349':'未启用 · UDP/TCP 3478 仍可使用');
 managedText('managedCertSource',certificateSourceLabel(c.certificateSource));
 managedText('managedCertDirectory',c.certificateSource==='directory'?(c.certificateDirectory||'—'):'不适用');
 managedText('managedCertExpiry',formatCertExpiry(c.certificateExpiresAt));
 managedText('managedCertCheck',c.certificateCheck?.message||'未执行目录同步或使用了手动上传');
 const health=c.turnHealth;
 managedText('managedTurnHealth',health&&health.turnHost===c.turnHost?
   (health.ok?'通过 · ':'未通过 · ')+(health.message||''):'等待检测');
 const fw=c.firewall;
 const fwLabel=fw?.manager==='ufw'?'UFW':fw?.manager==='firewalld'?'firewalld':fw?.manager==='iptables'?'iptables':fw?.manager==='inactive-or-unknown'?'未发现已启用的常见主机防火墙':fw?.manager||'未检测';
 managedText('managedFirewall',fwLabel+(fw?.automatic===false?' · 需要人工检查':' · 自动检查/配置完成'));
 const state=$('managedStatus');
 state.className='managed-status '+(c.setupComplete?'is-ready':'needs-check');
 state.textContent=c.setupComplete?
   '✓ 首次部署已完成。下方是当前实际配置，后续可直接修改，无须重复四步向导。':
   '配置已保存，但域名或服务器环境发生变化，需要重新检测才能确认新配置已生效。';
}
async function deploymentStatus(){
 try{
  const c=await api('/api/admin/deployment');
  $('setupSite').value=c.publicUrl||'';
  $('setupTurn').value=c.turnHost||'';
  setupConfig=c;
  $('setupCertDirectory').value=c.certificateDirectory||'';
  $('setupCertState').textContent=c.certificateCheck?.message||'推荐自动复用网站泛域名证书，或填写证书目录';
  const lines=[
   '网站地址：'+(c.publicUrl||'尚未填写'),
   'TURN：'+(c.turnEnabled?'已配置 · UDP/TCP 3478':'尚未配置'),
   'TURN TLS：'+(c.turnTlsEnabled?'已启用 5349':'尚未启用'),
   'Firebase：'+(c.firebaseConfigured?'已导入服务账号':'尚未导入')
  ];
  $('setupState').textContent=lines.join('　 |　 ');
  if(!setupLocked)renderManagedDetails(c);
  renderSetupStep();
 }catch(e){toast('读取部署状态失败：'+e.message,true);}
}
function renderSetupStep(){
 const managing=!setupLocked;
 const edited=managing?setupEditing:setupStep;
 $('setupManaged').hidden=!managing||edited!==-1;
 $('setupWizardSteps').hidden=managing;
 $('setupWizardFooter').hidden=managing;
 $('setupEditorClose').hidden=!managing||edited===-1;
 $('setupIntroduction').textContent=managing?
  '当前服务器的实际设置和放行端口。需要更改时点击对应的修改按钮，不再重复显示首次向导。':
  '首次安装时按步骤填写配置，通过必要检查后解锁完整后台。';
 document.querySelectorAll('.setup-stage').forEach(el=>{
   const num=Number(el.dataset.setupStep);
   el.hidden=num!==edited;
   const h=el.querySelector('h2');
   const titles=['网站与 TURN 地址','Firebase 消息与来电','TURN TLS 备用连接','环境检测'];
   if(h)h.textContent=managing?titles[num]:'第'+['一','二','三','四'][num]+'步 · '+titles[num];
 });
 if(managing){
  const saveBtn=$('deploymentForm').querySelector('button[type="submit"]');
  saveBtn.textContent='保存网站与 TURN 地址';
  $('setupFirebaseSave').textContent='保存 Firebase 配置';
  $('setupFinish').hidden=true;
  if(edited===3)void verifySetup();
  return;
 }
 $('deploymentForm').querySelector('button[type="submit"]').textContent='保存地址并继续 →';
 $('setupFirebaseSave').textContent='保存 Firebase 并继续 →';
 $('setupFinish').hidden=false;
 const names=['网站与 TURN','Firebase 消息','证书与备用连接','环境检测'];
 $('setupSteps').replaceChildren(...names.map((name,i)=>{
  const el=document.createElement('span');
  el.className='setup-step'+(i===setupStep?' active':'')+(i<setupStep?' done':'');
  el.textContent=(i+1)+'. '+name;return el;
 }));
 $('setupProgress').textContent='第 '+(setupStep+1)+' / 4 步';
 $('setupPrev').hidden=setupStep===0;
 $('setupNext').hidden=setupStep===3;
 $('setupStepHint').textContent=[
  '请先保存 HTTPS 网站地址与 TURN 域名',
  '上传 Firebase 服务账号，用于消息通知和来电响铃',
  '推荐复用主站泛域名证书；TLS 是增强连接成功率的可选功能',
  '检测必需项目，全部合格后解锁管理后台'][setupStep];
 if(setupStep===3)void verifySetup();
}
function closeManagedEditor(){
 if(setupLocked)return;
 setupEditing=-1;renderSetupStep();
}
function openManagedEditor(index){
 if(setupLocked)return;
 setupEditing=index;renderSetupStep();
 document.getElementById('view-setup').scrollIntoView({behavior:'smooth',block:'start'});
}
document.querySelectorAll('[data-setup-edit]').forEach(btn=>{
 btn.addEventListener('click',()=>openManagedEditor(Number(btn.dataset.setupEdit)));
});
$('setupCloseEdit').onclick=()=>closeManagedEditor();
async function gotoStep(next){
 if(next<0||next>3)return;
 if(next>setupStep){
  const c=await api('/api/admin/deployment');
  if(setupStep===0&&(!c.turnEnabled||!c.publicUrl)){toast('请先保存网站 HTTPS 和 TURN 域名',true);return;}
  if(setupStep===1&&!c.firebaseConfigured){toast('请先配置 Firebase Admin SDK 服务账号',true);return;}
 }
 setupStep=next;renderSetupStep();
}
$('setupNext').onclick=()=>void gotoStep(setupStep+1);
$('setupPrev').onclick=()=>void gotoStep(setupStep-1);
async function verifySetup(){
 const btn=$('setupVerify');btn.disabled=true;
 try{
  const r=await api('/api/admin/deployment/verify');
  const container=$('setupChecks');container.replaceChildren();
  for(const check of r.checks){
   const p=document.createElement('p');
   const flag=document.createElement('strong');flag.textContent=(check.ok?'✓ ':'✕ ')+check.label;
   flag.className=check.ok?'setup-ok':'setup-bad';p.append(flag,document.createTextNode(' — '+check.message));
   container.appendChild(p);
  }
  $('setupFinish').disabled=!r.ready;
  if(!setupLocked){
    $('managedChecks').replaceChildren(...r.checks.map(check=>{
      const p=document.createElement('p');
      p.textContent=(check.ok?'✓ ':'✕ ')+check.label+' — '+check.message;
      p.className=check.ok?'setup-ok':'setup-bad';
      return p;
    }));
    if(r.ready&&!r.config.setupComplete){
      await api('/api/admin/deployment/complete',{confirm:true});
      await deploymentStatus();
      toast('环境检查合格，当前部署状态已更新');
    }
  }
  $('setupState').textContent=r.ready?'✓ 本地必需检查通过。请确认云服务商安全组也已允许 TURN 端口。':'有必需项目尚未通过，请修复后再次检测。';
 }catch(e){$('setupFinish').disabled=true;toast('检测失败：'+e.message,true);}
 finally{btn.disabled=false;}
}
$('setupVerify').onclick=()=>void verifySetup();
$('setupFinish').onclick=async()=>{
 const btn=$('setupFinish');btn.disabled=true;
 try{
  await api('/api/admin/deployment/complete',{confirm:true});
  setupLocked=false;view='overview';await panel();
  toast('首次部署检查已通过，欢迎使用 MoveCar 管理后台');
 }catch(e){toast(e.message,true);void verifySetup();}
};
$('deploymentForm').onsubmit=async e=>{
 e.preventDefault();const btn=e.submitter;btn.disabled=true;
 try{
  await api('/api/admin/deployment/config',{siteUrl:$('setupSite').value.trim(),turnHost:$('setupTurn').value.trim()});
  await deploymentStatus();toast('网站与 TURN 地址已保存');
  if(setupLocked)await gotoStep(1);else closeManagedEditor();
 }catch(e){toast(e.message,true)}finally{btn.disabled=false}
};
$('setupFirebaseSave').onclick=async()=>{
 if(!secureUpload())return;
 const file=$('setupFirebaseFile').files?.[0];
 if(!file){toast('请选择 Firebase Admin SDK 服务账号 JSON',true);return;}
 if(file.size>45000){toast('Firebase 文件不能超过 45 KB',true);return;}
 const btn=$('setupFirebaseSave');btn.disabled=true;
 try{
  await api('/api/admin/deployment/firebase',{json:await file.text()});
  $('setupFirebaseFile').value='';await deploymentStatus();toast('Firebase 已保存');
  if(setupLocked)await gotoStep(2);else closeManagedEditor();
 }catch(e){toast(e.message,true)}finally{btn.disabled=false}
};
async function certSource(mode,directory=''){
 try{
  await api('/api/admin/deployment/cert-source',{mode,directory});
  await deploymentStatus();toast('服务器证书同步任务已提交，可以在配置概览查看结果');
  if(!setupLocked)closeManagedEditor();
 }catch(e){toast(e.message,true);}
}
$('setupCertAuto').onclick=()=>void certSource('auto');
$('setupCertDirForm').onsubmit=e=>{e.preventDefault();void certSource('directory',$('setupCertDirectory').value.trim());};
$('setupTlsSave').onclick=async()=>{
 if(!secureUpload())return;
 const cert=$('setupTlsCert').files?.[0],key=$('setupTlsKey').files?.[0];
 if(!cert||!key){toast('请选择证书和私钥文件',true);return;}
 if(cert.size>38000||key.size>38000){toast('证书文件过大',true);return;}
 const btn=$('setupTlsSave');btn.disabled=true;
 try{
  await api('/api/admin/deployment/tls',{certificate:await cert.text(),privateKey:await key.text()});
  $('setupTlsCert').value='';$('setupTlsKey').value='';
  await deploymentStatus();toast('TURN TLS 已启用，coturn 自动加载');
  if(!setupLocked)closeManagedEditor();
 }catch(e){toast(e.message,true)}finally{btn.disabled=false;}
};
$('setupTlsClear').onclick=async()=>{
 if(!confirm('关闭 TURN TLS 5349？UDP/TCP 3478 仍可继续运行。'))return;
 try{await api('/api/admin/deployment/tls/clear',{});await deploymentStatus();toast('TURN TLS 已关闭');if(!setupLocked)closeManagedEditor();}
 catch(e){toast(e.message,true);}
};
renderSetupStep();
$('managedVerify').onclick=()=>void verifySetup();
async function refreshCertificateState(){
 if(view!=='setup'||(setupLocked?setupStep!==2:setupEditing!==2))return;
 try{
  const c=await api('/api/admin/deployment');
  $('setupCertState').textContent=(c.turnTlsEnabled?'✓ TURN TLS 已启用。':'TURN TLS 尚未启用。')+
    (c.certificateCheck?.message||'请自动查找网站证书、填写目录或上传 PEM。');
 }catch{}
}
setInterval(()=>void refreshCertificateState(),12000);
