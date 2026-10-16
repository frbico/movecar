'use strict';
// Separate from request-ui.js so upstream notification/photo behaviour is unchanged.
(async()=>{
  let ready=false;
  try{const r=await fetch('/api/voice/config',{cache:'no-store'});const c=await r.json();ready=r.ok&&c.ready;}catch{}
  if(!ready)return;
  const makeButton=()=>{
    const b=document.createElement('button');
    b.type='button';b.textContent='📞 网络语音呼叫车主（不显示手机号）';
    b.style.cssText='display:block;width:100%;margin:12px 0;padding:16px;border-radius:15px;border:0;background:#117b63;color:white;font-size:17px;font-weight:700;cursor:pointer';
    b.addEventListener('click',()=>{window.location.href='/voice/caller';});
    return b;
  };
  const notify=document.getElementById('notifyBtn');
  if(notify)notify.insertAdjacentElement('afterend',makeButton());
  const contact=document.querySelector('#successView .action-card');
  if(contact)contact.insertBefore(makeButton(),contact.firstChild);
})();
