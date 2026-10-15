'use strict';
(() => {
  const picker=document.getElementById('photoPicker');
  const choose=document.getElementById('photoChooseBtn');
  const send=document.getElementById('photoSendBtn');
  const preview=document.getElementById('photoPreview');
  const status=document.getElementById('photoStatus');
  if(!picker||!choose||!send||!preview||!status)return;
  let jpeg=null;
  let previewUrl=null;
  const tell=(message)=>{status.textContent=message;};
  choose.addEventListener('click',()=>{
    if(!window.moveCarPhotoGrant){tell('请先成功发送挪车通知');return;}
    picker.click();
  });
  picker.addEventListener('change',async()=>{
    const file=picker.files?.[0];
    if(!file)return;
    send.style.display='none';jpeg=null;
    try{
      if(!file.type.startsWith('image/'))throw Error('请选择照片文件');
      const image=await new Promise((resolve,reject)=>{
        const img=new Image(),src=URL.createObjectURL(file);
        img.onload=()=>{URL.revokeObjectURL(src);resolve(img);};
        img.onerror=()=>{URL.revokeObjectURL(src);reject(Error('无法读取照片'));};
        img.src=src;
      });
      const scale=Math.min(1,1200/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      const ctx=canvas.getContext('2d');
      if(!ctx)throw Error('浏览器无法压缩图片');
      ctx.drawImage(image,0,0,canvas.width,canvas.height);
      jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.72));
      if(!jpeg||jpeg.size<32||jpeg.size>1572864)throw Error('压缩后的图片太大，请换一张再试');
      if(previewUrl)URL.revokeObjectURL(previewUrl);
      previewUrl=URL.createObjectURL(jpeg);
      preview.src=previewUrl;preview.style.display='block';
      tell('照片已压缩，点击下面的按钮单独发送给车主');
      send.style.display='block';
    }catch(e){tell(e.message||'处理照片失败');}
    picker.value='';
  });
  send.addEventListener('click',async()=>{
    if(!window.moveCarPhotoGrant||!jpeg){tell('请先选取照片');return;}
    send.disabled=true;choose.disabled=true;tell('正在上传并发送照片…');
    try{
      const resp=await fetch('/api/photo',{method:'POST',headers:{'Content-Type':'image/jpeg','X-Photo-Token':window.moveCarPhotoGrant},body:jpeg});
      const result=await resp.json().catch(()=>({}));
      if(!resp.ok)throw Error(result.error||'照片发送失败');
      window.moveCarPhotoGrant=null;
      tell('✅ 照片已发送给车主。照片链接会在一小时后自动过期。');
      send.style.display='none';choose.style.display='none';
    }catch(e){tell('❌ '+(e.message||'发送失败')+'。请联系车主或重新发起通知。');}
    finally{send.disabled=false;choose.disabled=false;}
  });
})();