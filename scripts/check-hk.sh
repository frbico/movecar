#!/usr/bin/env bash
# One command health check for co-located 1Panel MoveCar and coturn.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ -f .env ]] || { echo "Missing .env; run scripts/deploy-hk.sh first" >&2;exit 1; }
SITE="$(sed -n 's/^HK_SITE_DOMAIN=//p' .env | tail -1)"
TURN="$(sed -n 's/^HK_TURN_DOMAIN=//p' .env | tail -1)"
CERT="$(sed -n 's/^ONEPANEL_TLS_CERT=//p' .env | tail -1)"
[[ -n "$SITE" && -n "$TURN" ]] || { echo "Missing domain settings" >&2;exit 1; }
echo "Checking local MoveCar backend (without disrupting 1Panel):"
curl --noproxy '*' -fsS --max-time 8 http://127.0.0.1:8888/healthz
echo
curl --noproxy '*' -fsS --max-time 8 http://127.0.0.1:8888/api/voice/config
echo
if [[ -n "$CERT" ]];then
 python3 scripts/turn-probe.py --host "$TURN" --connect-ip 127.0.0.1 --secret-env-file .env
else
 python3 scripts/turn-probe.py --host "$TURN" --connect-ip 127.0.0.1 --secret-env-file .env --no-tls
fi
echo "MoveCar website: https://$SITE"
echo "TURN DNS-only hostname: $TURN"
echo
docker compose -f compose.yaml -f compose.hk.yaml ps
echo
echo "Local tests passed. Use a mainland-China phone to check external TURN reachability and real audio quality."
