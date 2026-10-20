#!/usr/bin/env python3
"""Minimal external STUN/TURN health probe, no extra dependencies.

Usage: python3 scripts/turn-probe.py --host turn.ssxi.de --secret-env-file .env
No secret appears in command line, stdout, or error messages. Uses TURN REST
HMAC credentials and a real UDP Allocate transaction, not a ping or TCP port check.
"""
import argparse
import base64
import hashlib
import hmac
import os
import secrets
import socket
import ssl
import struct
import sys
import time

COOKIE=0x2112A442
def attrs(items):
    out=b''
    for t,v in items:
        out+=struct.pack('!HH',t,len(v))+v+b'\0'*((-len(v))%4)
    return out

def msg(t,tid,attr=b'',key=None):
    # RFC 5389: length includes MESSAGE-INTEGRITY but the HMAC is over all
    # bytes before that attribute, with header length set as if MI were present.
    length=len(attr)+(24 if key else 0)
    header=struct.pack('!HHI12s',t,length,COOKIE,tid)
    if key:
        mac=hmac.new(key,header+attr,hashlib.sha1).digest()
        return header+attr+struct.pack('!HH',0x0008,20)+mac
    return header+attr

def parse(raw,tid):
    if len(raw)<20:raise ValueError('short STUN response')
    typ,length,cookie,rid=struct.unpack('!HHI12s',raw[:20])
    if cookie!=COOKIE or rid!=tid or length+20>len(raw):raise ValueError('unmatched STUN response')
    values={}
    cursor=20
    while cursor+4<=20+length:
        code,size=struct.unpack('!HH',raw[cursor:cursor+4])
        begin=cursor+4;end=begin+size
        if end>len(raw):raise ValueError('truncated STUN attribute')
        values.setdefault(code,[]).append(raw[begin:end])
        cursor=end+((-size)%4)
    return typ,values

def receive(s,t,id,attrs_bytes=b'',key=None):
    s.send(msg(t,id,attrs_bytes,key))
    data=s.recv(4096)
    return parse(data,id)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--host',required=True)
    ap.add_argument('--connect-ip',help='Optional direct IP for local probe, while preserving TLS SNI/hostname validation')
    ap.add_argument('--port',type=int,default=3478)
    ap.add_argument('--tls-port',type=int,default=5349)
    ap.add_argument('--no-tls',action='store_true',help='Skip TLS 5349 when no 1Panel cert is configured')
    ap.add_argument('--secret-env-file',help='MoveCar .env holding VOICE_TURN_SHARED_SECRET')
    args=ap.parse_args()
    host=args.host.strip()
    # DNS-only/direct TURN hostname; refuse HTTP URLs.
    if '/' in host or ':' in host:ap.error('--host must be a plain DNS hostname')
    sock=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
    sock.settimeout(5)
    dest=args.connect_ip or host
    addr=(dest,args.port)
    try:
        tid=secrets.token_bytes(12)
        sock.connect(addr)
        typ,_=receive(sock,0x0001,tid)
        if typ!=0x0101:raise RuntimeError(f'STUN Binding unexpected reply type {typ:#x}')
        print('PASS: UDP 3478 STUN Binding')
        if args.secret_env_file:
            secret=''
            with open(args.secret_env_file,encoding='utf-8') as f:
                for line in f:
                    if line.startswith('VOICE_TURN_SHARED_SECRET='):
                        secret=line.partition('=')[2].strip().strip('\\\"\'')
            if len(secret)<20:raise RuntimeError('Missing/short VOICE_TURN_SHARED_SECRET')
            tid=secrets.token_bytes(12)
            req=attrs([(0x0019,b'\x11\0\0\0')])
            typ,v=receive(sock,0x0003,tid,req)
            if typ!=0x0113:raise RuntimeError('TURN challenge (401) not returned')
            realm=v.get(0x0014,[b''])[0].decode('utf-8')
            nonce=v.get(0x0015,[b''])[0]
            if not realm or not nonce:raise RuntimeError('TURN challenge missing realm/nonce')
            username=str(int(time.time())+3600)+':movecar'
            pwd=base64.b64encode(hmac.new(secret.encode(),username.encode(),hashlib.sha1).digest()).decode()
            key=hashlib.md5((username+':'+realm+':'+pwd).encode()).digest()
            id2=secrets.token_bytes(12)
            att=attrs([(0x0019,b'\x11\0\0\0'),(0x0006,username.encode()),
                       (0x0014,realm.encode()),(0x0015,nonce)])
            typ,v=receive(sock,0x0003,id2,att,key)
            if typ!=0x0103 or not v.get(0x0016):
                error=v.get(0x0009,[b''])[0]
                code=f'{error[2]*100+error[3]}' if len(error)>=4 else 'unknown'
                raise RuntimeError('TURN authenticated UDP allocation failed (code='+code+')')
            print('PASS: authenticated UDP TURN Allocate with short-lived REST credentials')
    finally:sock.close()
    if args.no_tls:
        print('SKIP: TURN/TLS 5349 not enabled (provide 1Panel wildcard certificate paths)')
        return
    # Also test TLS certificate hostname/trust and that coturn accepts STUN over TLS.
    context=ssl.create_default_context()
    with socket.create_connection((dest,args.tls_port),timeout=7) as raw:
        with context.wrap_socket(raw,server_hostname=host) as tls:
            tls.settimeout(6)
            tid=secrets.token_bytes(12)
            packet=msg(0x0001,tid)
            tls.sendall(packet)
            header=tls.recv(20)
            while len(header)<20:
                part=tls.recv(20-len(header))
                if not part:raise RuntimeError('TLS STUN connection closed early')
                header+=part
            size=struct.unpack('!H',header[2:4])[0]
            body=b''
            while len(body)<size:
                part=tls.recv(size-len(body))
                if not part:raise RuntimeError('TLS STUN payload was truncated')
                body+=part
            typ,_=parse(header+body,tid)
            if typ!=0x0101:raise RuntimeError('TLS STUN Binding unexpected reply')
            print('PASS: TLS 5349 with trusted certificate + STUN Binding')
    print('NOTE: these tests verify TURN availability, not real China-operator latency or a full two-device WebRTC media path.')
    if args.connect_ip:print('NOTE: local IP override was used; test again from another network for firewall/reachability.')

if __name__=='__main__':
    try:main()
    except (ValueError,RuntimeError,OSError,ssl.SSLError) as e:
        print('FAIL:',e,file=sys.stderr)
        sys.exit(1)
