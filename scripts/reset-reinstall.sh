#!/usr/bin/env bash
# Remove ONLY known MoveCar test installations, then install universal MoveCar.
# Backups are retained under /root; 1Panel and other apps are never removed.
set -Eeuo pipefail
die(){ echo "❌ $*" >&2;exit 1; }
[[ "$(id -u)" == 0 ]] || die '请使用 root/sudo 执行'
for tool in docker git curl python3 openssl;do command -v "$tool" >/dev/null || die "缺少依赖 $tool";done
docker compose version >/dev/null || die '需要 Docker Compose V2'
BACKUP="/root/movecar-reset-backups/$(date -u +%Y%m%dT%H%M%SZ)-$$"
umask 077
mkdir -p "$BACKUP"
chmod 0700 "$BACKUP"
echo "准备清理香港 MoveCar 测试安装；保护性备份：$BACKUP"
echo '注意：本机的 MoveCar 管理员账号、历史记录、FCM 配对将重新生成。'
echo '1Panel、其他容器、其他 Docker 数据卷、公网防火墙和 SSL 证书不会删除。'

# Strict path allowlist. Never delete a symlink or an unrelated directory.
is_movecar_repo(){
  local dir="$1" origin=''
  [[ -d "$dir" && ! -L "$dir" && -f "$dir/compose.yaml" ]] || return 1
  if [[ -d "$dir/.git" ]];then
    origin="$(git -C "$dir" remote get-url origin 2>/dev/null || true)"
    [[ "$origin" == *frbico/movecar* ]] && return 0
  fi
  grep -q 'container_name: movecar' "$dir/compose.yaml"
}
for dir in /opt/movecar /opt/movecar-hk /root/movecar-voice-fresh /root/movecar-hk;do
  if [[ -e "$dir" || -L "$dir" ]];then
    is_movecar_repo "$dir" || die "$dir 无法确认是 MoveCar 项目；为避免误删已停止"
    dest="$BACKUP/$(printf %s "$dir" | tr / _)"
    mkdir -p "$dest"
    if [[ -f "$dir/.env" ]];then
      cp -p "$dir/.env" "$dest/dot-env"
      chmod 0600 "$dest/dot-env"
    fi
  fi
done

# Stop only specifically named MoveCar-owned services and scheduled jobs.
if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]];then
  for unit in movecar-hk-turn-cert movecar-onepanel-turn-cert movecar-cert-sync movecar-turn-health;do
    systemctl disable --now "$unit.timer" >/dev/null 2>&1 || true
    systemctl stop "$unit.service" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/$unit.timer" "/etc/systemd/system/$unit.service"
  done
  systemctl disable --now movecar-firewall.service >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/movecar-firewall.service
  systemctl daemon-reload
fi

# Stop DB writes, then preserve backup data before erasing the test stack.
if docker container inspect movecar >/dev/null 2>&1;then
  docker stop movecar >/dev/null 2>&1 || true
  mkdir -p "$BACKUP/old-app-data"
  if docker cp 'movecar:/app/data/.' "$BACKUP/old-app-data/" >/dev/null 2>&1;then
    chmod -R go-rwx "$BACKUP/old-app-data"
    echo '已保护性备份完整 MoveCar 数据目录（含记录附件）'
  fi
  for item in state.sqlite state.sqlite-wal state.sqlite-shm firebase-service-account.json admin-initial-password;do
    if docker cp "movecar:/app/data/$item" "$BACKUP/$item" >/dev/null 2>&1;then
      chmod 0600 "$BACKUP/$item"
      echo "备份旧数据：$item"
    fi
  done
fi

for name in movecar movecar-turn movecar-hk-turn movecar-hk-caddy;do
  if docker container inspect "$name" >/dev/null 2>&1;then
    echo "删除 MoveCar 容器：$name"
    docker rm -f "$name" >/dev/null
  fi
done
# Named volumes of the MoveCar codebase only; never run docker system prune.
while IFS= read -r name;do
  case "$name" in
    movecar_data|*_movecar_data)
      echo "删除 MoveCar 测试数据卷：$name"
      docker volume rm "$name" >/dev/null || die "数据卷 $name 仍被占用，停止以免污染新版本"
      ;;
  esac
done < <(docker volume ls --format '{{.Name}}')
for network in movecar_default movecar-hk_default movecar-voice-fresh_default movecar_hk_default;do
  docker network rm "$network" >/dev/null 2>&1 || true
done
for dir in /opt/movecar /opt/movecar-hk /root/movecar-voice-fresh /root/movecar-hk;do
  if [[ -d "$dir" ]];then
    echo "删除旧 MoveCar 安装目录：$dir"
    rm -rf -- "$dir"
  fi
done
# Remove only obsolete MoveCar build images. Do not globally prune Docker
# layers or remove coturn/Caddy images that other projects might use.
while IFS= read -r image;do
  case "$image" in
    movecar-movecar:*|movecar-hk-movecar:*|movecar-voice-fresh-movecar:*)
      docker image rm "$image" >/dev/null 2>&1 || true
      ;;
  esac
done < <(docker image ls --format '{{.Repository}}:{{.Tag}}')
# Undo obsolete extra relay-pool UFW/firewalld rule only (not 1Panel 80/443).
if command -v ufw >/dev/null 2>&1;then
  ufw --force delete allow 49160:49260/udp >/dev/null 2>&1 || true
fi
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1;then
  firewall-cmd --permanent --remove-port=49160-49260/udp >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
fi

echo '====== 开始重新安装 MoveCar 通用版 ======'
curl -fsSL --connect-timeout 15 --max-time 90 \
  https://raw.githubusercontent.com/frbico/movecar/feature/onboarding-firewall-cert-sync/scripts/install-universal.sh \
  -o "$BACKUP/install-universal.sh" || die "下载安装程序失败；备份位置：$BACKUP"
bash "$BACKUP/install-universal.sh" || die "重新安装失败；备份位置：$BACKUP"
echo "✅ 重新安装完成；旧配置/数据备份保存在 $BACKUP"
echo '原 1Panel 反代及证书保留，首次登录后台请重新完成环境配置向导。'
