#!/usr/bin/env bash
# Universal single-command MoveCar + TURN deployment.
# Works with any reverse proxy; domains, Firebase, PEM certs configured in /admin.
set -Eeuo pipefail
die(){ printf '安装失败：%s\n' "$*" >&2;exit 1; }
[[ "$(id -u)" == 0 ]] || die "请使用 sudo/root 执行安装命令"
for cmd in docker git curl python3 openssl;do command -v "$cmd" >/dev/null || die "未安装 $cmd；请先安装 Docker Engine、Compose V2 与基础命令";done
docker compose version >/dev/null || die "需要 Docker Compose V2"
DIR="${MOVECAR_DIR:-/opt/movecar}"
BRANCH=feature/universal-setup-wizard
if [[ -e "$DIR" && ! -d "$DIR/.git" ]];then die "目录 $DIR 已存在且不是 Git 仓库；不会覆盖";fi
if [[ ! -e "$DIR" ]];then
 git clone -b "$BRANCH" --single-branch https://github.com/frbico/movecar.git "$DIR"
else
 if [[ -n "$(git -C "$DIR" status --porcelain --untracked-files=no)" ]];then
   die "$DIR 存在未提交的代码修改，不会覆盖，请先备份或提交"
 fi
 git -C "$DIR" fetch origin "$BRANCH"
 git -C "$DIR" switch "$BRANCH" || git -C "$DIR" switch -c "$BRANCH" --track "origin/$BRANCH"
 git -C "$DIR" pull --ff-only origin "$BRANCH"
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
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active';then
 ufw allow 3478/udp >/dev/null;ufw allow 3478/tcp >/dev/null
 ufw allow 5349/tcp >/dev/null;ufw allow 49160:49260/udp >/dev/null
 echo '已放行 UFW TURN 端口（云厂商安全组仍需单独放行）'
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
