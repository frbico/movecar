#!/usr/bin/env bash
set -Eeuo pipefail
# Fixed official stable channel; no arbitrary URL or shell from web requests.
MODE="$1"
ROOT=/opt/movecar
RUNTIME="$ROOT/data/turn"
REQUEST="$RUNTIME/update-request.json"
STATUS="$RUNTIME/update-status.json"
BACKUP_INFO="$RUNTIME/update-backup.json"
BACKUP_ROOT=/root/movecar-update-backups
FAIL(){ echo "MoveCar updater: $*" >&2;exit 1; }
[[ "$(id -u)" -eq 0 ]] || FAIL 'Root permissions required'
for c in git docker python3 curl flock;do command -v "$c" >/dev/null || FAIL "Missing $c";done
docker compose version >/dev/null || FAIL 'Docker Compose V2 required'
[[ -d "$ROOT/.git" ]] || FAIL 'MoveCar repository not found in /opt/movecar'
case "$(git -C "$ROOT" remote get-url origin)" in
  https://github.com/frbico/movecar|https://github.com/frbico/movecar.git|git@github.com:frbico/movecar.git|ssh://git@github.com/frbico/movecar.git) ;;
  *) FAIL 'Git origin must be the official frbico/movecar repository' ;;
esac
mkdir -p "$RUNTIME" "$BACKUP_ROOT"
umask 077

status(){
  MC_STATE="$1" MC_MESSAGE="$2" MC_OLD="$3" MC_NEW="$4" MC_STATUS="$STATUS" python3 - <<'PY'
import os,json,time,tempfile
dst=os.environ['MC_STATUS']
obj={'state':os.environ['MC_STATE'],'message':os.environ['MC_MESSAGE'][:280],
     'currentSha':os.environ['MC_OLD'],'targetSha':os.environ['MC_NEW'],
     'updatedAt':int(time.time()*1000),'lastHeartbeatAt':int(time.time()*1000)}
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

write_backup_info(){
  MC_BACKUP_ID="$1" MC_BACKUP_OLD="$2" MC_BACKUP_NEW="$3" MC_BACKUP_INFO="$BACKUP_INFO" python3 - <<'PY'
import os,json,time,tempfile
dst=os.environ['MC_BACKUP_INFO']
obj={'id':os.environ['MC_BACKUP_ID'],'previousSha':os.environ['MC_BACKUP_OLD'],
     'targetSha':os.environ['MC_BACKUP_NEW'],'createdAt':int(time.time()*1000)}
fd,tmp=tempfile.mkstemp(prefix='.backup-info-',dir=os.path.dirname(dst))
try:
 with os.fdopen(fd,'w') as f:json.dump(obj,f)
 os.chmod(tmp,0o600);os.chown(tmp,1000,1000);os.replace(tmp,dst)
finally:
 if os.path.exists(tmp):os.unlink(tmp)
PY
}
prune_backups(){
  local keep="$1" item
  [[ "$keep" =~ ^/root/movecar-update-backups/[0-9]{8}T[0-9]{6}Z-[0-9]+$ ]] || FAIL 'Unsafe backup retention target'
  [[ -d "$keep" ]] || FAIL 'Latest backup missing; refusing retention cleanup'
  for item in "$BACKUP_ROOT"/*;do
    [[ -d "$item" && "$item" != "$keep" && "$item" =~ ^/root/movecar-update-backups/[0-9]{8}T[0-9]{6}Z-[0-9]+$ ]] || continue
    rm -rf -- "$item" || echo "Warning: unable to remove old backup $item" >&2
  done
}
migrate_previous_backup(){
  [[ -e "$BACKUP_INFO" ]] && return 0
  local installed archive='' candidate previous
  installed="$(python3 - "$STATUS" <<'PY'
import json,sys
try:
 d=json.load(open(sys.argv[1]))
 if d.get('state')=='success':print(d.get('targetSha',''))
except (OSError,ValueError):pass
PY
)"
  [[ "$installed" =~ ^[0-9a-f]{40}$ && "$installed" == "$(git -C "$ROOT" rev-parse HEAD)" ]] || return 0
  for candidate in "$BACKUP_ROOT"/*;do
    [[ -d "$candidate" && "$candidate" =~ ^/root/movecar-update-backups/[0-9]{8}T[0-9]{6}Z-[0-9]+$ ]] || continue
    [[ -s "$candidate/previous-commit.txt" && -s "$candidate/state.sqlite" && -s "$candidate/dot-env" && -d "$candidate/app-data" ]] || continue
    previous="$(tr -d '\r\n' < "$candidate/previous-commit.txt")"
    [[ "$previous" =~ ^[0-9a-f]{40}$ && "$previous" != "$installed" ]] || continue
    [[ -z "$archive" || "$candidate" > "$archive" ]] && archive="$candidate"
  done
  [[ -n "$archive" ]] || return 0
  previous="$(tr -d '\r\n' < "$archive/previous-commit.txt")"
  cp -p "$archive/state.sqlite" "$archive/app-data/state.sqlite"
  rm -f "$archive/app-data/state.sqlite-wal" "$archive/app-data/state.sqlite-shm"
  verify_backup "$archive" || return 0
  write_backup_info "${archive##*/}" "$previous" "$installed"
  prune_backups "$archive"
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
heartbeat(){
  # A host timer can exist but be disabled. Refresh a private heartbeat on
  # every service invocation without erasing the last success/error result.
  MC_STATUS="$STATUS" python3 - <<'PY'
import os,json,time,tempfile
dst=os.environ['MC_STATUS']
try:
 with open(dst,encoding='utf8') as f: obj=json.load(f)
 if not isinstance(obj,dict):obj={}
except (OSError,ValueError):obj={'state':'idle','message':'主机更新助手已启动'}
obj['lastHeartbeatAt']=int(time.time()*1000)
fd,tmp=tempfile.mkstemp(prefix='.heartbeat-',dir=os.path.dirname(dst))
try:
 with os.fdopen(fd,'w') as f:json.dump(obj,f,ensure_ascii=False)
 os.chmod(tmp,0o600);os.chown(tmp,1000,1000);os.replace(tmp,dst)
finally:
 if os.path.exists(tmp):os.unlink(tmp)
PY
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
ARCHIVE=''
ROLLBACK_CURRENT=''
OPERATION=update
UPDATE_FINALIZED=0
SWITCHED=0
DATA_CHANGED=0
COMPOSE=(docker compose -f compose.yaml -f compose.portable.yaml)
if docker network inspect 1panel-network >/dev/null 2>&1;then
  COMPOSE+=(-f compose.network-onepanel.yaml)
fi
health_ok(){
  for _attempt in $(seq 1 45);do
    if curl --noproxy '*' -fsS --max-time 4 http://127.0.0.1:8888/healthz >/dev/null 2>&1;then return 0;fi
    sleep 2
  done
  return 1
}
container_sha(){
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' movecar 2>/dev/null |
    sed -n 's/^MOVECAR_COMMIT_SHA=//p' | head -1
}
verify_backup(){
  python3 - "$1/state.sqlite" <<'PY'
import sqlite3,sys,os
f=sys.argv[1]
if not os.path.isfile(f) or os.path.getsize(f)<1024:
    raise SystemExit('SQLite backup is empty or missing')
db=sqlite3.connect('file:'+f+'?mode=ro',uri=True)
try:
    if db.execute('PRAGMA quick_check').fetchone()[0]!='ok':
        raise SystemExit('SQLite backup integrity check failed')
    if not db.execute("SELECT name FROM sqlite_master WHERE name='settings'").fetchone():
        raise SystemExit('SQLite backup lacks settings table')
finally: db.close()
PY
  local check_rc=$?
  ((check_rc==0)) || return 1
  [[ -d "$1/app-data" && -s "$1/app-data/state.sqlite" ]] || return 1
}
backup_data(){
  local destination="$1"
  [[ "$(docker inspect --format '{{.State.Running}}' movecar 2>/dev/null)" == true ]] ||
    FAIL 'Running movecar container required for a consistent backup'
  local running_sha;running_sha="$(container_sha)"
  [[ -z "$running_sha" || "$running_sha" == "$PREVIOUS" ]] ||
    FAIL 'Checkout differs from running container; resolve version mismatch before upgrading'
  docker exec movecar node --input-type=module -e '
import {DatabaseSync,backup} from "node:sqlite";
import fs from "node:fs";
if(!fs.existsSync("/app/data/state.sqlite"))process.exit(1);
const db=new DatabaseSync("/app/data/state.sqlite");
try{await backup(db,"/app/data/movecar-preupdate.sqlite");}finally{db.close();}
' || FAIL 'Failed to create consistent SQLite backup; nothing changed'
  docker cp movecar:/app/data/movecar-preupdate.sqlite "$destination/state.sqlite" >/dev/null ||
    FAIL 'Database backup copy failed; stopped before modifying program'
  mkdir -p "$destination/app-data"
  docker cp 'movecar:/app/data/.' "$destination/app-data/" >/dev/null ||
    FAIL 'App data backup failed; stopped before modifying program'
  cp -p "$destination/state.sqlite" "$destination/app-data/state.sqlite"
  rm -f "$destination/app-data/state.sqlite-wal" "$destination/app-data/state.sqlite-shm" \
    "$destination/app-data/movecar-preupdate.sqlite"
  docker exec movecar rm -f /app/data/movecar-preupdate.sqlite >/dev/null 2>&1 || true
  chmod -R go-rwx "$destination"
  verify_backup "$destination"
}
verify_running_db(){
  docker exec movecar node --input-type=module -e '
import {DatabaseSync} from "node:sqlite";
import fs from "node:fs";
if(!fs.existsSync("/app/data/state.sqlite"))process.exit(1);
const db=new DatabaseSync("/app/data/state.sqlite");
try{
 if(db.prepare("PRAGMA quick_check").get()?.quick_check!=="ok")process.exit(1);
 if(!db.prepare("SELECT name FROM sqlite_master WHERE name=\x27settings\x27").get())process.exit(1);
}finally{db.close()}
'
}
restore_archive(){
  local source="$1" revision="$2" image
  verify_backup "$source" || return 1
  [[ -s "$source/dot-env" && "$revision" =~ ^[0-9a-f]{40}$ ]] || return 1
  image="$(docker inspect --format '{{.Image}}' movecar)" || return 1
  (cd "$ROOT" && "${COMPOSE[@]}" stop movecar) || return 1
  # The source is a root-owned, validated local backup. Copy it into the
  # stopped container's existing named volume; no new image is downloaded.
  docker run --rm --user 0:0 --volumes-from movecar \
    -v "$source/app-data:/restore:ro" --entrypoint sh "$image" -ec '
      test -s /restore/state.sqlite
      find /app/data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
      cp -a /restore/. /app/data/
      chown -R 1000:1000 /app/data
    ' || return 1
  git -C "$ROOT" switch -C release/stable "$revision" || return 1
  cp -p "$source/dot-env" "$ROOT/.env" || return 1
  (cd "$ROOT" && bash scripts/fetch-upstream.sh && "${COMPOSE[@]}" up -d --build movecar coturn) || return 1
  [[ "$(git -C "$ROOT" rev-parse HEAD)" == "$revision" && "$(container_sha)" == "$revision" ]] || return 1
  health_ok && verify_running_db
}
record_failure(){
  local rc="$?"
  if ((rc != 0 && UPDATE_FINALIZED == 0));then
    trap - EXIT
    if [[ "$OPERATION" == rollback ]];then
      if ((DATA_CHANGED)) && [[ -n "$ROLLBACK_CURRENT" && -d "$ROLLBACK_CURRENT" ]];then
        status rollback '恢复未通过检查，正在恢复操作前的当前版本…' "$PREVIOUS" "$TARGET" || true
        if restore_archive "$ROLLBACK_CURRENT" "$PREVIOUS";then
          status error '恢复失败；已重新部署操作前的版本和数据' "$PREVIOUS" "$TARGET" || true
          rm -rf -- "$ROLLBACK_CURRENT"
        else
          status error "恢复及故障回退均未通过检查！请保留 $ROLLBACK_CURRENT 并人工处理" "$PREVIOUS" "$TARGET" || true
        fi
      else
        status error '恢复在修改数据前中断，现有服务未被替换' "$PREVIOUS" "$TARGET" || true
      fi
    elif ((SWITCHED));then
      status rollback '部署未通过验证，正在恢复先前的代码与容器…' "$PREVIOUS" "$TARGET" || true
      local restored=1
      git -C "$ROOT" switch -C release/stable "$PREVIOUS" || restored=0
      if [[ -n "$ARCHIVE" && -f "$ARCHIVE/dot-env" ]];then
        cp -p "$ARCHIVE/dot-env" "$ROOT/.env" || restored=0
      fi
      if ((restored));then
        (cd "$ROOT" && bash scripts/fetch-upstream.sh && "${COMPOSE[@]}" up -d --build movecar coturn) || restored=0
      fi
      if ((restored));then
        [[ "$(git -C "$ROOT" rev-parse HEAD)" == "$PREVIOUS" ]] || restored=0
        # Old containers may not have the revision environment variable yet.
        local restored_sha; restored_sha="$(container_sha)"
        if [[ -n "$restored_sha" && "$restored_sha" != "$PREVIOUS" ]];then restored=0;fi
        if ((restored));then health_ok || restored=0;fi
      fi
      if ((restored));then
        status error "升级失败，但旧版本已恢复并通过健康检查。备份位于 $ARCHIVE" "$PREVIOUS" "$TARGET" || true
      else
        status error "升级及自动回退均未通过检查！请勿重复升级，检查 $ARCHIVE 内的备份并人工恢复" "$PREVIOUS" "$TARGET" || true
      fi
    else
      status error '升级在修改程序前中断；请检查服务器日志和备份目录' "$PREVIOUS" "$TARGET" || true
    fi
    if [[ "$MODE" == service ]];then rm -f "$REQUEST";fi
  fi
}
trap record_failure EXIT
if [[ "$MODE" == service ]];then
  migrate_previous_backup
  heartbeat
  [[ -s "$REQUEST" ]] || exit 0
  TARGET="$(python3 - "$REQUEST" <<'PY'
import json,re,sys,time
try:
 d=json.load(open(sys.argv[1]))
 if d.get('channel')=='release/stable' and d.get('operation','update') in ('update','rollback') and re.fullmatch('[0-9a-f]{40}',d.get('sha','')) and re.fullmatch('[0-9a-f-]{36}',d.get('id','')) and abs(time.time()*1000-int(d.get('createdAt',0)))<1200000:
  print(d['sha'])
except Exception:pass
PY
)"
  if [[ ! "$TARGET" =~ ^[0-9a-f]{40}$ ]];then
    rm -f "$REQUEST"
    status error '无效或过期的升级任务，请重新检查更新' "$PREVIOUS" ''
    UPDATE_FINALIZED=1
    exit 1
  fi
  OPERATION="$(python3 - "$REQUEST" <<'PY'
import json,sys
print(json.load(open(sys.argv[1])).get('operation','update'))
PY
)"
fi
if [[ "$OPERATION" == rollback ]];then
  [[ "$MODE" == service && -s "$BACKUP_INFO" ]] || FAIL 'No verified rollback backup available'
  BACKUP_ID="$(python3 - "$REQUEST" <<'PY'
import json,sys
print(json.load(open(sys.argv[1])).get('backupId',''))
PY
)"
  [[ "$BACKUP_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9]+$ ]] || FAIL 'Invalid rollback backup ID'
  mapfile -t backup_meta < <(python3 - "$BACKUP_INFO" <<'PY'
import json,sys
obj=json.load(open(sys.argv[1]))
for key in ('id','previousSha','targetSha'):print(obj.get(key,''))
PY
)
  [[ "${backup_meta[0]:-}" == "$BACKUP_ID" && "${backup_meta[1]:-}" == "$TARGET" && "${backup_meta[2]:-}" == "$PREVIOUS" ]] ||
    FAIL 'Rollback backup does not match the running release'
  ARCHIVE="$BACKUP_ROOT/$BACKUP_ID"
  [[ -d "$ARCHIVE" && -s "$ARCHIVE/dot-env" ]] || FAIL 'Rollback archive is incomplete'
  verify_backup "$ARCHIVE"
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  ROLLBACK_CURRENT="$BACKUP_ROOT/.rollback-current-$STAMP"
  mkdir -m 0700 "$ROLLBACK_CURRENT"
  cp -p "$ROOT/.env" "$ROLLBACK_CURRENT/dot-env"
  backup_data "$ROLLBACK_CURRENT"
  status rollback '正在用最近一次备份恢复旧版代码与数据…' "$PREVIOUS" "$TARGET"
  DATA_CHANGED=1
  restore_archive "$ARCHIVE" "$TARGET"
  rm -f "$REQUEST"
  status success '旧版代码与数据已恢复，健康检查通过' "$TARGET" "$TARGET"
  UPDATE_FINALIZED=1
  rm -rf -- "$ROLLBACK_CURRENT"
  echo "MoveCar restored: $PREVIOUS -> $TARGET from $ARCHIVE"
  exit 0
fi
status running '正在核对官方稳定版本…' "$PREVIOUS" "$TARGET"
LATEST="$(git ls-remote https://github.com/frbico/movecar.git refs/heads/release/stable | awk 'NR==1{print $1}')"
[[ "$LATEST" =~ ^[0-9a-f]{40}$ ]] || FAIL 'Unable to query official stable release'
if [[ "$MODE" == service && "$LATEST" != "$TARGET" ]];then
  rm -f "$REQUEST"
  status error '有更新的发布版本，请重新检查并确认' "$PREVIOUS" "$LATEST"
  UPDATE_FINALIZED=1
  exit 1
fi
TARGET="$LATEST"
if [[ "$PREVIOUS" == "$TARGET" ]];then
  rm -f "$REQUEST"
  status success '已经是最新版本' "$PREVIOUS" "$TARGET"
  UPDATE_FINALIZED=1
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
backup_data "$ARCHIVE"
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
SWITCHED=1
cd "$ROOT"
python3 - "$TARGET" <<'PY'
from pathlib import Path
import sys
p=Path('.env')
lines=p.read_text().splitlines() if p.exists() else []
lines=[x for x in lines if not x.startswith('MOVECAR_COMMIT_SHA=')]
lines.append('MOVECAR_COMMIT_SHA='+sys.argv[1])
p.write_text(chr(10).join(lines)+chr(10))
p.chmod(0o600)
PY
set +e
bash scripts/fetch-upstream.sh
fetch_rc=$?
if (( fetch_rc == 0 ));then
 "${COMPOSE[@]}" up -d --build movecar coturn
 update_rc=$?
else update_rc=1;fi
if (( update_rc == 0 ));then
  # Verify the *new* container actually exposes the requested revision; a
  # surviving old service on port 8888 would otherwise yield a false success.
  running_sha="$(container_sha)"
  if [[ "$running_sha" != "$TARGET" ]];then
    echo "Rebuilt container revision mismatch: expected $TARGET, found $running_sha" >&2
    update_rc=1
  fi
fi
if (( update_rc == 0 ));then
  health_ok || update_rc=1
fi
if (( update_rc == 0 ));then
  # Startup alone is insufficient: verify the running SQLite volume remains
  # readable after the new version's migrations, without exposing its rows.
  verify_running_db || update_rc=1
fi
set -e
if ((update_rc != 0));then
  echo 'New release failed runtime checks; initiating verified rollback' >&2
  exit 1
fi
rm -f "$REQUEST"
write_backup_info "$STAMP" "$PREVIOUS" "$TARGET"
prune_backups "$ARCHIVE"
status success '升级成功，容器健康检查通过；已保留最近一次备份' "$TARGET" "$TARGET"
install_timer
UPDATE_FINALIZED=1
echo "MoveCar updated: $PREVIOUS -> $TARGET. Backup: $ARCHIVE"
