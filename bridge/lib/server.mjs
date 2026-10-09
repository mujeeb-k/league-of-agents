// The bridge's HTTP server: the app, and the API the app calls, guarded so only this machine's pages get in.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BRIDGE_DIR, WEB_DIR, WEB_FILE } from './paths.mjs';
import { WEB_URL, APP_PATH } from './args.mjs';
import { ROOT, TOKEN } from './repo.mjs';
import { AGENTS } from './agents/registry.mjs';
import { CLAUDE_FIX } from './agents/claude.mjs';
import { linkOf } from './cli.mjs';
import { ROUTES } from './routes.mjs';
import { setShellPort, shellTokenFits } from './shell.mjs';

// An error the app shows carries a `code`, and the values for its sentence in `args`: the app words it in the
// person's language by that code (web/src/api/errors.ts). `error` is the same sentence in English, for older apps.
function send(res, code, body, headers = {}) {
  const isStr = typeof body === 'string';
  res.writeHead(code, {
    'content-type': isStr ? 'text/plain; charset=utf-8' : 'application/json',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(isStr ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((r, j) => {
    const parts = [];
    let size = 0;
    req.on('data', d => {
      size += d.length;
      if (size <= 1e6) return parts.push(d);
      req.destroy();
      j(Object.assign(new Error('Request too large'), { code: 413 }));
    });
    req.on('end', () => {
      // Decoded once, whole: a character split between chunks stays one.
      const b = Buffer.concat(parts).toString('utf8');
      try {
        r(b ? JSON.parse(b) : {});
      } catch (e) {
        j(e);
      }
    });
  });
}
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ---------------------------------------------------------------- who may reach the bridge (docs/THREAT-MODEL.md)
// Only this machine, by the bridge's own address: a different Host is a DNS-rebinding page.
/** @type {Set<string>} */
let OWN_HOSTS = new Set();
const WEB_ORIGIN = WEB_URL && new URL(WEB_URL).origin;
/**
 * Pages that may call the API: the app this bridge serves, and the hosted app it links to (`--web`; a preview
 * deployment is trusted by starting the bridge with `--web <its address>`).
 */
function allowedOrigin(origin) {
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' && OWN_HOSTS.has(u.host)) || u.origin === WEB_ORIGIN;
  } catch {
    return false;
  }
}
/**
 * Wrong tokens are answered ever more slowly, then lock the API until the bridge restarts. The token can't be
 * guessed in any number of tries; 50 leaves room for stale tabs after a restart, which send two each.
 */
const LOCK_AFTER = 50;
let wrongTokens = 0;
const locked = () => wrongTokens >= LOCK_AFTER;
const LOCKED = 'Locked after too many wrong tokens. Restart it: npx leagueofagents-cli@latest start';

/** One request: the app's files, or the API, which only this machine's pages holding the token may call. */
async function handle(req, res) {
  const origin = req.headers.origin;
  if (!OWN_HOSTS.has(req.headers.host)) return send(res, 403, 'Forbidden host');
  if (origin && !allowedOrigin(origin)) return send(res, 403, 'Forbidden origin');
  const cors = origin
    ? {
        'access-control-allow-origin': origin,
        vary: 'origin',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-private-network': 'true',
      }
    : {};
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
    if (url.pathname.startsWith(APP_PATH)) return serveWeb(res, url.pathname.slice(APP_PATH.length - 1));
    if (url.pathname === '/') {
      res.writeHead(302, { location: APP_PATH });
      return res.end();
    }
    return send(res, 404, 'Not found');
  }
  if (!url.pathname.startsWith('/api/')) return send(res, 404, 'Not found', cors);
  // Another site's page reaches the API without an Origin only through images, links and forms: never valid.
  if (!origin && /^(cross|same)-site$/.test(req.headers['sec-fetch-site'] || ''))
    return send(res, 403, 'Forbidden origin');
  if (locked()) return send(res, 423, { error: LOCKED }, cors);
  const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!auth) return send(res, 401, { error: 'Missing token' }, cors);
  if (!safeEq(auth, TOKEN) && !shellTokenFits(url.pathname, auth)) {
    wrongTokens++;
    if (locked()) console.error(`\n  ${LOCKED}\n`);
    const wait = Math.min(100 * 2 ** (wrongTokens - 1), 5000);
    return setTimeout(() => send(res, 401, { error: 'Bad token' }, cors), wait);
  }
  const route = ROUTES.find(
    ([method, at]) => method === req.method && (typeof at === 'string' ? at === url.pathname : at.test(url.pathname)),
  );
  if (!route) return send(res, 404, { error: 'Unknown endpoint' }, cors);
  const [, at, handler] = route;
  try {
    const params = typeof at === 'string' ? [] : at.exec(url.pathname).slice(1);
    const [status, body] = await handler({ url, params, body: () => readBody(req) });
    return send(res, status, body, cors);
  } catch (e) {
    return send(res, e.code === 409 ? 409 : 500, { error: e.message, code: e.reason, args: e.args }, cors);
  }
}
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};
function serveWeb(res, pathname) {
  if (WEB_FILE) {
    if (pathname !== '/' && pathname !== '/index.html') return send(res, 404, 'Not found');
    try {
      return send(res, 200, fs.readFileSync(WEB_FILE, 'utf8'), { 'content-type': MIME['.html'] });
    } catch {
      return send(res, 404, `Web app not found at ${WEB_FILE}`);
    }
  }
  if (!fs.existsSync(path.join(WEB_DIR, 'index.html')))
    return send(
      res,
      404,
      `The web app is not built. Run: npm --prefix "${path.join(BRIDGE_DIR, '..', 'web')}" run build`,
    );
  let rel;
  try {
    // A folder serves its index.html: each language's homepage, /fr/ and so on.
    rel = decodeURIComponent(pathname)
      .replace(/^\/+/, '')
      .replace(/(^|\/)$/, '$1index.html');
  } catch {
    return send(res, 400, 'Bad path');
  }
  const abs = path.resolve(WEB_DIR, rel);
  if (!abs.startsWith(path.resolve(WEB_DIR) + path.sep)) return send(res, 404, 'Not found');
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    return send(res, 404, 'Not found');
  }
  if (!st.isFile()) return send(res, 404, 'Not found');
  res.writeHead(200, {
    'content-type': MIME[path.extname(abs)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  fs.createReadStream(abs).pipe(res);
}
/** The first port from `from` that nothing on this machine is listening on. */
export async function firstFreePort(from) {
  for (let port = from; port < from + 50; port++) {
    const free = await new Promise(resolve => {
      const probe = net.createServer();
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  return from;
}
/** The bridge's HTTP server, answering only to this machine at this port: the app, and the API it calls. */
export function createBridgeServer(port) {
  OWN_HOSTS = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  setShellPort(port);
  const server = http.createServer(handle);
  server.on('error', (/** @type {NodeJS.ErrnoException} */ e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${port} is busy. Use --port <n>.` : e.message);
    process.exit(1);
  });
  return server;
}
/** Says where the bridge is, once it listens. */
export function listening(port) {
  const local = linkOf({ port: port, token: TOKEN });
  console.log(`\n  League of Agents bridge\n  repo    ${ROOT}`);
  console.log(
    `  agents  ${Object.entries(AGENTS)
      .filter(([, a]) => a.available)
      .map(([, a]) => a.name)
      .join(', ')}`,
  );
  if (AGENTS.claude.problem) console.log(`  ${CLAUDE_FIX[AGENTS.claude.problem]}`);
  console.log(`\n  Open    ${local}`);
  if (WEB_URL)
    console.log(
      `  or      ${WEB_URL}${APP_PATH}#bridge=${port}&t=${TOKEN}   (Chrome or Edge, allow local network access)`,
    );
  console.log('');
}
