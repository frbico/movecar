#!/usr/bin/env bash
# MoveCar one-time migration from legacy dirty branches to release/stable.
# This is a NEW filename to avoid the previous cached installer response.
set -Eeuo pipefail
[[ "$(id -u)" == 0 ]] || { echo '请以 root 或 sudo 运行' >&2;exit 1; }
command -v curl >/dev/null || { echo '缺少 curl' >&2;exit 1; }
tmp="$(mktemp /tmp/movecar-host-updater.XXXXXX.sh)"
trap 'rm -f "$tmp"' EXIT
url="https://raw.githubusercontent.com/frbico/movecar/release/stable/scripts/host-updater.sh?cache-bust=$(date +%s)"
curl -fLsS --retry 3 --max-time 60 -H 'Cache-Control: no-cache' "$url" -o "$tmp"
grep -q 'Fixed official stable channel' "$tmp" || { echo '下载到非预期的升级程序，已停止执行';exit 1; }
bash -n "$tmp" || { echo '升级程序语法校验失败';exit 1; }
echo '已核对新版独立更新器；开始保留数据地升级。'
bash "$tmp" apply
echo '升级完成后进入网站后台 → 版本更新，即可检查并安装后续版本。'
