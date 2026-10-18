#!/usr/bin/env python3
"""Host-side, privileged read-only certificate discovery for TURN.
Configured by the authenticated MoveCar admin; never exposed as web shell.
Reads host PEM files only, writes a private copy to coturn's mounted TLS dir.
Can run under systemd/cron; credentials are never returned to a browser.
"""
import json, os, pathlib, subprocess, sys, time, tempfile, hashlib

root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/opt/movecar').resolve()
runtime=root/'data/turn'
request=runtime/'cert-source.json'
status=runtime/'cert-sync-status.json'
tls=runtime/'tls'
tls.mkdir(parents=True,exist_ok=True)
os.chmod(tls,0o700)

def result(ok,message,mode='none',directory=''):
    payload={'ok':ok,'message':message,'mode':mode,'directory':directory,'checkedAt':int(time.time()*1000)}
    fd,tmp=tempfile.mkstemp(prefix='.certstatus-',dir=runtime)
    with os.fdopen(fd,'w') as f:json.dump(payload,f,ensure_ascii=False)
    os.chmod(tmp,0o600);os.chown(tmp,1000,1000);os.replace(tmp,status)

def validpair(directory,domain):
    bases=(('fullchain.pem','privkey.pem'),('fullchain.cer','privkey.key'),('cert.pem','privkey.pem'),
        ('fullchain.crt','privkey.key'),('fullchain.pem','key.pem'))
    for c,k in bases:
        cert=directory/c;key=directory/k
        if not(cert.is_file() and key.is_file()):continue
        try:
            proc=subprocess.run(['openssl','x509','-in',str(cert),'-noout','-checkhost',domain],
                capture_output=True,text=True,timeout=5)
            if proc.returncode or 'does match' not in proc.stdout:continue
            if subprocess.run(['openssl','x509','-in',str(cert),'-noout','-checkend','86400'],
                              stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:continue
            pub1=subprocess.check_output(['openssl','x509','-in',str(cert),'-pubkey','-noout'],stderr=subprocess.DEVNULL)
            pub2=subprocess.check_output(['openssl','pkey','-in',str(key),'-pubout'],stderr=subprocess.DEVNULL)
            if hashlib.sha256(pub1).digest()!=hashlib.sha256(pub2).digest():continue
            if cert.stat().st_size>50000 or key.stat().st_size>50000:continue
            return cert,key
        except (OSError,subprocess.SubprocessError):continue
    return None

try:
    if not request.is_file():sys.exit(0)
    cfg=json.loads(request.read_text())
    mode=cfg.get('mode','none')
    domain=cfg.get('turnHost','')
    if mode not in ('auto','directory') or not isinstance(domain,str) or not domain:
        result(False,'证书目录尚未配置',mode);sys.exit(0)
    candidates=[]
    if mode=='directory':
        val=cfg.get('directory','')
        if not isinstance(val,str) or not val.startswith('/') or len(val)>1024:
            raise ValueError('证书目录必须是服务器上的绝对路径')
        d=pathlib.Path(val).resolve()
        if not d.is_dir() or d.as_posix() in ('/','/proc','/sys','/dev','/run'):
            raise ValueError('找不到有效的证书目录')
        candidates=[d]
    else:
        roots=['/www/sites','/opt/1panel','/etc/letsencrypt/live','/etc/ssl','/usr/local/etc','/www/server/panel']
        for base in roots:
            base=pathlib.Path(base)
            if not base.is_dir():continue
            scanned=0
            for d,dirs,files in os.walk(base,followlinks=False):
                scanned+=1
                if scanned>1200:break
                depth=len(pathlib.Path(d).relative_to(base).parts)
                if depth>7:dirs[:]=[];continue
                dirs[:]=[x for x in dirs if not x.startswith('.')]
                if 'fullchain.pem' in files or 'fullchain.cer' in files or 'cert.pem' in files:
                    candidates.append(pathlib.Path(d))
    found=None
    for d in candidates:
        pair=validpair(d,domain)
        if pair:found=(d,pair);break
    if not found:
        result(False,'未发现与 TURN 域名匹配的有效证书/私钥；可填写网站证书目录或手动上传',mode)
        sys.exit(0)
    directory,(cert,key)=found
    contents=[cert.read_bytes(),key.read_bytes()]
    old=[tls/'fullchain.pem',tls/'privkey.pem']
    changed=any(not p.is_file() or p.read_bytes()!=v for p,v in zip(old,contents))
    if changed:
        for dst,value in zip(old,contents):
            fd,tmp=tempfile.mkstemp(prefix='.pem-',dir=tls)
            with os.fdopen(fd,'wb') as f:f.write(value)
            os.chmod(tmp,0o600);os.chown(tmp,1000,1000);os.replace(tmp,dst)
    result(True,('证书已同步并自动监测续期' if changed else '证书有效，监测续期中'),mode,str(directory))
except Exception as e:
    # Do not leak private key contents or arbitrary filesystem details.
    result(False,'证书读取失败：'+str(e)[:140])
    sys.exit(1)
