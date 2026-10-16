import { WebSocketServer, WebSocket } from 'ws';
import { qrcodegen } from './vendor/qrcodegen.js';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ID = TOKEN;
const PAIR_LIFETIME_MS = 5 * 60_000;

export function createAppChannel({db, random, hash, json, reply, inputJson, getFlow}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_pairings (
      digest TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_devices (
      id TEXT PRIMARY KEY,
      credential_digest TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('xiaomi','samsung')),
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS app_pairings_exp ON app_pairings(expires_at);
  `);
  const listeners = new Map();
  const byCredential = db.prepare('SELECT id,name,platform FROM app_devices WHERE credential_digest=?');
  const touch = db.prepare('UPDATE app_devices SET last_seen_at=? WHERE id=?');
  const devices = db.prepare('SELECT id,name,platform,created_at,last_seen_at FROM app_devices ORDER BY created_at');
  const sendTargets = db.prepare('SELECT id FROM app_devices');
  const pairInsert = db.prepare('INSERT INTO app_pairings(digest,expires_at) VALUES(?,?)');
  const pairUse = db.prepare('DELETE FROM app_pairings WHERE digest=? AND expires_at>? RETURNING digest');
  const deviceInsert = db.prepare('INSERT INTO app_devices(id,credential_digest,name,platform,created_at,last_seen_at) VALUES(?,?,?,?,?,?)');
  const deviceDelete = db.prepare('DELETE FROM app_devices WHERE id=?');
  const photoGet = db.prepare('SELECT p.data,p.mime FROM move_request_photos a JOIN photo_records p ON p.id=a.photo_id WHERE a.request_id=? AND p.expiry>?');
  const websocketServer = new WebSocketServer({noServer:true,maxPayload:1024,perMessageDeflate:false});
  function emit(deviceId,event) {
    const streams = listeners.get(deviceId);
    if (!streams?.size) return false;
    const packet = JSON.stringify({type:event.type,id:event.id||'',title:event.title,summary:event.summary});
    let delivered = false;
    for (const ws of streams) {
      if (ws.readyState!==WebSocket.OPEN) {streams.delete(ws);continue;}
      try {ws.send(packet); delivered=true;} catch {streams.delete(ws);ws.terminate();}
    }
    return delivered;
  }
  async function notify(event) {
    const targets = sendTargets.all();
    const results = await Promise.allSettled(targets.map(async device => {
      if (!emit(device.id,event)) throw Error('设备未连接');
    }));
    if (!results.some(r=>r.status==='fulfilled')) throw Error('没有可用的安卓接收设备');
    return {delivered:results.filter(r=>r.status==='fulfilled').length,targets:targets.length};
  }
  function broadcast(event) {
    for (const device of sendTargets.all()) emit(device.id,event);
  }
  function auth(req) {
    const raw = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(String(req.headers.authorization||''));
    if (!raw) return null;
    const device = byCredential.get(hash(raw[1]));
    if (device) touch.run(Date.now(),device.id);
    return device||null;
  }
  function listDevices() {
    return devices.all().map(d=>({...d,connected:[...(listeners.get(d.id)||[])].some(ws=>ws.readyState===WebSocket.OPEN)}));
  }
  async function createPairing(origin) {
    const code = random();
    pairInsert.run(hash(code),Date.now()+PAIR_LIFETIME_MS);
    const uri = `movecar://pair?server=${encodeURIComponent(origin)}&code=${encodeURIComponent(code)}`;
    const qr=qrcodegen.QrCode.encodeText(uri,qrcodegen.QrCode.Ecc.MEDIUM);
    const cells=[];
    for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.getModule(x,y))cells.push(`<rect x="${x+4}" y="${y+4}" width="1" height="1"/>`);
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${qr.size+8} ${qr.size+8}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><g fill="black">${cells.join('')}</g></svg>`;
    return {qrDataUrl:'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64'),pairingUri:uri,expiresAt:Date.now()+PAIR_LIFETIME_MS};
  }
  function revoke(id) {
    const changed=deviceDelete.run(id).changes;
    for (const ws of listeners.get(id)||[]) ws.close(1008,'device revoked');
    listeners.delete(id);
    return !!changed;
  }
  function cleanup() {db.prepare('DELETE FROM app_pairings WHERE expires_at<=?').run(Date.now());}

  async function handle(req,res,u) {
    const route=u.pathname,method=req.method;
    if (route==='/api/app/pair' && method==='POST') {
      const body=await inputJson(req);
      if (!TOKEN.test(body.code||'') || !['xiaomi','samsung'].includes(body.platform) || typeof body.name!=='string' || !body.name.trim() || body.name.length>60)
        return json(res,400,{error:'配对信息无效'}),true;
      if (!pairUse.get(hash(body.code),Date.now())) return json(res,410,{error:'二维码已失效，请重新生成'}),true;
      const id=random(),credential=random(),now=Date.now();
      deviceInsert.run(id,hash(credential),body.name.trim(),body.platform,now,now);
      return json(res,200,{deviceId:id,credential}),true;
    }
    if (!route.startsWith('/api/app/')) return false;
    const device=auth(req);
    if (!device) return json(res,401,{error:'设备未绑定或已解绑'}),true;
    if (route==='/api/app/device' && method==='GET') return json(res,200,{id:device.id,name:device.name,platform:device.platform}),true;
    if (route==='/api/app/requests' && method==='GET') {
      const page=Number(u.searchParams.get('page')||'1'),size=Number(u.searchParams.get('size')||'20');
      if (!Number.isInteger(page)||page<1||page>9999||!Number.isInteger(size)||size<1||size>100) return json(res,400,{error:'分页参数无效'}),true;
      return json(res,200,getFlow().listHistory(page,size)),true;
    }
    const match=/^\/api\/app\/requests\/([A-Za-z0-9_-]{43})(?:\/(confirm|photo))?$/.exec(route);
    if (match) {
      const id=match[1],action=match[2];
      if (!action && method==='GET') {
        const record=getFlow().appGet(id);
        return json(res,record?200:404,record||{error:'记录不存在'}),true;
      }
      if (action==='confirm' && method==='POST') {
        const result=getFlow().appConfirm(id);
        if (!result) return json(res,410,{error:'请求已过期或不存在'}),true;
        broadcast({type:'confirmed',id,title:'MoveCar',summary:'车主已确认'});
        return json(res,200,{ok:true,status:'confirmed'}),true;
      }
      if (action==='photo' && method==='GET') {
        const photo=photoGet.get(id,Date.now());
        if (!photo || !getFlow().appGet(id)) return reply(res,404,'照片不存在或已过期'),true;
        return reply(res,200,photo.data,{'Content-Type':photo.mime,'Cache-Control':'private, no-store'}),true;
      }
    }
    return json(res,404,{error:'接口不存在'}),true;
  }
  function upgrade(req,socket,head) {
    let route;
    try {route=new URL(req.url,'http://localhost').pathname;} catch {socket.destroy();return;}
    if (route!=='/api/app/events') {socket.destroy();return;}
    const device=auth(req);
    if (!device) {socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}
    websocketServer.handleUpgrade(req,socket,head,ws=>{
      const group=listeners.get(device.id)||new Set();group.add(ws);listeners.set(device.id,group);
      ws.isAlive=true;
      ws.on('pong',()=>{ws.isAlive=true;touch.run(Date.now(),device.id);});
      ws.on('close',()=>{group.delete(ws);if(!group.size)listeners.delete(device.id);});
      ws.on('message',()=>ws.close(1008,'read only'));
      ws.send(JSON.stringify({type:'connected'}));
    });
  }
  const heartbeat=setInterval(()=>{
    for(const group of listeners.values())for(const ws of group){
      if(!ws.isAlive){ws.terminate();continue;}
      ws.isAlive=false;ws.ping();
    }
  },20_000).unref();
  function close(){clearInterval(heartbeat);for(const group of listeners.values())for(const ws of group)ws.terminate();websocketServer.close();}
  return {handle,auth,notify,broadcast,createPairing,listDevices,revoke,cleanup,upgrade,close};
}
