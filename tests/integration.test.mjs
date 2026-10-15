import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = 'test_' + 'A'.repeat(42);
const startServer = (server) => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const closeServer = (server) => new Promise(resolve => server.close(resolve));

const sleep = (n) => new Promise(resolve => setTimeout(resolve, n));

test('single-car Worker KV/notification + owner token + persistent sqlite', async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'movecar-adapter-'));
  const barkCalls = [];
  const barkServer = http.createServer((req, res) => {
    barkCalls.push(`http://localhost${req.url}`);
    res.writeHead(200, {'Content-Type': 'application/json'}); res.end('{"code":200}');
  });
  await startServer(barkServer);
  const barkPort = barkServer.address().port;
  const listener = http.createServer((req, res) => { res.end('not used'); });
  await startServer(listener);
  const port = listener.address().port;
  await closeServer(listener);
  const origin = `http://127.0.0.1:${port}`;
  const env = {...process.env, PORT: String(port), PUBLIC_URL: origin,
    BARK_URL: `http://127.0.0.1:${barkPort}/bark/key`, OWNER_TOKEN: token,
    SOURCE_PATH: path.join(root, 'tests/fake-worker.js'), RATE_LIMIT_SECONDS:'0',
    DB_PATH: path.join(workDir,'state.sqlite')};
  let proc;
  async function start() {
    proc = spawn(process.execPath, ['server.mjs'], {cwd:root, env, stdio:'pipe'});
    let stderr='';
    proc.stderr.on('data', d => stderr += d.toString());
    for(let n=0;n<100;n++) {
      if(proc.exitCode !== null) throw new Error(stderr);
      try { if((await fetch(`${origin}/healthz`)).ok) return; } catch {}
      await sleep(50);
    }
    throw new Error('Server did not start '+stderr);
  }
  async function stop() {
    const p = proc;
    if (!p || p.exitCode !== null) return;
    const exit = new Promise(r=>p.once('exit',r));
    p.kill('SIGTERM');
    await exit;
  }
  try {
    await start();
    assert.equal((await fetch(`${origin}/healthz`)).status,200);
    assert.match(await (await fetch(origin)).text(), /MoveCar requester/);
    assert.equal((await fetch(`${origin}/owner-confirm`)).status, 403);
    assert.equal((await fetch(`${origin}/api/get-location`)).status, 403);
    assert.equal((await fetch(`${origin}/api/owner-confirm`, {method:'POST',body:'{}'})).status,403);
    assert.equal((await fetch(`${origin}/api/notify`,{method:'POST', body:'abc'})).status,400);
    const sent = await fetch(`${origin}/api/notify`,{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:'需要挪车',location:{lat:39.9,lng:116.4}})});
    assert.equal(sent.status,200, await sent.text());
    assert.equal(barkCalls.length,1);
    const deeplink = new URL(barkCalls[0]).searchParams.get('url');
    assert.equal(deeplink,`${origin}/owner-confirm?token=${token}`);
    assert.equal((await fetch(`${origin}/api/check-status`)).status,200);
    const authorized = await fetch(deeplink, {redirect:'manual'});
    assert.equal(authorized.status,303);
    assert.equal(authorized.headers.get('location'),'/owner-confirm');
    const cookie = authorized.headers.get('set-cookie').split(';')[0];
    assert.match(authorized.headers.get('set-cookie'), /HttpOnly/);
    assert.match(await (await fetch(`${origin}/owner-confirm`,{headers:{cookie}})).text(),/Owner page/);
    assert.equal((await fetch(`${origin}/api/get-location`,{headers:{cookie}})).status,200);
    const confirmed = await fetch(`${origin}/api/owner-confirm`, {method:'POST', headers:{cookie,'Content-Type':'application/json'},body:'{}'});
    assert.equal(confirmed.status,200);
    assert.deepEqual(await (await fetch(`${origin}/api/check-status`)).json(),{status:'confirmed'});
    await stop();
    await start();
    assert.deepEqual(await (await fetch(`${origin}/api/check-status`)).json(),{status:'confirmed'});
  } finally {
    await stop();
    await closeServer(barkServer);
    fs.rmSync(workDir, {recursive:true,force:true});
  }
});
