#!/usr/bin/env bash
set -Eeuo pipefail
usage() { echo "Usage: bash scripts/check-hk.sh [--site movecar.ssxi.de --turn turn.ssxi.de]"; }
SITE='' TURN=''
while (($#));do
  case "$1" in
    --site) SITE="${2:?}";shift 2;;
    --turn) TURN="${2:?}";shift 2;;
    --help) usage;exit 0;;
    *) usage;exit 2;;
  esac
done
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [[ -f .env ]];then
  [[ -n "$SITE" ]] || SITE="$(sed -n 's/^HK_SITE_DOMAIN=//p' .env | tail -1)"
  [[ -n "$TURN" ]] || TURN="$(sed -n 's/^HK_TURN_DOMAIN=//p' .env | tail -1)"
fi
[[ -n "$SITE" && -n "$TURN" ]] || { echo 'Set --site and --turn, or deploy via deploy-hk.sh first.' >&2; exit 2; }
echo "HTTPS website: https://$SITE"
curl -fsS --connect-timeout 7 --max-time 20 "https://$SITE/healthz"
echo
echo "Voice API:"
curl -fsS --connect-timeout 7 --max-time 20 "https://$SITE/api/voice/config"
echo
echo "Caddy TURN domain TLS: https://$TURN"
curl -fsS --connect-timeout 7 --max-time 20 "https://$TURN/" >/dev/null
echo "PASS HTTPS site + TURN certificate hostname"
echo
if [[ -f .env ]];then
  python3 scripts/turn-probe.py --host "$TURN" --secret-env-file .env
else
  python3 scripts/turn-probe.py --host "$TURN"
fi
echo
if command -v docker >/dev/null 2>&1;then
  docker compose -f compose.yaml -f compose.hk.yaml ps
fi
echo
echo "Checks above run FROM THIS HOST. Test a mainland-China mobile connection separately."
