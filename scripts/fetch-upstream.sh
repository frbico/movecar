#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REV="${UPSTREAM_REF:-main}"
if [[ ! "$REV" =~ ^[[:alnum:]_.-]+$ ]]; then echo 'UPSTREAM_REF 不合法' >&2; exit 1; fi
URL="https://raw.githubusercontent.com/lesnolie/movecar/${REV}"
if [[ -s "$ROOT/upstream/movecar.js" && "${FORCE_UPSTREAM:-0}" != 1 ]]; then
  echo '沿用本地 upstream/movecar.js（设置 FORCE_UPSTREAM=1 可重新获取）'
  exit 0
fi
command -v curl >/dev/null || { echo '请先安装 curl' >&2; exit 1; }
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
printf '下载原项目：%s\n' "$URL/movecar.js"
curl --fail --location --retry 2 --connect-timeout 10 --max-time 60 "$URL/movecar.js" -o "$tmp"
if ! grep -q "addEventListener('fetch'" "$tmp" || ! grep -q 'renderMainPage' "$tmp"; then
  echo '原项目源代码格式改变，请人工审查后再使用。' >&2; exit 1
fi
mv "$tmp" "$ROOT/upstream/movecar.js"
curl --fail --location --retry 2 --connect-timeout 10 --max-time 30 "$URL/LICENSE" -o "$ROOT/upstream/LICENSE" || true
printf '已保存源代码到 upstream/movecar.js。生产环境建议将 UPSTREAM_REF 固定为审核过的 commit SHA。\n'
