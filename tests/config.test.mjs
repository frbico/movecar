import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('fails safely if the upstream Worker has not been downloaded',()=>{
  const r=spawnSync(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,DB_PATH:'/tmp/movecar-config-test-unreachable.sqlite',SOURCE_PATH:'/does/not/exist/movecar.js'},encoding:'utf8',timeout:3000});
  assert.notEqual(r.status,0);assert.match(r.stderr,/Upstream Worker missing/);
});
