#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
command -v docker >/dev/null || { echo '未发现 Docker。先安装 Docker Engine + Compose 插件。'; exit 1; }
docker compose version >/dev/null || { echo '未发现 docker compose 插件。'; exit 1; }
./scripts/fetch-upstream.sh
if [[ ! -f .env ]]; then
  echo '首次部署：需要输入对外访问地址、Bark 推送链接。'
  if [[ -z "${PUBLIC_URL:-}" ]]; then
    read -r -p '公网 HTTPS 地址（例如 https://car.example.com；本机测试可填 http://127.0.0.1:8080）：' PUBLIC_URL
  fi
  if [[ -z "${BARK_URL:-}" ]]; then
    read -r -s -p 'Bark 推送地址（https://api.day.app/你的Key）：' BARK_URL
    echo
  fi
  [[ "$PUBLIC_URL" =~ ^https?://[[:alnum:].-]+(:[0-9]+)?/?$ ]] || { echo 'PUBLIC_URL 必须是 http(s) 域名或 IP 地址，不要包含路径或查询参数'; exit 1; }
  [[ "$BARK_URL" =~ ^https?://[^[:space:]]+$ ]] || { echo 'BARK_URL 格式不正确'; exit 1; }
  if [[ -z "${OWNER_TOKEN:-}" ]]; then
    OWNER_TOKEN="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  fi
  umask 077
  {
    printf 'PUBLIC_URL=%s\n' "$PUBLIC_URL"
    printf 'BARK_URL=%s\n' "$BARK_URL"
    printf 'OWNER_TOKEN=%s\n' "$OWNER_TOKEN"
    printf 'PHONE_NUMBER=\n'
    printf 'RATE_LIMIT_SECONDS=60\n'
    printf 'HOST_BIND=127.0.0.1\n'
    printf 'HOST_PORT=8080\n'
  } > .env
  echo '已生成 .env（含敏感 Bark Key、车主令牌，请妥善保管）。'
fi
docker compose up -d --build
printf '\n服务已提交启动。查看：docker compose ps；日志：docker compose logs -f\n'
printf '反向代理到本机 http://127.0.0.1:8080，HTTPS 域名应与 PUBLIC_URL 相同。\n'
