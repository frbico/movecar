#!/usr/bin/env python3
"""Private host-side TURN connectivity probe for the authenticated onboarding wizard."""
import json, os, pathlib, subprocess, sys, tempfile, time
root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/opt/movecar').resolve()
runtime=root/'data/turn'
state=runtime/'host-health-status.json'
request=runtime/'cert-source.json'
if not request.is_file():sys.exit(0)
try:
 cfg=json.loads(request.read_text())
 host=cfg.get('turnHost','')
 if not isinstance(host,str) or not host or len(host)>250:sys.exit(0)
 tls=all((runtime/'tls'/name).is_file() for name in ('fullchain.pem','privkey.pem'))
 cmd=['python3',str(root/'scripts/turn-probe.py'),'--host',host,
      '--connect-ip','127.0.0.1','--secret-env-file',str(root/'.env')]
 if not tls:cmd.append('--no-tls')
 res=subprocess.run(cmd,capture_output=True,text=True,timeout=24)
 output=(res.stdout+' '+res.stderr)
 status={'turnHost':host,'ok':res.returncode==0,
         'udpAllocation':res.returncode==0,
         'tlsChecked':tls,'message':('TURN UDP 鉴权分配'+('及 TLS '+'5349 ' if tls else '')+'测试通过' if res.returncode==0
          else ('本机 TURN 检测未通过：'+('TLS 验证失败' if 'TLS' in output else '请查看 coturn 容器运行状态或鉴权配置'))),
         'checkedAt':int(time.time()*1000)}
except Exception:
 status={'turnHost':'','ok':False,'message':'检测进程异常，请运行 scripts/check-portable.sh','checkedAt':int(time.time()*1000)}
runtime.mkdir(parents=True,exist_ok=True)
fd,tmp=tempfile.mkstemp(prefix='.hosthealth-',dir=runtime)
try:
 with os.fdopen(fd,'w') as f:json.dump(status,f,ensure_ascii=False)
 os.chmod(tmp,0o600);os.chown(tmp,1000,1000);os.replace(tmp,state)
finally:
 if os.path.exists(tmp):os.unlink(tmp)
