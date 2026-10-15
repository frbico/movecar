#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
if [[ ! -f .env ]]; then echo '先执行 ./install.sh 生成 .env，或参照 .env.example 手动创建'; exit 1; fi
./scripts/fetch-upstream.sh
command -v node >/dev/null || { echo '本地运行需要 Node.js 24；或者直接使用 Docker 安装。'; exit 1; }
major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if ((major < 24)); then echo '本地运行请使用 Node.js 24 或更高版本。'; exit 1; fi
# Parse .env as data, not shell code. HOST_PORT is handled by server.mjs.
# Node 24+ supports --env-file natively.
exec node --env-file=.env server.mjs
