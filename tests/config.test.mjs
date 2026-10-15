import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('rejects the example owner token before listening', () => {
  const result = spawnSync(process.execPath, ['server.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: '18080',
      PUBLIC_URL: 'http://127.0.0.1:18080',
      BARK_URL: 'http://127.0.0.1:18081/bark/key',
      OWNER_TOKEN: 'REPLACE_WITH_RANDOM_64_HEX_CHARACTERS',
      SOURCE_PATH: path.join(root, 'tests/fake-worker.js')
    },
    encoding: 'utf8', timeout: 3000
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /randomly generated/);
});
