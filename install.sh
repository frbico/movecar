#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
command -v docker >/dev/null || { echo '未找到 Docker，请先安装 Docker Engine 和 Compose 插件。' >&2; exit 1; }
docker compose version >/dev/null || { echo '缺少 docker compose 插件。' >&2; exit 1; }
bash ./scripts/fetch-upstream.sh
docker compose up -d --build
printf '\n✅ MoveCar 已部署，监听 8888 端口。\n'
printf '后台入口：http://你的服务器IP:8888/admin\n'
printf '首次管理员密码（仅在未修改密码前显示）：\n'
docker compose exec -T movecar sh -c 'if [ -f /app/data/admin-initial-password ]; then cat /app/data/admin-initial-password; else echo "密码已修改，请使用新密码登录"; fi'
printf '\n注意：公网访问后台应启用 HTTPS 或先通过 SSH 隧道访问。\n'
printf '查询状态：docker compose ps\n'
