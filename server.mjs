/**
 * MoveCar self-hosted compatibility adapter.
 * Loads the original lesnolie/movecar Worker unchanged in a Node.js VM context.
 * Its Cloudflare KV binding is backed by local SQLite.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const port = Number(process.env.PORT || process.env.HOST_PORT || 8080);
const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const barkUrl = (process.env.BARK_URL || '').replace(/\/+$/, '');
const ownerToken = process.env.OWNER_TOKEN || '';
const phoneNumber = process.env.PHONE_NUMBER || '';
const dbPath = path.resolve(process.env.DB_PATH || './data/state.sqlite');
const sourcePath = path.resolve(process.env.SOURCE_PATH || './upstream/movecar.js');
const rateLimitSeconds = Number(process.env.RATE_LIMIT_SECONDS || 60);

if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid PORT');
if (!/^https?:\/\/[^/]+$/i.test(publicUrl)) throw Error('PUBLIC_URL must be a full origin, e.g. https://car.example.com');
if (!/^https?:\/\//i.test(barkUrl)) throw Error('BARK_URL must be a complete Bark push URL');
if (ownerToken.length < 24 || !/^[A-Za-z0-9_-]+$/.test(ownerToken) || /^(CHANGE_|REPLACE_)/i.test(ownerToken)) throw Error('OWNER_TOKEN must be a randomly generated 24+ character URL-safe token, not a sample value');
if (!fs.existsSync(sourcePath)) throw Error(`Missing original MoveCar source: ${sourcePath}. Run ./scripts/fetch-upstream.sh`);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, expiry INTEGER);
  CREATE INDEX IF NOT EXISTS kv_expiry_idx ON kv(expiry);
  CREATE TABLE IF NOT EXISTS rate_limit (key TEXT PRIMARY KEY, until INTEGER NOT NULL);`);
const kvGet = db.prepare('SELECT value FROM kv WHERE key=? AND (expiry IS NULL OR expiry>?)');
const kvPut = db.prepare('INSERT INTO kv(key,value,expiry) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expiry=excluded.expiry');
const rateCheck = db.prepare('SELECT until FROM rate_limit WHERE key=?');
const ratePut = db.prepare('INSERT INTO rate_limit(key,until) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET until=excluded.until');
const cleanup = db.prepare('DELETE FROM kv WHERE expiry IS NOT NULL AND expiry<=?');
const rateCleanup = db.prepare('DELETE FROM rate_limit WHERE until<=?');
setInterval(() => {
  cleanup.run(Date.now());
  rateCleanup.run(Date.now());
}, 60 * 60 * 1000).unref();

const MOVE_CAR_STATUS = {
  async get(key) {
    return kvGet.get(String(key), Date.now())?.value ?? null;
  },
  async put(key, value, opts = {}) {
    let expiry = null;
    if (opts.expirationTtl != null) {
      const ttl = Number(opts.expirationTtl);
      if (!Number.isFinite(ttl) || ttl <= 0) throw Error('Invalid TTL');
      expiry = Date.now() + ttl * 1000;
    }
    kvPut.run(String(key), String(value), expiry);
  }
};

// Original Worker builds a Bark notification link pointing to /owner-confirm.
// Replace only that notification deep-link with a token-bearing URL.
// The token is then exchanged for a short-lived HttpOnly cookie by this adapter.
async function barkFetch(input, init) {
  const target = new URL(String(input));
  const base = new URL(barkUrl);
  if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname + '/')) {
    throw Error('Unexpected outbound request from upstream Worker');
  }
  const linked = target.searchParams.get('url');
  if (linked) {
    const deepLink = new URL(linked);
    if (deepLink.origin !== publicUrl || deepLink.pathname !== '/owner-confirm') {
      throw Error('Unexpected Bark confirmation URL');
    }
    deepLink.searchParams.set('token', ownerToken);
    target.searchParams.set('url', deepLink.toString());
  } else {
    throw Error('Bark notification has no confirmation URL');
  }
  return fetch(target, { ...init, signal: AbortSignal.timeout(12_000) });
}

let workerListener;
const sandbox = {
  addEventListener(type, callback) {
    if (type !== 'fetch' || typeof callback !== 'function') throw Error('Unsupported Worker event');
    workerListener = callback;
  },
  MOVE_CAR_STATUS, BARK_URL: barkUrl, PHONE_NUMBER: phoneNumber,
  Request, Response, Headers, URL, URLSearchParams,
  fetch: barkFetch, setTimeout, clearTimeout,
  console
};
vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), sandbox, {
  filename: 'upstream/movecar.js', timeout: 2500
});
if (!workerListener) throw Error('Upstream Worker did not register a fetch listener');

function safeMatch(candidate) {
  if (typeof candidate !== 'string') return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(ownerToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function parseCookies(value = '') {
  const cookies = {};
  for (const part of value.split(';')) {
    const n = part.indexOf('=');
    if (n > 0) cookies[part.slice(0, n).trim()] = part.slice(n + 1).trim();
  }
  return cookies;
}
function respond(res, code, text, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', ...headers });
  res.end(text);
}
async function readBody(req) {
  const pieces = [];
  let total = 0;
  for await (const part of req) {
    total += part.length;
    if (total > 16 * 1024) throw Object.assign(Error('Request body too large'), { status: 413 });
    pieces.push(part);
  }
  return Buffer.concat(pieces);
}
async function serveWorker(request) {
  let result;
  workerListener({ request, respondWith(p) { result = Promise.resolve(p); } });
  if (!result) throw Error('Worker produced no response');
  return result;
}

const server = http.createServer(async (req, res) => {
  try {
    // Public origin is pinned, never constructed from untrusted Host or proxy headers.
    const parsed = new URL(req.url || '/', publicUrl);
    const requestUrl = new URL(parsed.pathname + parsed.search, publicUrl);
    const route = parsed.pathname;
    if (route === '/healthz') return respond(res, 200, 'ok');
    const methods = {
      '/api/notify': 'POST', '/api/owner-confirm': 'POST',
      '/api/get-location': 'GET', '/api/check-status': 'GET', '/owner-confirm': 'GET'
    };
    if (methods[route] && req.method !== methods[route]) return respond(res, 405, 'Method not allowed');
    if (!['GET', 'HEAD', 'POST'].includes(req.method)) return respond(res, 405, 'Method not allowed');

    const hasOwnerCookie = safeMatch(parseCookies(req.headers.cookie).movecar_owner);
    if (route === '/owner-confirm' && !hasOwnerCookie) {
      const supplied = parsed.searchParams.get('token');
      if (!safeMatch(supplied)) return respond(res, 403, '车主确认链接无效；请从 Bark 通知中打开。');
      res.writeHead(303, {
        Location: '/owner-confirm',
        'Set-Cookie': `movecar_owner=${ownerToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600${publicUrl.startsWith('https:') ? '; Secure' : ''}`,
        'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store'
      });
      return res.end();
    }
    if ((route === '/api/get-location' || route === '/api/owner-confirm') && !hasOwnerCookie) {
      return respond(res, 403, '车主认证失败');
    }

    if (route === '/api/notify') {
      // Basic abuse prevention. The rate limit is by transport IP; proxied deployments
      // intentionally share the proxy's IP rather than trusting spoofable X-Forwarded-For.
      const key = req.socket.remoteAddress || 'unknown';
      const now = Date.now();
      if (rateLimitSeconds > 0 && (rateCheck.get(key)?.until ?? 0) > now) {
        return respond(res, 429, '通知太频繁，请稍后再试', { 'Retry-After': String(rateLimitSeconds) });
      }
      // Only consume the quota after a syntactically valid JSON request.
      const rawBody = await readBody(req);
      let body;
      try { body = JSON.parse(rawBody.toString('utf8')); } catch { return respond(res, 400, 'Invalid JSON'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return respond(res, 400, 'Invalid payload');
      if (typeof body.message !== 'string' || body.message.length > 200) return respond(res, 400, '留言长度须在 200 字以内');
      if (body.location != null &&
        (typeof body.location !== 'object' || !Number.isFinite(body.location.lat) ||
         !Number.isFinite(body.location.lng) || Math.abs(body.location.lat) > 90 || Math.abs(body.location.lng) > 180)) {
        return respond(res, 400, '位置数据无效');
      }
      if (rateLimitSeconds > 0) ratePut.run(key, now + rateLimitSeconds * 1000);
      const request = new Request(requestUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: body.message, location: body.location || null,
          // Client cannot bypass original 30-second anti-spam delay if no position.
          delayed: !body.location
        })
      });
      const result = await serveWorker(request);
      return sendResponse(result, res);
    }

    const raw = req.method === 'POST' ? await readBody(req) : undefined;
    const request = new Request(requestUrl, {
      method: req.method === 'HEAD' ? 'GET' : req.method,
      ...(raw ? { body: raw, headers: { 'content-type': req.headers['content-type'] || 'application/json' } } : {})
    });
    const result = await serveWorker(request);
    return sendResponse(result, res, req.method === 'HEAD');
  } catch (err) {
    console.error(new Date().toISOString(), err);
    if (!res.headersSent) return respond(res, err.status || 500, err.status ? err.message : 'Internal server error');
    res.end();
  }
});
async function sendResponse(response, res, head = false) {
  const headers = Object.fromEntries(response.headers);
  headers['cache-control'] = 'no-store';
  headers['x-content-type-options'] = 'nosniff';
  headers['referrer-policy'] = 'no-referrer';
  headers['x-frame-options'] = 'DENY';
  const payload = head ? null : Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, headers);
  res.end(payload);
}
server.requestTimeout = 75_000; // Upstream may delay no-location Bark notifications by 30s.
server.listen(port, '0.0.0.0', () => {
  console.log(`MoveCar adapter listening on :${port}; public URL ${publicUrl}`);
});
process.on('SIGTERM', () => server.close(() => { db.close(); process.exit(0); }));
