#!/usr/bin/env bash
# Portable post-install check; does not assume 1Panel/Caddy/Nginx or a domain.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[[ -f .env ]] || { echo "请先执行 scripts/install-universal.sh" >&2;exit 1; }
echo "检查 MoveCar HTTP /healthz..."
curl -fsS --noproxy '*' --max-time 12 http://127.0.0.1:8888/healthz
echo
curl -fsS --noproxy '*' --max-time 12 http://127.0.0.1:8888/api/voice/config
echo
readarray -t CONFIG < <(docker exec movecar node --input-type=module -e '
import {DatabaseSync} from "node:sqlite";
import fs from "node:fs";
const db=new DatabaseSync("/app/data/state.sqlite");
const q=db.prepare("SELECT value FROM settings WHERE key=?");
const host=q.get("turn_host")?.value||"";
console.log(host);
console.log(fs.existsSync("/app/runtime/tls/fullchain.pem")&&fs.existsSync("/app/runtime/tls/privkey.pem")?"yes":"no");
db.close();
')
TURN="${CONFIG[0]:-127.0.0.1}"
[[ -n "$TURN" ]] || TURN=127.0.0.1
if [[ "${CONFIG[1]:-no}" == yes ]];then
 python3 scripts/turn-probe.py --host "$TURN" --connect-ip 127.0.0.1 --secret-env-file .env
else
 python3 scripts/turn-probe.py --host "$TURN" --connect-ip 127.0.0.1 --secret-env-file .env --no-tls
fi
echo "本地 TURN 鉴权测试通过。请在中国大陆外部网络另行验证公网端口和真实双向通话。"
