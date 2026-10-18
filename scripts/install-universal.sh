#!/usr/bin/env bash
# Universal single-command MoveCar + TURN deployment.
# Works with any reverse proxy; domains, Firebase, PEM certs configured in /admin.
set -Eeuo pipefail
die(){ printf '安装失败：%s\n' "$*" >&2;exit 1; }
[[ "$(id -u)" == 0 ]] || die "请使用 sudo/root 执行安装命令"
for cmd in docker git curl python3 openssl;do command -v "$cmd" >/dev/null || die "未安装 $cmd；请先安装 Docker Engine、Compose V2 与基础命令";done
docker compose version >/dev/null || die "需要 Docker Compose V2"
DIR="${MOVECAR_DIR:-/opt/movecar}"
BRANCH=feature/onboarding-firewall-cert-sync
if [[ -e "$DIR" && ! -d "$DIR/.git" ]];then die "目录 $DIR 已存在且不是 Git 仓库；不会覆盖";fi
if [[ ! -e "$DIR" ]];then
 git clone -b "$BRANCH" --single-branch https://github.com/frbico/movecar.git "$DIR"
else
 if [[ -n "$(git -C "$DIR" status --porcelain --untracked-files=no)" ]];then
   die "$DIR 存在未提交的代码修改，不会覆盖，请先备份或提交"
 fi
 # A single-branch checkout may have fetch refspec for an older branch only.
 # Fetch an explicit remote-tracking ref before switching; FETCH_HEAD alone
 # does not create origin/$BRANCH (the cause of 'fatal: invalid reference').
 git -C "$DIR" fetch origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
 if git -C "$DIR" show-ref --verify --quiet "refs/heads/$BRANCH";then
   git -C "$DIR" switch "$BRANCH"
 else
   git -C "$DIR" switch --track -c "$BRANCH" "origin/$BRANCH"
 fi
 git -C "$DIR" merge --ff-only "origin/$BRANCH"
fi
cd "$DIR"
umask 077
mkdir -p data/turn data/turn/tls
# Coturn and Node run as UID 1000 (host-network STUN/TURN does not require root).
chown -R 1000:1000 data/turn
chmod 0700 data/turn data/turn/tls
install -m 0755 -o 1000 -g 1000 scripts/supervise-turn.sh data/turn/supervise-turn.sh
touch .env
chmod 0600 .env
PUBLIC_IP="$(curl --silent --show-error -4 --max-time 8 https://api.ipify.org || true)"
LOCAL_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1);break}}' || true)"
TURN_IP=''
if [[ -n "$PUBLIC_IP" ]];then
 if [[ -n "$LOCAL_IP" && "$PUBLIC_IP" != "$LOCAL_IP" ]];then TURN_IP="$PUBLIC_IP/$LOCAL_IP"
 else TURN_IP="$PUBLIC_IP";fi
fi
export MOVECAR_DETECTED_TURN_IP="$TURN_IP"
python3 - <<'PY'
import os,re,secrets
from pathlib import Path
p=Path('.env'); lines=p.read_text().splitlines()
old={}
for line in lines:
 if '=' in line and not line.lstrip().startswith('#'):
  k,v=line.split('=',1)
  old[k.strip()]=v.strip().strip('"').strip("'")
turn=old.get('VOICE_TURN_SHARED_SECRET','')
if not re.fullmatch('[0-9a-f]{64}',turn):turn=secrets.token_hex(32)
pair=old.get('VOICE_PAIRING_SECRET','')
if len(pair)<20:pair=secrets.token_hex(32)
updates={'VOICE_TURN_SHARED_SECRET':turn,
         'VOICE_PAIRING_SECRET':pair,
         'TURN_EXTERNAL_IP':os.environ['MOVECAR_DETECTED_TURN_IP']}
seen=set();out=[]
for line in lines:
 k=line.split('=',1)[0].strip() if '=' in line and not line.lstrip().startswith('#') else ''
 if k in updates:
  if k not in seen:out.append(k+'='+updates[k]);seen.add(k)
 else:out.append(line)
for k,v in updates.items():
 if k not in seen:out.append(k+'='+v)
p.write_text(chr(10).join(out).rstrip()+chr(10))
print('PASS preserving previous pairing credentials; TURN server-specific IP refreshed.')
PY
if [[ ! -s upstream/movecar.js ]];then bash scripts/fetch-upstream.sh;fi
COMPOSE=(docker compose -f compose.yaml -f compose.portable.yaml)
# Optional adapter for 1Panel, WITHOUT making 1Panel mandatory.
if docker network inspect 1panel-network >/dev/null 2>&1;then
 COMPOSE+=(-f compose.network-onepanel.yaml)
 echo '检测到 1panel-network：已自动接入现有 OpenResty 网络'
fi
"${COMPOSE[@]}" config --quiet || die 'Docker Compose 文件校验失败'
"${COMPOSE[@]}" up -d --build || die '容器启动失败，请检查 docker compose logs'
OK=0
for i in $(seq 1 40);do
 if curl -fsS --noproxy '*' --max-time 5 http://127.0.0.1:8888/healthz >/dev/null 2>&1;then OK=1;break;fi
 sleep 2
done
[[ "$OK" -eq 1 ]] || die 'MoveCar 未通过健康检查。检查：docker logs movecar'
# Detect and open TURN ports. Never alter external HTTPS reverse-proxy ports.
if ! bash scripts/configure-firewall.sh;then
 echo '警告：无法自动更新此服务器的自定义主机防火墙。向导将显示详细处理建议。' >&2
fi
# Optional ROOT-only certificate watcher for existing 1Panel/Nginx/Let's Encrypt files.
# The Node web service has NO host mount, Docker socket or elevated file privileges.
if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]];then
 cat >/etc/systemd/system/movecar-firewall.service <<EOF
[Unit]
Description=Keep MoveCar STUN/TURN host firewall ports open after server restart
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/bash $DIR/scripts/configure-firewall.sh
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF
 cat >/etc/systemd/system/movecar-cert-sync.service <<EOF
[Unit]
Description=Synchronize existing web certificates for MoveCar TURN
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 $DIR/scripts/sync-host-cert.py $DIR
EOF
 cat >/etc/systemd/system/movecar-cert-sync.timer <<EOF
[Unit]
Description=Check existing website TLS files for updates
[Timer]
OnBootSec=15s
OnUnitActiveSec=1min
Persistent=true
[Install]
WantedBy=timers.target
EOF
 cat >/etc/systemd/system/movecar-turn-health.service <<EOF
[Unit]
Description=Verify authenticated local TURN allocation for MoveCar wizard
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 $DIR/scripts/host-health.py $DIR
EOF
 cat >/etc/systemd/system/movecar-turn-health.timer <<EOF
[Unit]
Description=Check TURN health once a minute
[Timer]
OnBootSec=20s
OnUnitActiveSec=1min
Persistent=true
[Install]
WantedBy=timers.target
EOF
 systemctl daemon-reload
 systemctl enable --now movecar-cert-sync.timer >/dev/null
 systemctl enable --now movecar-turn-health.timer >/dev/null
 systemctl enable movecar-firewall.service >/dev/null
 echo '已启用网站证书只读同步助手（由原证书管理器继续负责签发续期）'
else
 echo '提醒：系统没有 systemd，后台可手动上传证书；目录自动同步需要配置 cron。'
fi

echo
echo '✅ 安装完成。无需在安装时填写域名、Firebase 或证书。'
echo '后台入口： http://127.0.0.1:8888/admin'
echo '公网 HTTPS 反代目标（主机代理）：http://127.0.0.1:8888'
if docker network inspect 1panel-network >/dev/null 2>&1;then
 echo '1Panel/OpenResty 同网络反代目标：http://movecar:8888'
fi
echo '在后台「部署与迁移」页面填写网站地址、TURN 域名，上传 Firebase 服务账号 JSON 和可选 TLS 证书。'
if docker exec movecar test -f /app/data/admin-initial-password;then
 echo '首次管理员账号：admin'
 echo '首次管理员密码：'
 docker exec movecar cat /app/data/admin-initial-password
 echo '首次登录后请立即更换密码，切勿在公网明文 HTTP 上传私钥。'
else echo '管理员密码沿用原有数据库；不会重置。';fi
echo '未使用公网反代时，请通过 SSH -L 8888:127.0.0.1:8888 安全访问初始后台。'
