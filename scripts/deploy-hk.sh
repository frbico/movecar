#!/usr/bin/env bash
# Deploy MoveCar + TURN on a 1Panel-managed Hong Kong VPS.
# 1Panel remains the ONLY HTTPS reverse proxy/certificate issuer.
set -Eeuo pipefail
usage(){
cat <<'HELP'
Usage (sudo/root on the 1Panel Hong Kong server):
  bash scripts/deploy-hk.sh --site movecar.ssxi.de --turn turn.ssxi.de \
    --firebase-key /path/firebase-service-account.json \
    --tls-cert /path/1panel/fullchain.pem --tls-key /path/1panel/privkey.pem

Optional:
  --import-db /path/movecar-transfer.sqlite   Import Tokyo database ONCE into an empty volume
  --public-ip 1.2.3.4                          Override detected public IPv4
  --no-firewall                                Leave host firewall unchanged
  --help

TLS certificate arguments are optional. Without them, UDP/TCP TURN on port
3478 will work, but TURN/TLS 5349 fallback is disabled. Existing 1Panel
certificate paths are remembered and reused across redeploys.
No Caddy/Nginx installation. NO modification to 1Panel's reverse proxies,
websites, certificates or other 1Panel resources.
HELP
}
SITE='' TURN='' KEY='' IMPORT='' IP_OVERRIDE='' CERT='' PKEY='' FIREWALL=1
while (($#));do
 case "$1" in
   --site) SITE="${2:?Missing domain}";shift 2;;
   --turn) TURN="${2:?Missing TURN hostname}";shift 2;;
   --firebase-key) KEY="${2:?Missing Firebase file}";shift 2;;
   --import-db) IMPORT="${2:?Missing SQLite backup}";shift 2;;
   --public-ip) IP_OVERRIDE="${2:?Missing IP}";shift 2;;
   --tls-cert) CERT="${2:?Missing certificate path}";shift 2;;
   --tls-key) PKEY="${2:?Missing private key path}";shift 2;;
   --no-firewall) FIREWALL=0;shift;;
   -h|--help) usage;exit 0;;
   *) echo "Unknown parameter: $1" >&2;usage;exit 2;;
 esac
done
die(){ echo "ERROR: $*" >&2;exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "Please use sudo (required for TURN host networking and UFW)."
[[ "$(uname -s)" == Linux ]] || die "Linux is required"
for cmd in docker python3 openssl curl ip getent awk sed realpath ss;do
  command -v "$cmd" >/dev/null || die "Missing command: $cmd"
done
docker compose version >/dev/null || die "Docker Compose V2 required"
docker network inspect 1panel-network >/dev/null 2>&1 ||
  die "1panel-network not found; install/start the 1Panel OpenResty application first."
validate_host(){
 python3 - "$1" <<'PY'
import re,sys
s=sys.argv[1]
assert len(s)<=253 and '.' in s and all(re.fullmatch('[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?',x) for x in s.split('.')), 'Invalid hostname'
PY
}
validate_host "$SITE";validate_host "$TURN"
[[ "$SITE" != "$TURN" ]] || die "Site and TURN need separate DNS names (same IP is OK)."
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"
[[ -f compose.yaml && -f compose.hk.yaml ]] || die "Not a full MoveCar checkout"
[[ ! "$ROOT" =~ [[:space:]] ]] || die "MoveCar checkout path cannot contain spaces (Docker Compose limitation)"
umask 077
mkdir -p deployment/onepanel data/onepanel/turn-tls
[[ -n "$KEY" ]] && { [[ -f "$KEY" ]] || die "Firebase JSON missing"; KEY="$(realpath "$KEY")"; }
[[ -n "$IMPORT" ]] && { [[ -f "$IMPORT" ]] || die "SQLite file missing"; IMPORT="$(realpath "$IMPORT")"; }
[[ -n "$CERT" ]] && { [[ -f "$CERT" ]] || die "1Panel certificate file missing"; CERT="$(realpath "$CERT")"; }
[[ -n "$PKEY" ]] && { [[ -f "$PKEY" ]] || die "1Panel private key file missing"; PKEY="$(realpath "$PKEY")"; }
[[ -n "$CERT" && -z "$PKEY" || -z "$CERT" && -n "$PKEY" ]] &&
  die "--tls-cert and --tls-key must both be specified"
if [[ -n "$KEY" ]];then
 python3 - "$KEY" <<'PY'
import json,sys
with open(sys.argv[1],encoding='utf-8') as f: a=json.load(f)
assert a.get('type')=='service_account' and a.get('private_key','').startswith('-----BEGIN PRIVATE KEY-----')
assert a.get('project_id') and a.get('client_email')
print("PASS Firebase service account syntax")
PY
fi
if [[ -n "$IMPORT" ]];then
 python3 - "$IMPORT" <<'PY'
import sqlite3,sys
c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
try:
 assert c.execute('PRAGMA quick_check').fetchone()[0]=='ok'
 assert c.execute("SELECT name FROM sqlite_master WHERE name='settings'").fetchone()
finally:c.close()
print('PASS Imported SQLite database integrity')
PY
fi
if [[ -n "$IP_OVERRIDE" ]];then PUBLIC_IP="$IP_OVERRIDE"
else PUBLIC_IP="$(curl -4fsS --max-time 10 https://api.ipify.org)" ||
  die "Cannot detect public IPv4; retry with --public-ip"
fi
python3 - "$PUBLIC_IP" <<'PY'
import ipaddress,sys
x=ipaddress.ip_address(sys.argv[1]);assert x.version==4 and x.is_global
PY
LOCAL_IP="$(ip -4 route get 1.1.1.1 | sed -n 's/.* src \([0-9.]\+\).*/\1/p' | head -1)"
[[ -n "$LOCAL_IP" ]] || die "Cannot detect local IPv4"
EXTERNAL_IP="$PUBLIC_IP"
if [[ "$LOCAL_IP" != "$PUBLIC_IP" ]];then
 EXTERNAL_IP="$PUBLIC_IP/$LOCAL_IP"
 echo "NOTICE: VPS is NATed; cloud firewall must forward 3478/5349/UDP relay ports 1:1."
fi
TURN_IP="$(getent ahostsv4 "$TURN" | awk 'NR==1{print $1}')"
[[ "$TURN_IP" == "$PUBLIC_IP" ]] ||
  die "TURN A record must point DIRECTLY to the server IP $PUBLIC_IP (currently '$TURN_IP'). Configure DNS-only, not HTTP proxy."
# Do not fight 1Panel's 80/443 website listener.
if [[ -n "$(ss -H -ltn 'sport = :3478')" || -n "$(ss -H -lun 'sport = :3478')" ||
      -n "$(ss -H -ltn 'sport = :5349')" ]];then
  docker container inspect movecar-hk-turn >/dev/null 2>&1 ||
    die "3478/5349 is already used by another service"
fi

# Ensure .env additions are idempotent: keep all other passwords and settings.
touch .env;chmod 600 .env
export MC_SITE="$SITE" MC_TURN="$TURN" MC_CERT="$CERT" MC_PKEY="$PKEY"
python3 - <<'PY'
import os,secrets
from pathlib import Path
p=Path('.env'); lines=p.read_text().splitlines()
old={}
for line in lines:
 if '=' in line and not line.strip().startswith('#'):
  k,v=line.split('=',1); old[k.strip()]=v.strip().strip('"').strip("'")
site=os.environ['MC_SITE'];turn=os.environ['MC_TURN']
cert=os.environ['MC_CERT'] or old.get('ONEPANEL_TLS_CERT','')
key=os.environ['MC_PKEY'] or old.get('ONEPANEL_TLS_KEY','')
if bool(cert)!=bool(key):raise SystemExit('ERROR: existing TLS cert/key fields must both exist')
if cert:
 for path in (cert,key):
  if not Path(path).is_file():raise SystemExit('ERROR: 1Panel certificate path no longer exists: '+path)
  if any(x in path for x in ('\n','\r',"'",'"','#',' ')):raise SystemExit('ERROR: use TLS file paths without spaces/quotes')
secret=old.get('VOICE_TURN_SHARED_SECRET') or secrets.token_hex(32)
if not len(secret)==64 or any(c not in '0123456789abcdef' for c in secret):
 raise SystemExit('ERROR: existing VOICE_TURN_SHARED_SECRET must be 64 lowercase hex chars')
updates={
 'HOST_BIND':'127.0.0.1','HOST_PORT':'8888',
 'VOICE_PAIRING_SECRET':old.get('VOICE_PAIRING_SECRET') or secrets.token_hex(32),
 'VOICE_STUN_URLS':f'stun:{turn}:3478',
 'VOICE_TURN_URLS':f'turn:{turn}:3478?transport=udp,turn:{turn}:3478?transport=tcp'+
   (f',turns:{turn}:5349?transport=tcp' if cert else ''),
 'VOICE_TURN_SHARED_SECRET':secret,
 'HK_SITE_DOMAIN':site,'HK_TURN_DOMAIN':turn,
 'ONEPANEL_TLS_CERT':cert,'ONEPANEL_TLS_KEY':key}
out=[];done=set()
for line in lines:
 k=line.split('=',1)[0].strip() if '=' in line and not line.lstrip().startswith('#') else ''
 if k in updates:
  if k not in done:out.append(k+'='+updates[k]);done.add(k)
 else:out.append(line)
for k,v in updates.items():
 if k not in done:out.append(k+'='+v)
p.write_text('\n'.join(out).rstrip()+'\n')
print('PASS saved site/TURN addresses and credentials; 1Panel certificate settings are reused.')
PY
# Read env fields without sourcing untrusted shell code.
TURN_SECRET="$(sed -n 's/^VOICE_TURN_SHARED_SECRET=//p' .env | tail -1)"
TLS_CERT="$(sed -n 's/^ONEPANEL_TLS_CERT=//p' .env | tail -1)"
TLS_KEY="$(sed -n 's/^ONEPANEL_TLS_KEY=//p' .env | tail -1)"
TLS=0
if [[ -n "$TLS_CERT" && -n "$TLS_KEY" ]];then
 TLS=1
 bash scripts/sync-turn-cert.sh "$ROOT" "$TURN" --no-restart
fi
cat > deployment/onepanel/turnserver.conf <<EOF
fingerprint
use-auth-secret
static-auth-secret=$TURN_SECRET
realm=$TURN
server-name=$TURN
listening-port=3478
tls-listening-port=5349
external-ip=$EXTERNAL_IP
min-port=49160
max-port=49260
no-loopback-peers
no-multicast-peers
no-cli
stale-nonce=600
user-quota=12
total-quota=100
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
EOF
if (( TLS ));then
 cat >> deployment/onepanel/turnserver.conf <<'EOF'
cert=/etc/coturn/tls/fullchain.pem
pkey=/etc/coturn/tls/privkey.pem
no-tlsv1
no-tlsv1_1
no-dtls
EOF
else
 cat >> deployment/onepanel/turnserver.conf <<'EOF'
no-tls
no-dtls
EOF
 echo "NOTICE: 1Panel TLS files not specified; TURN 3478 works, but TLS 5349 fallback is disabled."
 echo "Later rerun the installer with --tls-cert and --tls-key for better restrictive-network fallback."
fi
chown 0:65534 deployment/onepanel/turnserver.conf data/onepanel/turn-tls
chmod 0640 deployment/onepanel/turnserver.conf
chmod 0750 data/onepanel/turn-tls

# Only host firewall ports for TURN; 1Panel already manages 80/443 HTTPS.
if (( FIREWALL ));then
 if command -v ufw >/dev/null && ufw status | grep -q 'Status: active';then
  ufw allow 3478/tcp >/dev/null;ufw allow 3478/udp >/dev/null
  if (( TLS ));then ufw allow 5349/tcp >/dev/null;fi
  ufw allow 49160:49260/udp >/dev/null
  echo "PASS host UFW rules applied. VPS cloud security group must also allow TURN ports."
 elif command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1;then
  firewall-cmd --permanent --add-port=3478/tcp >/dev/null
  firewall-cmd --permanent --add-port=3478/udp >/dev/null
  if (( TLS ));then firewall-cmd --permanent --add-port=5349/tcp >/dev/null;fi
  firewall-cmd --permanent --add-port=49160-49260/udp >/dev/null
  firewall-cmd --reload >/dev/null
  echo "PASS firewalld TURN ports opened."
 else
  echo "NOTICE: no active supported host firewall; check 1Panel firewall and VPS provider security group."
 fi
fi

bash scripts/fetch-upstream.sh
COMPOSE=(docker compose -f compose.yaml -f compose.hk.yaml)
"${COMPOSE[@]}" config --quiet
if [[ -n "$IMPORT" ]];then
 # Only import before first start into a truly empty database volume.
 "${COMPOSE[@]}" build movecar
 "${COMPOSE[@]}" create --no-recreate movecar
 if ! docker run --rm --user 0:0 --volumes-from movecar node:24-alpine \
     sh -ec 'test ! -e /app/data/state.sqlite';then
  die "Database already exists; refusing to overwrite. Back up/migrate separately."
 fi
 docker run --rm --user 0:0 --volumes-from movecar \
    -v "$(dirname "$IMPORT"):/migration:ro" node:24-alpine \
    sh -ec 'cp "/migration/$1" /app/data/state.sqlite; chown node:node /app/data/state.sqlite; chmod 600 /app/data/state.sqlite' \
    sh "$(basename "$IMPORT")"
 echo "PASS imported Tokyo accounts/settings/history"
fi
"${COMPOSE[@]}" up -d --build movecar coturn
if [[ -n "$KEY" ]];then
 docker cp "$KEY" movecar:/app/data/firebase-service-account.json
 docker exec -u root movecar sh -c 'chown node:node /app/data/firebase-service-account.json && chmod 600 /app/data/firebase-service-account.json'
 "${COMPOSE[@]}" restart movecar
else
 docker exec movecar test -s /app/data/firebase-service-account.json ||
   die "FCM service account not found. Provide --firebase-key on first deployment."
fi
READY=0
for _ in $(seq 1 40);do
 if curl -fsS --noproxy '*' --max-time 5 http://127.0.0.1:8888/healthz >/dev/null 2>&1;then READY=1;break;fi
 sleep 2
done
if (( ! READY ));then "${COMPOSE[@]}" logs --tail=75 movecar;die "MoveCar health check failed";fi
# Ensure new-domain QR/owner URLs point at the selected HTTPS name.
docker exec -e NEXT_PUBLIC_URL="https://$SITE" movecar node -e '
const {DatabaseSync}=require("node:sqlite");
const db=new DatabaseSync("/app/data/state.sqlite");
db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
.run("public_url",process.env.NEXT_PUBLIC_URL);
db.close();
'
echo "PASS MoveCar local HTTPS reverse-proxy target: http://127.0.0.1:8888"
python3 scripts/turn-probe.py --host "$TURN" --connect-ip 127.0.0.1 \
  --secret-env-file .env $([[ "$TLS" -eq 0 ]] && echo --no-tls)

# The ONLY certificate lifecycle management is 1Panel; timer merely reloads
# coturn when the 1Panel-managed PEM files change.
if (( TLS )) && command -v systemctl >/dev/null && [[ -d /run/systemd/system ]];then
 cat > /etc/systemd/system/movecar-onepanel-turn-cert.service <<EOF
[Unit]
Description=Reload coturn after 1Panel renews existing wildcard TLS certificate
Requires=docker.service
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/bin/bash $ROOT/scripts/sync-turn-cert.sh $ROOT $TURN
EOF
 cat > /etc/systemd/system/movecar-onepanel-turn-cert.timer <<EOF
[Unit]
Description=Check 1Panel TURN certificate changes hourly
[Timer]
OnBootSec=10min
OnUnitActiveSec=1h
Persistent=true
Unit=movecar-onepanel-turn-cert.service
[Install]
WantedBy=timers.target
EOF
 systemctl daemon-reload
 systemctl enable --now movecar-onepanel-turn-cert.timer >/dev/null
fi
echo
echo "✅ MoveCar + coturn deployed. 1Panel remains the website/HTTPS/certificate manager."
echo "Website hostname: $SITE"
echo "TURN hostname: $TURN"
echo "TURN UDP/TCP: 3478; TURN TLS TCP: $([[ "$TLS" -eq 1 ]] && echo enabled || echo disabled)"
echo "No server-admin or Firebase password was printed."
echo
echo "1Panel -> Websites -> Reverse Proxy -> domain $SITE"
echo "Use URL http://127.0.0.1:8888 if OpenResty uses HOST network."
echo "Use URL http://movecar:8888 if OpenResty is on 1panel-network."
echo "Reuse your existing wildcard certificate and HTTPS setting."
echo "Only the WEBSITE needs reverse proxy. TURN domain is DNS-only to the same public IP."
echo "Next: bash scripts/check-hk.sh"
