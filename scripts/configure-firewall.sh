#!/usr/bin/env bash
# Idempotently open ONLY coturn listening and relay ports on supported host firewalls.
# 1Panel or any other HTTPS reverse proxy ports are not touched.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$ROOT/data/turn/firewall-status.json"
mkdir -p "$(dirname "$STATE")"
msg='';manager='none';ok=true
firewallcmd() {
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active';then
    manager=ufw
    for p in 3478/udp 3478/tcp 5349/tcp 49160:49191/udp;do
      ufw allow "$p" >/dev/null || return 1
    done
  elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1;then
    manager=firewalld
    for p in 3478/udp 3478/tcp 5349/tcp 49160-49191/udp;do
      firewall-cmd --permanent --add-port="$p" >/dev/null || return 1
    done
    firewall-cmd --reload >/dev/null || return 1
  elif command -v iptables >/dev/null 2>&1 && iptables -S INPUT 2>/dev/null | grep -Eq '(^-P INPUT (DROP|REJECT)|^-A INPUT.*-j (DROP|REJECT))';then
    manager=iptables
    for rule in 'udp 3478:3478' 'tcp 3478:3478' 'tcp 5349:5349' 'udp 49160:49191';do
      read -r proto ports <<<"$rule"
      if ! iptables -C INPUT -p "$proto" --dport "$ports" -m comment --comment 'MoveCar TURN' -j ACCEPT >/dev/null 2>&1;then
        iptables -I INPUT 1 -p "$proto" --dport "$ports" -m comment --comment 'MoveCar TURN' -j ACCEPT || return 1
      fi
    done
    msg='iptables rules applied (runtime only; persist with your firewall manager)'
  elif command -v nft >/dev/null 2>&1 && nft list ruleset 2>/dev/null | grep -Eq '(hook input|policy drop)';then
    manager=unmanaged-nft
    ok=false
    msg='Detected active nftables rules; automatic edits to unknown custom chains are unsafe. Configure your firewall panel to allow TURN ports.'
  else
    manager=inactive-or-unknown
    msg='No supported active host firewall found; hosting-provider security group still needs TURN openings.'
  fi
}
if ! firewallcmd;then ok=false;msg='Could not apply all TURN firewall rules; check firewall permissions';fi
export MC_FW_MANAGER="$manager" MC_FW_OK="$ok" MC_FW_MSG="$msg" MC_FW_STATE="$STATE"
python3 - <<'PY'
import json,os,tempfile
p=os.environ['MC_FW_STATE']
x={'manager':os.environ['MC_FW_MANAGER'],'automatic':os.environ['MC_FW_OK']=='true',
   'message':os.environ['MC_FW_MSG'],'udpPorts':'3478,49160-49191','tcpPorts':'3478,5349'}
fd,tmp=tempfile.mkstemp(prefix='.firewall-',dir=os.path.dirname(p))
try:
 with os.fdopen(fd,'w') as f:json.dump(x,f)
 os.chmod(tmp,0o600)
 os.chown(tmp,1000,1000)
 os.replace(tmp,p)
finally:
 if os.path.exists(tmp):os.unlink(tmp)
print('Host firewall:',x['manager'],'status:',x['message'] or 'TURN port rules checked/applied')
PY
if [[ "$ok" != true ]];then exit 1;fi
