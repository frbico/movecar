#!/usr/bin/env bash
# MoveCar + Caddy + coturn on ONE Hong Kong Linux VPS.
# DNS and a Firebase service-account JSON must be supplied by the owner.
set -Eeuo pipefail
usage() {
  cat <<'HELP'
Usage (root, on your HK Linux VPS):
  sudo bash scripts/deploy-hk.sh --site movecar.ssxi.de --turn turn.ssxi.de \
       --firebase-key /home/ubuntu/firebase-service-account.json

Optional: --public-ip X.X.X.X (if IP detection fails)
          --no-firewall (don't add UFW rules)
          --help
Requirements: Debian/Ubuntu x86_64/arm64, Docker Engine + Compose V2,
              DNS A records for both names, no other listener on host 80/443.
Does not overwrite MoveCar's existing SQLite data or Firebase secrets.
HELP
}
SITE='' TURN='' FIREBASE='' IP_OVERRIDE='' FIREWALL=1
while (($#)); do
  case "$1" in
    --site) SITE="${2:?Missing --site value}";shift 2;;
    --turn) TURN="${2:?Missing --turn value}";shift 2;;
    --firebase-key) FIREBASE="${2:?Missing --firebase-key path}";shift 2;;
    --public-ip) IP_OVERRIDE="${2:?Missing --public-ip value}";shift 2;;
    --no-firewall) FIREWALL=0;shift;;
    -h|--help) usage;exit 0;;
    *) echo "Unknown option: $1" >&2;usage;exit 2;;
  esac
done
error(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ "$(id -u)" == 0 ]] || error "Run with sudo; firewall and certificate timer need root."
[[ -f /etc/os-release ]] || error "Linux system required"
source /etc/os-release
[[ "$ID" == "ubuntu" || "$ID" == "debian" || "${ID_LIKE:-}" == *"debian"* ]] ||
  error "This one-click installer supports Ubuntu/Debian. Use manual deployment elsewhere."
[[ "$(uname -s)" == Linux ]] || error "Host-network coturn requires Linux"
for tool in docker curl openssl python3 getent find cmp install awk realpath ip sed;do
  command -v "$tool" >/dev/null 2>&1 || error "Missing prerequisite: $tool"
done
docker compose version >/dev/null 2>&1 || error "Docker Compose V2 is required."
command -v ss >/dev/null 2>&1 || error "Please install iproute2 (ss utility)."
validate_domain(){
  [[ "$1" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$ &&
     "$1" == *.* && "${#1}" -le 253 ]] || error "Invalid hostname: $1"
}
validate_domain "$SITE"
validate_domain "$TURN"
[[ "$SITE" != "$TURN" ]] || error "Site and TURN must use different hostnames."
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
[[ "$ROOT" != *" "* ]] || error "MoveCar project path cannot contain spaces."
[[ -f "$ROOT/compose.yaml" && -f "$ROOT/compose.hk.yaml" ]] ||
  error "Run this script from a complete MoveCar git checkout."
cd "$ROOT"
if [[ -n "$FIREBASE" ]];then
  [[ -f "$FIREBASE" ]] || error "Firebase key file not found: $FIREBASE"
  FIREBASE="$(realpath "$FIREBASE")"
  python3 - "$FIREBASE" <<'PY'
import json,sys
with open(sys.argv[1],encoding='utf-8') as f: a=json.load(f)
assert a.get('type')=='service_account' and a.get('private_key','').startswith('-----BEGIN PRIVATE KEY-----')
assert a.get('project_id') and a.get('client_email')
print('PASS Firebase account syntax; project:',a['project_id'])
PY
fi
if [[ -n "$IP_OVERRIDE" ]];then PUBLIC_IP="$IP_OVERRIDE"
else PUBLIC_IP="$(curl -4fsS --max-time 12 https://api.ipify.org)" ||
  error "Cannot detect server public IPv4. Retry with --public-ip A.B.C.D."
fi
python3 - "$PUBLIC_IP" <<'PY'
import ipaddress,sys
ip=ipaddress.ip_address(sys.argv[1])
assert ip.version==4 and ip.is_global, 'Expected a globally routable IPv4'
PY
TURN_IP="$(getent ahostsv4 "$TURN" | awk 'NR==1{print $1}')"
[[ "$TURN_IP" == "$PUBLIC_IP" ]] ||
  error "TURN DNS '$TURN' resolves to '$TURN_IP', but VPS public IP is '$PUBLIC_IP'. Point TURN A record directly to VPS IP (DNS only) before installation."
getent ahostsv4 "$SITE" >/dev/null ||
  error "HTTPS site hostname does not resolve yet: $SITE"
LOCAL_IP="$(ip -4 route get 1.1.1.1 | sed -n 's/.* src \([0-9.]\+\).*/\1/p' | head -1)"
[[ -n "$LOCAL_IP" ]] || error "Unable to discover primary local IPv4"
if [[ "$LOCAL_IP" == "$PUBLIC_IP" ]];then EXTERNAL_IP="$PUBLIC_IP"
else
  EXTERNAL_IP="$PUBLIC_IP/$LOCAL_IP"
  echo "NOTICE: VPS uses NAT ($LOCAL_IP -> $PUBLIC_IP); relay ports must map 1:1 at your cloud provider."
fi
# Prevent inadvertent port takeover of an unrelated existing reverse proxy.
if [[ -n "$(ss -H -ltn 'sport = :80')" || -n "$(ss -H -ltn 'sport = :443')" ]];then
  if ! docker container inspect movecar-hk-caddy >/dev/null 2>&1;then
    error "Port 80/443 is already in use. Stop the existing Caddy/Nginx on this HK VPS, or use manual integration; installer will not overwrite it."
  fi
fi
if [[ -n "$(ss -H -ltn 'sport = :3478')" || -n "$(ss -H -ltn 'sport = :5349')" ]];then
  if ! docker container inspect movecar-hk-turn >/dev/null 2>&1;then
    error "TURN ports 3478/5349 are already in use by another service."
  fi
fi

# Keep existing administrator credentials and data. Never rewrite the full .env.
umask 077
mkdir -p deployment/hk data/hk/caddy data/hk/caddy-config data/hk/turn-tls
chmod 0755 deployment/hk data/hk data/hk/caddy data/hk/caddy-config
touch .env
chmod 0600 .env
export MOVECAR_HK_SITE="$SITE" MOVECAR_HK_TURN="$TURN"
python3 - <<'PY'
import os,secrets
from pathlib import Path
p=Path('.env')
lines=p.read_text(encoding='utf-8').splitlines()
data={}
for line in lines:
    if '=' in line and not line.strip().startswith('#'):
        k,v=line.split('=',1);data[k.strip()]=v.strip().strip("'").strip('"')
site=os.environ['MOVECAR_HK_SITE']; turn=os.environ['MOVECAR_HK_TURN']
secret=data.get('VOICE_TURN_SHARED_SECRET') or secrets.token_hex(32)
pairing=data.get('VOICE_PAIRING_SECRET') or secrets.token_hex(32)
updates={
  'HOST_BIND':'127.0.0.1',
  'HOST_PORT':'8888',
  'HK_SITE_DOMAIN':site,
  'HK_TURN_DOMAIN':turn,
  'VOICE_PAIRING_SECRET':pairing,
  'VOICE_STUN_URLS':f'stun:{turn}:3478',
  'VOICE_TURN_URLS':f'turn:{turn}:3478?transport=udp,turn:{turn}:3478?transport=tcp,turns:{turn}:5349?transport=tcp',
  'VOICE_TURN_SHARED_SECRET':secret,
}
seen=set(); out=[]
for line in lines:
    if '=' in line and not line.strip().startswith('#'):
        k=line.split('=',1)[0].strip()
        if k in updates:
            if k not in seen:out.append(f'{k}={updates[k]}');seen.add(k)
            continue
    out.append(line)
for k,v in updates.items():
    if k not in seen:out.append(f'{k}={v}')
p.write_text('\n'.join(out).rstrip()+'\n',encoding='utf-8')
print('PASS MoveCar .env updated; existing keys/admin data preserved.')
PY
TURN_SECRET="$(sed -n 's/^VOICE_TURN_SHARED_SECRET=//p' .env | tail -1)"
[[ "$TURN_SECRET" =~ ^[0-9a-f]{64}$ ]] ||
  error "VOICE_TURN_SHARED_SECRET is malformed; expected 64 hex chars."
cat > deployment/hk/Caddyfile <<EOF
$SITE {
    encode gzip zstd
    reverse_proxy 127.0.0.1:8888
}
$TURN {
    respond "MoveCar TURN listens on 3478/udp,tcp and 5349/tcp" 200
}
EOF
cat > deployment/hk/turnserver.conf <<EOF
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
cert=/etc/coturn/tls/fullchain.pem
pkey=/etc/coturn/tls/privkey.pem
no-tlsv1
no-tlsv1_1
no-multicast-peers
no-loopback-peers
no-cli
user-quota=12
total-quota=100
stale-nonce=600
EOF
chown 0:65534 deployment/hk/turnserver.conf
chmod 0640 deployment/hk/turnserver.conf
# The TLS private key will also be readable only by root + the coturn nobody group.
chown 0:65534 data/hk/turn-tls
chmod 0750 data/hk/turn-tls
bash scripts/fetch-upstream.sh
COMPOSE=(docker compose -f compose.yaml -f compose.hk.yaml)
"${COMPOSE[@]}" config --quiet

if (( FIREWALL )) && command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active';then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 3478/tcp >/dev/null
  ufw allow 3478/udp >/dev/null
  ufw allow 5349/tcp >/dev/null
  ufw allow 49160:49260/udp >/dev/null
  echo "PASS Added necessary UFW rules. Configure your VPS provider firewall/security group separately."
fi

# Start HTTPS first, so Caddy can get BOTH site and TURN certificates.
"${COMPOSE[@]}" up -d --build movecar caddy
if [[ -n "$FIREBASE" ]];then
  docker cp "$FIREBASE" movecar:/app/data/firebase-service-account.json
  docker exec -u root movecar sh -c 'chown node:node /app/data/firebase-service-account.json && chmod 600 /app/data/firebase-service-account.json'
  "${COMPOSE[@]}" restart movecar
else
  docker exec movecar test -s /app/data/firebase-service-account.json ||
    error "Firebase server key not present in volume. Rerun with --firebase-key /path/to/firebase-service-account.json."
fi

echo "Checking TLS and public HTTPS for $SITE and $TURN..."
READY=0
for attempt in $(seq 1 45);do
  if curl -fsS --max-time 8 "https://$SITE/healthz" >/dev/null 2>&1 &&
     curl -fsS --max-time 8 "https://$TURN/" >/dev/null 2>&1;then
    READY=1;break
  fi
  sleep 3
done
if [[ "$READY" -ne 1 ]];then
  "${COMPOSE[@]}" logs --tail=80 caddy movecar >&2
  error "HTTPS verification failed. Check DNS A records, firewall 80/443 and Caddy logs. TURN was not started."
fi

bash scripts/sync-turn-cert.sh "$ROOT" "$TURN" --no-restart
"${COMPOSE[@]}" up -d coturn

# Periodic root timer: Caddy renews certs, then this job syncs to coturn.
if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]];then
  cat > /etc/systemd/system/movecar-hk-turn-cert.service <<EOF
[Unit]
Description=Sync MoveCar HK TURN certificate from Caddy
Requires=docker.service
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/bin/bash $ROOT/scripts/sync-turn-cert.sh $ROOT $TURN
EOF
  cat > /etc/systemd/system/movecar-hk-turn-cert.timer <<EOF
[Unit]
Description=Check TURN certificate renewal every 6 hours
[Timer]
OnBootSec=10min
OnUnitActiveSec=6h
Persistent=true
Unit=movecar-hk-turn-cert.service
[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now movecar-hk-turn-cert.timer >/dev/null
  echo "PASS Installed automatic coturn TLS certificate renewal timer."
else
  echo "WARNING: systemd unavailable; schedule root cron: bash $ROOT/scripts/sync-turn-cert.sh $ROOT $TURN"
fi

"${COMPOSE[@]}" ps
echo
echo "✅ MoveCar + Caddy + coturn are running on a single HK VPS."
echo "  Website: https://$SITE"
echo "  TURN:    turn:$TURN:3478 (UDP/TCP)"
echo "  TURN TLS: turns:$TURN:5349 (TCP)"
echo "  DNS/IP:  $PUBLIC_IP"
echo "  FCM through the VPN; split DIRECT routes for site/TURN must be set in your VPN client."
echo "  Next: bash scripts/check-hk.sh --site $SITE --turn $TURN"
echo "  Note: actual TURN relay, all carrier paths, and certificate renewals need field validation."
