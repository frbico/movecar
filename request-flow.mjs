/**
 * Request-scoped MoveCar workflow.
 * Never use the legacy global notify_status for new requests.
 * Each notification gets independent owner confirmation, requester polling and photo tokens.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

export function createRequestFlow({db,setting,random,hash,notifyChannels,inputJson,inputPhoto,json,reply,rateGet,ratePut}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS move_requests (
      id TEXT PRIMARY KEY,
      owner_digest TEXT NOT NULL UNIQUE,
      poll_digest TEXT NOT NULL UNIQUE,
      message TEXT NOT NULL,
      location_json TEXT,
      status TEXT NOT NULL DEFAULT 'waiting',
      photo_sent INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      confirmed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS move_requests_exp ON move_requests(expires_at);
    CREATE TABLE IF NOT EXISTS move_photo_grants (
      digest TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  const insert=db.prepare('INSERT INTO move_requests(id,owner_digest,poll_digest,message,location_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?)');
  const remove=db.prepare('DELETE FROM move_requests WHERE id=?');
  const byOwner=db.prepare('SELECT * FROM move_requests WHERE owner_digest=? AND expires_at>?');
  const byPoll=db.prepare('SELECT status,confirmed_at FROM move_requests WHERE id=? AND poll_digest=? AND expires_at>?');
  const byId=db.prepare('SELECT * FROM move_requests WHERE id=? AND expires_at>?');
  const confirm=db.prepare("UPDATE move_requests SET status='confirmed', confirmed_at=COALESCE(confirmed_at,?) WHERE owner_digest=? AND expires_at>?");
  const grantInsert=db.prepare('INSERT INTO move_photo_grants(digest,request_id,expires_at) VALUES(?,?,?)');
  const grantSelect=db.prepare('SELECT request_id FROM move_photo_grants WHERE digest=? AND expires_at>?');
  const photoUsed=db.prepare('UPDATE move_requests SET photo_sent=1 WHERE id=? AND photo_sent=0 AND expires_at>?');
  const insertPhoto=db.prepare('INSERT INTO photo_records(id,data,expiry) VALUES(?,?,?)');
  const dropGrant=db.prepare('DELETE FROM move_photo_grants WHERE digest=?');
  const isToken=t=>typeof t==='string'&&/^[A-Za-z0-9_-]{43}$/.test(t);
  const ownerTokenFor=id=>crypto.createHmac('sha256',setting('owner_signing_key')).update('movecar-owner-v2:'+id).digest('base64url');
  const escaped=s=>String(s).replace(/([\\`*_[\]<>])/g,'\\$1');
  const locLinks=(loc)=>{
    const lat=Number(loc.lat),lng=Number(loc.lng);
    return {
      amap:`https://uri.amap.com/marker?position=${lng},${lat}&name=${encodeURIComponent('挪车现场')}`,
      google:`https://www.google.com/maps?q=${lat},${lng}`,
      apple:`https://maps.apple.com/?ll=${lat},${lng}`
    };
  };
  const page=fs.readFileSync(new URL('./owner-view.html',import.meta.url));
  const deny=(res,code=404)=>json(res,code,{error:'请求不存在或链接已过期，请重新发起挪车请求'});
  function cleanup(){
    const now=Date.now();
    db.prepare('DELETE FROM move_photo_grants WHERE expires_at<=?').run(now);
    db.prepare('DELETE FROM move_requests WHERE expires_at<=?').run(now);
  }
  return {
    cleanup,
    async handle(req,res,origin,u){
      const route=u.pathname,method=req.method;
      if(route==='/owner-view.js') {
        if(method!=='GET')return reply(res,405,'Method not allowed'),true;
        const script=fs.readFileSync(new URL('./owner-view.js',import.meta.url));
        reply(res,200,script,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});return true;
      }
      if(route==='/request-ui.js') {
        if(method!=='GET')return reply(res,405,'Method not allowed'),true;
        const script=fs.readFileSync(new URL('./request-ui.js',import.meta.url));
        reply(res,200,script,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});return true;
      }
      const confirmMatch=route.match(/^\/owner-confirm\/([A-Za-z0-9_-]{43})$/);
      if(confirmMatch) {
        if(method!=='GET')return reply(res,405,'Method not allowed'),true;
        const record=byOwner.get(hash(confirmMatch[1]),Date.now());
        if(!record){reply(res,410,'链接已过期或无效，请让对方重新发起挪车请求');return true;}
        reply(res,200,page,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});return true;
      }
      const infoMatch=route.match(/^\/api\/owner-request\/([A-Za-z0-9_-]{43})$/);
      if(infoMatch) {
        if(method!=='GET')return reply(res,405,'Method not allowed'),true;
        const record=byOwner.get(hash(infoMatch[1]),Date.now());
        if(!record){deny(res,410);return true;}
        const location=record.location_json?JSON.parse(record.location_json):null;
        json(res,200,{status:record.status,message:record.message,location:location?locLinks(location):null});return true;
      }
      if(route==='/api/confirm-move') {
        if(method!=='POST')return reply(res,405,'Method not allowed'),true;
        const data=await inputJson(req),token=data.token;
        if(!isToken(token)){deny(res);return true;}
        const record=byOwner.get(hash(token),Date.now());
        if(!record){deny(res,410);return true;}
        confirm.run(Date.now(),hash(token),Date.now());
        json(res,200,{success:true,status:'confirmed'});return true;
      }
      if(route==='/api/request-status') {
        if(method!=='POST')return reply(res,405,'Method not allowed'),true;
        const data=await inputJson(req);
        if(!isToken(data.requestId)||!isToken(data.pollToken)){deny(res);return true;}
        const record=byPoll.get(data.requestId,hash(data.pollToken),Date.now());
        if(!record){deny(res,410);return true;}
        json(res,200,{status:record.status,confirmedAt:record.confirmed_at||null});return true;
      }
      if(route==='/api/notify') {
        if(method!=='POST')return reply(res,405,'Method not allowed'),true;
        if(!setting('bark_url')&&!setting('serverchan_sendkey')&&!setting('sc3_sendkey'))
          return json(res,503,{error:'车主尚未配置推送渠道'}),true;
        const addr=req.socket.remoteAddress||'unknown',now=Date.now(),seconds=Number(setting('rate_limit_seconds','60'));
        if(seconds>0&&(rateGet.get(addr)?.until??0)>now)
          return json(res,429,{error:'发送过于频繁，请稍后再试'}),true;
        const body=await inputJson(req);
        if(typeof body.message!=='string'||body.message.length>200)return json(res,400,{error:'留言最长为 200 字'}),true;
        let location=null;
        if(body.location!=null){
          const {lat,lng}=body.location;
          if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)
            return json(res,400,{error:'位置坐标无效'}),true;
          location={lat,lng};
        }
        const id=random(),pollToken=random(),photoToken=random(),ownerToken=ownerTokenFor(id);
        const ownerUrl=`${origin}/owner-confirm/${ownerToken}`;
        const text=body.message.trim()||'请尽快挪车';
        const lines=['## 🚗 有新的挪车请求','',`**💬 留言：** ${escaped(text)}`,''];
        if(location) {
          const links=locLinks(location);
          lines.push('**📍 现场位置**','',
            `[📍 高德地图导航](${links.amap})`,'',
            `[🗺️ Google 地图](${links.google})`,'',
            `[🍎 Apple 地图](${links.apple})`,'');
        }else{lines.push('⚠️ 发起人未分享位置','');}
        lines.push('**请点击下方确认链接，告知对方你已收到通知。**');
        insert.run(id,hash(ownerToken),hash(pollToken),text,location?JSON.stringify(location):null,now,now+3600000);
        try{
          const channels=await notifyChannels({title:'🚗 MoveCar · 有人请求挪车',message:lines.join('\n'),ownerUrl,richMarkdown:true});
          grantInsert.run(hash(photoToken),id,Date.now()+20*60000);
          if(seconds>0)ratePut.run(addr,Date.now()+seconds*1000);
          json(res,200,{success:true,requestId:id,pollToken,photoToken,channels});return true;
        }catch(e){
          remove.run(id);
          throw e;
        }
      }
      if(route==='/api/photo'){
        if(method!=='POST')return reply(res,405,'Method not allowed'),true;
        if(req.headers['content-type']!=='image/jpeg')return json(res,415,{error:'仅接受 JPEG 照片'}),true;
        const token=req.headers['x-photo-token'];
        if(!isToken(token))return deny(res,403),true;
        const grant=grantSelect.get(hash(token),Date.now());
        if(!grant)return deny(res,403),true;
        const record=byId.get(grant.request_id,Date.now());
        if(!record||record.photo_sent)return json(res,409,{error:'照片已发送或请求已过期'}),true;
        const bytes=await inputPhoto(req);
        const photoId=random(),imageUrl=`${origin}/api/photo/${photoId}`;
        insertPhoto.run(photoId,bytes,Date.now()+3600000);
        const message=`## 📷 挪车现场照片\n\n![现场照片](${imageUrl})\n\n[点击查看原图](${imageUrl})`;
        const ownerUrl=`${origin}/owner-confirm/${ownerTokenFor(record.id)}`;
        try{
          await notifyChannels({title:'📷 MoveCar · 现场照片',message,ownerUrl,richMarkdown:true});
          if(photoUsed.run(record.id,Date.now()).changes===1)dropGrant.run(hash(token));
          json(res,200,{success:true,photoUrl:imageUrl});return true;
        }catch(e){
          json(res,502,{error:'照片已保存但推送失败，请稍后重试'});return true;
        }
      }
      return false;
    }
  };
}
