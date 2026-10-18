'use strict';
(async()=>{
  const success=document.querySelector('#successView .action-card');
  if(!success)return;
  let ready=false;
  try{
    const resp=await fetch('/api/voice/config',{cache:'no-store'});
    const config=await resp.json();
    ready=resp.ok&&config.ready===true;
  }catch{}
  // Never inject a voice-call button on the QR landing screen.
  const button=document.createElement('button');
  button.id='voiceContactBtn';
  button.type='button';
  button.className='movecar-contact movecar-voice';
  button.textContent='📞 语音通话';
  button.disabled=!ready;
  button.setAttribute('aria-disabled',String(!ready));
  button.addEventListener('click',()=>{
    if(!ready)return window.moveCarContactNotice?.('语音通话暂不可用');
    try{sessionStorage.setItem('movecar-last-notified',String(Date.now()));}catch{}
    window.location.assign('/voice/caller');
  });
  const retry=success.querySelector('#retryBtn');
  if(retry)retry.insertAdjacentElement('afterend',button);
  else success.prepend(button);
})();