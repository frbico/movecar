'use strict';
const $=id=>document.getElementById(id);let csrf='',view='overview',timer,historyPage=1,historyTotal=0;
function toast(t,error=false){const el=$('toast');el.textContent=t;el.classList.toggle('error',error);el.classList.add('show');clearTimeout(timer);timer=setTimeout(()=>el.classList.remove('show'),4600)}
async function api(path,data){const get=data===undefined;const r=await fetch(path,{method:get?'GET':'POST',credentials:'same-origin',headers:get?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(get?{}:{body:JSON.stringify(data)})});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'HTTP '+r.status);return j}
function loginView(){$('appShell').hidden=true;$('loginView').hidden=false;csrf=''}
function switchView(next){view=next;document.querySelectorAll('.view').forEach(x=>x.hidden=x.id!=='view-'+next);document.querySelectorAll('[data-view]').forEach(x=>{x.classList.toggle('active',x.dataset.view===next);if(x.dataset.view===next)x.setAttribute('aria-current','page');else x.removeAttribute('aria-current')});$('pageName').textContent={overview:'控制台',channels:'通知渠道',settings:'基本设置',history:'挪车记录',security:'账户安全'}[next];if(next==='history')void loadHistory();}
function base(){return{publicUrl:$('publicUrl').value.trim(),phoneNumber:$('phoneNumber').value.trim(),rateLimitSeconds:Number($('rateLimit').value),requestRetentionLimit:Number($('requestRetentionLimit').value),siteName:$('siteName').value.trim(),wechatId:$('wechatId').value.trim()}}
async function panel(){const s=await api('/api/admin/session');csrf=s.csrf;const c=await api('/api/admin/config');$('publicUrl').value=c.publicUrl||'';$('phoneNumber').value=c.phoneNumber||'';$('rateLimit').value=c.rateLimitSeconds??60;$('siteName').value=c.siteName||'呼叫车主挪车';$('wechatId').value=c.wechatId||'';document.title=(c.siteName||'MoveCar')+' · 后台';document.querySelector('.brand').firstChild.textContent='🚙 '+(c.siteName||'MoveCar')+' ';$('siteIconStatus').textContent=c.siteIconConfigured?'已上传自定义图标':'使用默认图标';$('siteIconPreview').hidden=!c.siteIconConfigured;if(c.siteIconConfigured)$('siteIconPreview').src='/site-icon?t='+(c.siteIconUpdatedAt||Date.now());let ico=document.querySelector('link[rel="icon"]');if(c.siteIconConfigured){if(!ico){ico=document.createElement('link');ico.rel='icon';document.head.appendChild(ico);}ico.href='/site-icon?t='+(c.siteIconUpdatedAt||Date.now());}else if(ico)ico.remove();$('requestRetentionLimit').value=c.requestRetentionLimit??50;$('requestRetentionUsage').textContent='当前已保留 '+(c.requestCount??0)+' 条挪车记录，上限 '+(c.requestRetentionLimit??50)+' 条。';const map=[['bark',c.barkConfigured],['sc3',c.sc3Configured],['wechat',c.serverchanConfigured]];for(const [name,on]of map){$(name+'State').textContent=on?'已启用':'未配置';$(name+'Overview').textContent=on?'已启用':'未配置'}$('activeCount').textContent=map.filter(x=>x[1]).length;for(const id of ['barkUrl','sendkey','sc3SendKey'])$(id).value='';for(const id of ['clearBark','clearWechat','clearSc3'])$(id).checked=false;$('appShell').hidden=false;$('loginView').hidden=true;switchView(view)}
$('loginForm').onsubmit=async e=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;try{await api('/api/admin/login',{password:$('loginPassword').value});$('loginPassword').value='';view='overview';await panel();toast('登录成功')}catch(e){toast(e.message,true)}finally{btn.disabled=false}};
async function save(payload,btn){btn.disabled=true;try{await api('/api/admin/settings',payload);await panel();toast('设置已保存，立即生效')}catch(e){toast(e.message,true)}finally{btn.disabled=false}}
$('channelsForm').onsubmit=e=>{e.preventDefault();void save({...base(),barkUrl:$('barkUrl').value.trim(),serverchanSendKey:$('sendkey').value.trim(),sc3SendKey:$('sc3SendKey').value.trim(),clearBark:$('clearBark').checked,clearServerchan:$('clearWechat').checked,clearSc3:$('clearSc3').checked},e.submitter)};
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
     const photo=document.createElement('td');photo.textContent=item.hasPhoto?'已附照片':'无照片';
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