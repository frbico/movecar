#!/usr/bin/env bash
set -Eeuo pipefail
# Fixed official stable channel; no arbitrary URL or shell from web requests.
MODE="$1"
ROOT=/opt/movecar
RUNTIME="$ROOT/data/turn"
REQUEST="$RUNTIME/update-request.json"
STATUS="$RUNTIME/update-status.json"
BACKUP_ROOT=/root/movecar-update-backups
FAIL(){ echo "MoveCar updater: $*" >&2;exit 1; }
[[ "$(id -u)" -eq 0 ]] || FAIL 'Root permissions required'
for c in git docker python3 curl flock;do command -v "$c" >/dev/null || FAIL "Missing $c";done
docker compose version >/dev/null || FAIL 'Docker Compose V2 required'
[[ -d "$ROOT/.git" ]] || FAIL 'MoveCar repository not found in /opt/movecar'
[[ "$(git -C "$ROOT" remote get-url origin)" == *frbico/movecar* ]] || FAIL 'Git origin not recognized'
mkdir -p "$RUNTIME" "$BACKUP_ROOT"
umask 077

status(){
  MC_STATE="$1" MC_MESSAGE="$2" MC_OLD="$3" MC_NEW="$4" MC_STATUS="$STATUS" python3 - <<'PY'
import os,json,time,tempfile
dst=os.environ['MC_STATUS']
obj={'state':os.environ['MC_STATE'],'message':os.environ['MC_MESSAGE'][:280],
     'currentSha':os.environ['MC_OLD'],'targetSha':os.environ['MC_NEW'],
     'updatedAt':int(time.time()*1000)}
fd,tmp=tempfile.mkstemp(prefix='.update-',dir=os.path.dirname(dst))
try:
 with os.fdopen(fd,'w') as f:json.dump(obj,f,ensure_ascii=False)
 os.chmod(tmp,0o600)
 os.chown(tmp,1000,1000)
 os.replace(tmp,dst)
finally:
 if os.path.exists(tmp):os.unlink(tmp)
PY
}

install_timer(){
  if command -v systemctl >/dev/null && [[ -d /run/systemd/system ]];then
    cat >/etc/systemd/system/movecar-web-upgrade.service <<EOF
[Unit]
Description=Apply authenticated MoveCar upgrades
Requires=docker.service
After=docker.service network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/bash /opt/movecar/scripts/host-updater.sh service
TimeoutStartSec=900
EOF
    cat >/etc/systemd/system/movecar-web-upgrade.timer <<EOF
[Unit]
Description=Poll MoveCar admin upgrade queue
[Timer]
OnBootSec=15s
OnUnitActiveSec=15s
AccuracySec=5s
Persistent=true
Unit=movecar-web-upgrade.service
[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now movecar-web-upgrade.timer >/dev/null
  else
    echo 'Warning: systemd unavailable, set up host root cron to run host-updater.sh service.'
  fi
}
if [[ "$MODE" == install ]];then
  install_timer
  status idle '网页更新助手已就绪' "$(git -C "$ROOT" rev-parse HEAD)" ''
  exit 0
fi
[[ "$MODE" == service || "$MODE" == apply ]] || FAIL 'Invalid mode'
exec 9>"$RUNTIME/.upgrade.lock"
flock -n 9 || { echo 'Already upgrading';exit 0; }
PREVIOUS="$(git -C "$ROOT" rev-parse HEAD)"
TARGET=''
if [[ "$MODE" == service ]];then
  [[ -s "$REQUEST" ]] || exit 0
  TARGET="$(python3 - "$REQUEST" <<'PY'
import json,re,sys,time
try:
 d=json.load(open(sys.argv[1]))
 if d.get('channel')=='release/stable' and re.fullmatch('[0-9a-f]{40}',d.get('sha','')) and re.fullmatch('[0-9a-f-]{36}',d.get('id','')) and abs(time.time()*1000-int(d.get('createdAt',0)))<1200000:
  print(d['sha'])
except Exception:pass
PY
)"
  if [[ ! "$TARGET" =~ ^[0-9a-f]{40}$ ]];then
    rm -f "$REQUEST"
    status error '无效或过期的升级任务，请重新检查更新' "$PREVIOUS" ''
    exit 1
  fi
fi
status running '正在核对官方稳定版本…' "$PREVIOUS" "$TARGET"
LATEST="$(git ls-remote https://github.com/frbico/movecar.git refs/heads/release/stable | awk 'NR==1{print $1}')"
[[ "$LATEST" =~ ^[0-9a-f]{40}$ ]] || FAIL 'Unable to query official stable release'
if [[ "$MODE" == service && "$LATEST" != "$TARGET" ]];then
  rm -f "$REQUEST"
  status error '有更新的发布版本，请重新检查并确认' "$PREVIOUS" "$LATEST"
  exit 1
fi
TARGET="$LATEST"
if [[ "$PREVIOUS" == "$TARGET" ]];then
  rm -f "$REQUEST"
  status success '已经是最新版本' "$PREVIOUS" "$TARGET"
  exit 0
fi
STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"
ARCHIVE="$BACKUP_ROOT/$STAMP"
mkdir -p "$ARCHIVE"
chmod 0700 "$ARCHIVE"
echo "$PREVIOUS" > "$ARCHIVE/previous-commit.txt"
git -C "$ROOT" status --short > "$ARCHIVE/status.txt"
git -C "$ROOT" diff --binary HEAD > "$ARCHIVE/local-modifications.patch"
if [[ -f "$ROOT/.env" ]];then
  cp -p "$ROOT/.env" "$ARCHIVE/dot-env"
  chmod 0600 "$ARCHIVE/dot-env"
fi
if docker container inspect movecar >/dev/null 2>&1;then
  docker exec movecar node --input-type=module -e '
import {DatabaseSync,backup} from "node:sqlite";
import fs from "node:fs";
if(fs.existsSync("/app/data/state.sqlite")){
 const db=new DatabaseSync("/app/data/state.sqlite");
 try{await backup(db,"/app/data/movecar-preupdate.sqlite");}finally{db.close();}
}' || FAIL "Failed to create consistent SQLite backup; nothing changed"
  docker cp movecar:/app/data/movecar-preupdate.sqlite "$ARCHIVE/state.sqlite" >/dev/null 2>&1 || true
  docker exec movecar rm -f /app/data/movecar-preupdate.sqlite >/dev/null 2>&1 || true
  mkdir -p "$ARCHIVE/app-data"
  docker cp 'movecar:/app/data/.' "$ARCHIVE/app-data/" >/dev/null 2>&1 || true
fi
chmod -R go-rwx "$ARCHIVE"
status running '备份完成，正在安全更新 Git 代码与 Docker 容器…' "$PREVIOUS" "$TARGET"
if [[ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]];then
  git -C "$ROOT" stash push -m "MoveCar preupgrade $STAMP" ||
    FAIL "Cannot stash tracked changes; patch is at $ARCHIVE"
  git -C "$ROOT" rev-parse 'stash@{0}' > "$ARCHIVE/stash-ref.txt"
fi
git -C "$ROOT" fetch origin '+refs/heads/release/stable:refs/remotes/origin/release/stable'
FETCHED="$(git -C "$ROOT" rev-parse refs/remotes/origin/release/stable)"
[[ "$FETCHED" == "$TARGET" ]] || FAIL 'Release moved while fetching; retry'
git -C "$ROOT" switch -C release/stable "$TARGET" ||
  FAIL "Conflicting untracked files; source and data backup is at $ARCHIVE"
cd "$ROOT"
