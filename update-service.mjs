import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const REPOSITORY='frbico/movecar';
const CHANNEL='release/stable';
const COMMIT_URL='https://api.github.com/repos/'+REPOSITORY+'/commits/'+CHANNEL;
const safeRead=(file)=>{
  try {const stat=fs.statSync(file);if(stat.size>20000)return null;
    return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}
};
const err=(text,status=400)=>Object.assign(new Error(text),{status});
const hashRegex=/^[a-f0-9]{40}$/;

export function createUpdateService({
  runtimeDir=process.env.MOVECAR_RUNTIME_DIR||'/app/runtime',
  localSha=process.env.MOVECAR_COMMIT_SHA||'',
  releasePath=path.resolve('./release.json'),
  fetcher=fetch
}={}){
  const statusFile=path.join(runtimeDir,'update-status.json');
  const requestFile=path.join(runtimeDir,'update-request.json');
  const current=safeRead(releasePath)||{version:'unknown',changes:[]};
  const version=()=>({version:String(current.version||'unknown'),sha:localSha||'',channel:'stable'});
  const status=()=>{
    const host=safeRead(statusFile)||{state:'not_configured',message:'等待安装程序安装后台更新助手'};
    return {...version(),host};
  };
  async function check(){
    // The release source and branch are pinned; no user-supplied URLs,
    // repositories, branches, or scripts are accepted.
    let response;
    try{response=await fetcher(COMMIT_URL,{
      headers:{'Accept':'application/vnd.github+json','User-Agent':'MoveCar-Updater'},
      signal:AbortSignal.timeout(9500)
    });}catch{throw err('无法连接 GitHub 检查更新，请稍后重试',503);}
    if(!response.ok)throw err('GitHub 更新检查失败：HTTP '+response.status,503);
    const item=await response.json();
    const sha=item?.sha;
    if(!hashRegex.test(sha||''))throw err('GitHub 返回的版本信息不正确',503);
    const raw='https://raw.githubusercontent.com/'+REPOSITORY+'/'+sha+'/release.json';
    let notes={};
    try{
      const r=await fetcher(raw,{headers:{'User-Agent':'MoveCar-Updater'},signal:AbortSignal.timeout(8500)});
      if(r.ok)notes=await r.json();
    }catch{}
    const textArray=Array.isArray(notes?.changes)?notes.changes.filter(x=>typeof x==='string').slice(0,10).map(x=>x.slice(0,180)):[];
    return {
      current:version(),latest:{sha,version:String(notes?.version||'latest').slice(0,36),
        changes:textArray,date:String(notes?.releasedAt||'').slice(0,24)},
      available:!!localSha&&sha!==localSha,
      needsVersionDetection:!localSha,
      host:status().host
    };
  }
  async function requestUpdate(sha){
    if(!hashRegex.test(sha||''))throw err('更新版本 ID 无效');
    const latest=await check();
    if(latest.latest.sha!==sha)throw err('发现更新版本已经变化，请重新检查后确认');
    if(localSha===sha)return {ok:false,message:'当前已经是最新版'};
    const prior=safeRead(requestFile);
    if(prior && Date.now()-(prior.createdAt||0)<20*60*1000)
      throw err('已经有更新任务等待执行，请查看升级状态',409);
    if(!fs.existsSync(runtimeDir))throw err('更新任务目录尚未配置，请先安装后台升级助手',503);
    const request={sha,channel:CHANNEL,id:crypto.randomUUID(),createdAt:Date.now()};
    const temp=path.join(runtimeDir,'.update-request-'+crypto.randomBytes(5).toString('hex'));
    try{
      fs.writeFileSync(temp,JSON.stringify(request),{mode:0o600,flag:'wx'});
      fs.renameSync(temp,requestFile);
    }finally{try{fs.unlinkSync(temp);}catch{}}
    return {ok:true,message:'已提交升级任务，请等待自动备份、部署和健康检查',requestId:request.id};
  }
  return {version,status,check,requestUpdate};
}
