#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
docker compose exec -T movecar sh -c 'if [ -f /app/data/admin-initial-password ]; then cat /app/data/admin-initial-password; else echo "初始密码已失效；请使用修改后的密码。"; fi'
