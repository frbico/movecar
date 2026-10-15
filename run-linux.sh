#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
bash ./scripts/fetch-upstream.sh
command -v node >/dev/null || { echo '需要 Node.js 24 或更高版本。'; exit 1; }
major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if ((major < 24)); then echo '需要 Node.js 24 或更高版本。'; exit 1; fi
exec node server.mjs
