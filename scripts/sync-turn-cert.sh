#!/usr/bin/env bash
# Synchronize Caddy's automatically renewed TURN hostname certificate to coturn.
# Run as root; a systemd timer periodically calls this after installation.
set -Eeuo pipefail
ROOT="${1:?Usage: sync-turn-cert.sh PROJECT_DIR TURN_HOSTNAME [--no-restart]}"
DOMAIN="${2:?Missing TURN hostname}"
RESTART="${3:-}"
[[ "$DOMAIN" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]{1,251}[a-zA-Z0-9]$ ]] || { echo "Invalid TURN hostname" >&2; exit 2; }
command -v openssl >/dev/null || { echo "openssl required" >&2; exit 2; }
[[ "$(id -u)" == 0 ]] || { echo "Run certificate sync as root" >&2; exit 2; }
ROOT="$(cd "$ROOT" && pwd -P)"
CERT_ROOT="$ROOT/data/hk/caddy/caddy/certificates"
DST="$ROOT/data/hk/turn-tls"
[[ -d "$CERT_ROOT" ]] || { echo "Caddy has not issued a certificate yet: $CERT_ROOT" >&2; exit 1; }
CRT="$(find "$CERT_ROOT" -type f -name "$DOMAIN.crt" -print -quit)"
[[ -n "$CRT" && -f "$CRT" ]] || { echo "Caddy certificate for $DOMAIN not found" >&2; exit 1; }
KEY="${CRT%.crt}.key"
[[ -f "$KEY" ]] || { echo "Caddy certificate key for $DOMAIN missing" >&2; exit 1; }
openssl x509 -in "$CRT" -noout -checkend 86400 >/dev/null || { echo "TURN certificate expires soon" >&2; exit 1; }
openssl x509 -in "$CRT" -noout -checkhost "$DOMAIN" | grep -q 'does match' || {
  echo "TURN certificate hostname mismatch" >&2; exit 1;
}
PUB_CERT="$(openssl x509 -in "$CRT" -pubkey -noout | openssl sha256)"
PUB_KEY="$(openssl pkey -in "$KEY" -pubout 2>/dev/null | openssl sha256)"
[[ "$PUB_CERT" == "$PUB_KEY" ]] || { echo "TURN certificate/key mismatch" >&2; exit 1; }
mkdir -p "$DST"
# Official coturn image uses nobody:nogroup (65534:65534).
chown 0:65534 "$DST"
chmod 0750 "$DST"
if cmp -s "$CRT" "$DST/fullchain.pem" && cmp -s "$KEY" "$DST/privkey.pem"; then
  echo "TURN TLS certificate unchanged; restart not required."
  exit 0
fi
tmpcert="$(mktemp "$DST/.cert.XXXXXX")"
tmpkey="$(mktemp "$DST/.key.XXXXXX")"
trap 'rm -f "$tmpcert" "$tmpkey"' EXIT
install -m 0640 -o 0 -g 65534 "$CRT" "$tmpcert"
install -m 0640 -o 0 -g 65534 "$KEY" "$tmpkey"
mv -f "$tmpcert" "$DST/fullchain.pem"
mv -f "$tmpkey" "$DST/privkey.pem"
trap - EXIT
echo "Updated TURN TLS certificate for $DOMAIN"
if [[ "$RESTART" != "--no-restart" ]] && docker container inspect movecar-hk-turn >/dev/null 2>&1; then
  docker restart movecar-hk-turn >/dev/null
  echo "Restarted coturn to activate renewed certificate."
fi
