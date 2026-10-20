#!/usr/bin/env bash
# Import a private SQLite backup onto a newly installed MoveCar host.
# Performs a local rollback backup first; NEVER called by the universal installer.
set -Eeuo pipefail
[[ "$(id -u)" == 0 ]] || { echo '请使用 sudo 执行数据库恢复' >&2;exit 1; }
INPUT="${1:-}"
[[ -n "$INPUT" && -f "$INPUT" ]] || { echo '用法：sudo bash scripts/restore-db.sh /安全路径/movecar-transfer.sqlite' >&2;exit 2; }
INPUT="$(realpath "$INPUT")"
python3 - "$INPUT" <<'PY'
import sqlite3,sys
con=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
try:
 assert con.execute('PRAGMA quick_check').fetchone()[0]=='ok'
 assert con.execute("SELECT name FROM sqlite_master WHERE name='settings'").fetchone()
 assert con.execute("SELECT name FROM sqlite_master WHERE name='admin_sessions'").fetchone()
finally: con.close()
print('PASS 导入文件 SQLite 完整性')
PY
command -v docker >/dev/null || { echo '未安装 Docker' >&2;exit 1; }
docker container inspect movecar >/dev/null || { echo '目标 MoveCar 容器不存在；请先一键安装' >&2;exit 1; }
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$DIR/data/private-backups"
mkdir -p "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/before-import-$(date +%Y%m%d-%H%M%S).sqlite"
umask 077
# Create online backup of current target before stopping. Safer than copying a live WAL.
bash "$DIR/scripts/export-db.sh" "$BACKUP"
echo '已经创建本地回退备份，接下来将短暂停止服务。'
docker stop movecar >/dev/null
rollback(){
 echo '数据恢复失败，正在恢复本机操作前的备份…' >&2
 docker run --rm --user 0:0 --volumes-from movecar -v "$BACKUP:/transfer.sqlite:ro" \
  --entrypoint sh node:24-alpine -c 'cp /transfer.sqlite /app/data/state.sqlite; rm -f /app/data/state.sqlite-wal /app/data/state.sqlite-shm; chown 1000:1000 /app/data/state.sqlite; chmod 0600 /app/data/state.sqlite' || true
 docker start movecar >/dev/null || true
}
trap rollback ERR
docker run --rm --user 0:0 --volumes-from movecar -v "$INPUT:/transfer.sqlite:ro" \
  --entrypoint sh node:24-alpine -c 'cp /transfer.sqlite /app/data/state.sqlite; rm -f /app/data/state.sqlite-wal /app/data/state.sqlite-shm; chown 1000:1000 /app/data/state.sqlite; chmod 0600 /app/data/state.sqlite'
docker start movecar >/dev/null
ready=0
for i in $(seq 1 35);do
 if curl -fsS --noproxy '*' http://127.0.0.1:8888/healthz >/dev/null 2>&1;then ready=1;break;fi
 sleep 2
done
[[ "$ready" -eq 1 ]] || { echo '数据库导入后服务未就绪' >&2;false; }
trap - ERR
echo '✅ 原管理员账号、历史记录、通知设置及原有设备绑定信息已导入。'
echo '请到网页后台「部署与迁移」修改网站及 TURN 域名，并确认 FCM 配置。'
echo "目标数据旧版本备份仍保存在 $BACKUP（请妥善保管）"
