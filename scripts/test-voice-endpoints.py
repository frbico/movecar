#!/usr/bin/env python3
"""MoveCar FCM/WebRTC smoke tests. Standard library only. Never prints secrets."""
import argparse
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

def request(base, method, route, payload=None):
    data = None if payload is None else json.dumps(payload).encode('utf-8')
    headers = {'Accept': 'application/json'}
    if data is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(base + route, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            body = response.read(128000).decode('utf-8')
            return body if route == '/healthz' else json.loads(body)
    except urllib.error.HTTPError as exc:
        body = exc.read(2048).decode('utf-8', 'replace')
        try:
            message = json.loads(body).get('error', 'unknown server error')
        except ValueError:
            message = body[:200]
        raise RuntimeError(f'{route}: HTTP {exc.code} - {message}') from exc

def main():
    parser = argparse.ArgumentParser(description='Test MoveCar HTTPS/FCM setup without exposing credentials')
    parser.add_argument('--url', required=True, help='e.g. https://car.example.com')
    parser.add_argument('--key', type=pathlib.Path, help='local firebase-service-account.json to validate')
    parser.add_argument('--ring', action='store_true', help='send a real FCM ringing request (no media); auto end after 15 seconds')
    args = parser.parse_args()
    url = args.url.strip().rstrip('/')
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        parser.error('--url must be an HTTPS origin without path or query')

    if args.key:
        key = json.loads(args.key.read_text(encoding='utf-8'))
        for field in ('type', 'project_id', 'client_email', 'private_key'):
            if not isinstance(key.get(field), str) or not key[field]:
                raise ValueError(f'Key file invalid: missing {field}')
        if key['type'] != 'service_account' or 'BEGIN PRIVATE KEY' not in key['private_key']:
            raise ValueError('Key file must be a Firebase service account JSON, not google-services.json')
        print(f'PASS Firebase server key syntax: project_id={key["project_id"]} (private key not printed)')

    health = request(url, 'GET', '/healthz')
    if health.strip() != 'ok':
        raise RuntimeError(f'/healthz unexpected result {health[:100]!r}')
    print('PASS HTTPS /healthz')
    config = request(url, 'GET', '/api/voice/config')
    if not isinstance(config, dict):
        raise RuntimeError('Config response is not a JSON object')
    print(f'VOICE CONFIG: enabled={config.get("enabled")} ready={config.get("ready")}')
    if config.get('enabled') is not True:
        raise RuntimeError('Voice not enabled: check .env VOICE_PAIRING_SECRET and Docker service configuration')
    if config.get('ready') is not True:
        print('NEXT: open Android MoveCar app, enter HTTPS site URL and VOICE_PAIRING_SECRET, pair phone, then rerun test')
        if args.ring:
            raise RuntimeError('Cannot ring until phone is paired (ready=true)')
        return
    print('PASS Android owner device paired')

    if args.ring:
        print('Sending FCM incoming_call; this test does not start WebRTC media...')
        call = request(url, 'POST', '/api/voice/start', {})
        cid, tok = call['callId'], call['token']
        print('PASS FCM API accepted call; check whether Galaxy phone rings now.')
        print('Keeping ringing/call open for 15 seconds; please do not repeat immediately (90-second rate limit).')
        try:
            time.sleep(15)
        finally:
            try:
                request(url, 'POST', f'/api/voice/calls/{cid}/end', {'token': tok})
                print('PASS Test call ended; no lingering active session.')
            except Exception as exc:
                print(f'WARN Test call cleanup failed: {exc}', file=sys.stderr)
    else:
        print('NEXT: run again with --ring to test FCM, or open /voice/caller on a second phone for two-way audio')

if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError, urllib.error.URLError) as exc:
        print(f'FAIL: {exc}', file=sys.stderr)
        sys.exit(1)
