#!/usr/bin/env bash
# Refresh coturn's private TLS copy when 1Panel renews the EXISTING cert.
# No ACME/Let's Encrypt/Caddy calls: 1Panel is sole certificate manager.
set -Eeuo pipefail
ROOT="${1:?Usage: sync-turn-cert.sh PROJECT_DIR TURN_DOMAIN [--no-restart]}"
DOMAIN="${2:?Missing TURN hostname}"
RESTART="${3:-}"
[[ "$(id -u)" -eq 0 ]] || { echo "Run as root" >&2;exit 1; }
ROOT="$(cd "$ROOT" && pwd -P)"
ENVFILE="$ROOT/.env"
[[ -f "$ENVFILE" ]] || { echo "MoveCar .env missing" >&2;exit 1; }
CERT="$(sed -n 's/^ONEPANEL_TLS_CERT=//p' "$ENVFILE" | tail -1)"
KEY="$(sed -n 's/^ONEPANEL_TLS_KEY=//p' "$ENVFILE" | tail -1)"
[[ -n "$CERT" && -n "$KEY" && -f "$CERT" && -f "$KEY" ]] || {
 echo "1Panel-managed certificate/key paths not configured or missing" >&2;exit 1;
}
openssl x509 -in "$CERT" -noout -checkend 86400 >/dev/null ||
 { echo "Certificate expires in <24 hours; check 1Panel automatic renewal" >&2;exit 1; }
openssl x509 -in "$CERT" -noout -checkhost "$DOMAIN" |
 grep -q 'does match' || { echo "1Panel certificate does not cover TURN hostname" >&2;exit 1; }
CERT_PUB="$(openssl x509 -in "$CERT" -noout -pubkey | openssl sha256)"
KEY_PUB="$(openssl pkey -in "$KEY" -pubout 2>/dev/null | openssl sha256)"
[[ "$CERT_PUB" == "$KEY_PUB" ]] || { echo "Certificate/key mismatch" >&2;exit 1; }
DEST="$ROOT/data/onepanel/turn-tls"
mkdir -p "$DEST";chown 0:65534 "$DEST";chmod 0750 "$DEST"
if cmp -s "$CERT" "$DEST/fullchain.pem" && cmp -s "$KEY" "$DEST/privkey.pem";then
 echo "1Panel TLS certificate unchanged"
 exit 0
fi
TMP1="$(mktemp "$DEST/.cert.XXXXXX")"
TMP2="$(mktemp "$DEST/.key.XXXXXX")"
trap 'rm -f "$TMP1" "$TMP2"' EXIT
install -m 0640 -o 0 -g 65534 "$CERT" "$TMP1"
install -m 0640 -o 0 -g 65534 "$KEY" "$TMP2"
mv -f "$TMP1" "$DEST/fullchain.pem"
mv -f "$TMP2" "$DEST/privkey.pem"
trap - EXIT
echo "Synced renewed 1Panel TLS files for $DOMAIN"
if [[ "$RESTART" != "--no-restart" ]] && docker container inspect movecar-hk-turn >/dev/null 2>&1;then
 docker restart movecar-hk-turn >/dev/null
 echo "Reloaded coturn TLS certificate (existing calls may briefly reconnect)"
fi
