#!/bin/sh
# Restart only this coturn worker when the admin panel rewrites its valid config.
# No privileged Docker socket is exposed to the web backend.
set -eu
CONF=/runtime/turnserver.conf
fingerprint(){
  { cat "$CONF" 2>/dev/null || :; cat /runtime/tls/fullchain.pem 2>/dev/null || :;
    cat /runtime/tls/privkey.pem 2>/dev/null || :; } | sha256sum | cut -d' ' -f1
}
while [ ! -s "$CONF" ];do echo "Waiting for MoveCar TURN configuration...";sleep 2;done
while :;do
  previous="$(fingerprint)"
  turnserver -c "$CONF" --log-file=stdout &
  pid=$!
  while kill -0 "$pid" 2>/dev/null;do
    sleep 6
    current="$(fingerprint)"
    if [ "$current" != "$previous" ];then
      echo "TURN configuration/certificate changed; safely restarting coturn."
      kill -TERM "$pid" 2>/dev/null || :
      wait "$pid" 2>/dev/null || :
      break
    fi
  done
  wait "$pid" 2>/dev/null || :
  sleep 2
done
