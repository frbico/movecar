#!/usr/bin/env bash
# Clean MoveCar voice test deploy. Run on the existing Linux host with Docker.
# Usage: bash scripts/setup-voice-fresh.sh ~/firebase-service-account.json https://your-domain
set -Eeuo pipefail
KEY="${1:-$HOME/firebase-service-account.json}"
DOMAIN="${2:-}"
DIR="${MOVECAR_DIR:-$HOME/movecar-voice-fresh}"
fail(){ echo "ERROR: $*" >&2; exit 1; }
for c in git docker curl python3 openssl realpath; do command -v "$c" >/dev/null || fail "Missing $c"; done
docker compose version >/dev/null || fail "Docker Compose V2 required"
test -f "$KEY" || fail "Missing Firebase key: $KEY"
KEY="$(realpath "$KEY")"
chmod 600 "$KEY"
python3 - "$KEY" <<'PY'
import json,sys
with open(sys.argv[1], encoding="utf-8") as f: k=json.load(f)
assert k.get("type")=="service_account" and k.get("private_key","").startswith("-----BEGIN PRIVATE KEY-----"), "Not a service account private key"
assert k.get("project_id") and k.get("client_email"), "Incomplete Firebase key"
print("PASS Firebase service account format, project:", k["project_id"])
PY
if [ -n "$DOMAIN" ]; then
  case "$DOMAIN" in https://*) ;; *) fail "Second argument must be https://your-domain" ;; esac
  DOMAIN="${DOMAIN%/}"
fi
if [ -e "$DIR" ] && [ ! -d "$DIR/.git" ]; then fail "$DIR exists but is not a Git checkout"; fi
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch origin feature/native-screen-off-voip
  git -C "$DIR" switch feature/native-screen-off-voip
  git -C "$DIR" pull --ff-only origin feature/native-screen-off-voip
else
  git clone -b feature/native-screen-off-voip --single-branch https://github.com/frbico/movecar.git "$DIR"
fi
cd "$DIR"
bash scripts/fetch-upstream.sh
CODE=''
if [ -f .env ]; then CODE="$(sed -n 's/^VOICE_PAIRING_SECRET=//p' .env | tail -1)"; fi
if ! [[ "$CODE" =~ ^[0-9a-f]{64}$ ]]; then CODE="$(openssl rand -hex 32)"; fi
umask 077
cat > .env <<ENV
HOST_BIND=127.0.0.1
HOST_PORT=8888
VOICE_PAIRING_SECRET=$CODE
VOICE_TURN_URLS=
VOICE_TURN_SHARED_SECRET=
ENV
chmod 600 .env
# Remove the named old MoveCar container only. No unrelated containers/volumes touched.
if docker container inspect movecar >/dev/null 2>&1; then docker rm -f movecar >/dev/null; fi
docker compose up -d --build
docker cp "$KEY" movecar:/app/data/firebase-service-account.json
docker exec -u root movecar sh -c 'chown node:node /app/data/firebase-service-account.json && chmod 600 /app/data/firebase-service-account.json'
docker compose restart movecar
READY=0
for i in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8888/healthz >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" != 1 ]; then docker compose logs --tail=60 movecar >&2; fail 'Server health check failed'; fi
echo 'PASS Local /healthz'
curl -fsS http://127.0.0.1:8888/api/voice/config; echo
docker exec movecar node -e 'const k=require("/app/data/firebase-service-account.json");if(k.type!=="service_account"||!k.private_key)process.exit(1);console.log("PASS Key readable in Docker")'
if [ -n "$DOMAIN" ]; then
  curl -fsS --max-time 15 "$DOMAIN/healthz"; echo
  curl -fsS --max-time 15 "$DOMAIN/api/voice/config"; echo
fi
echo 'SERVER READY. Use these values to pair the S24 Ultra:'
printf 'Website: %s\n' "${DOMAIN:-your existing HTTPS domain}"
printf 'Pairing secret (keep private): %s\n' "$CODE"
echo 'After pairing, re-check /api/voice/config for ready:true'
