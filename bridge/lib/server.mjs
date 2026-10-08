// The bridge's HTTP server: the app, and the API the app calls, guarded so only this machine's pages get in.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BRIDGE_DIR, VERSION, WEB_DIR, WEB_FILE } from './paths.mjs';
import { readJson, textLines } from './util.mjs';
import { relocate, scopeEntry } from './scope.mjs';
import { HOOK_AGENT } from './hook.mjs';
import { WEB_URL, APP_PATH } from './args.mjs';
import { ROOT, CONFIG_FILE, CONF, LAYOUT_FILE, TOKEN, git } from './repo.mjs';
import {
  CHECKS_OFF,
  saveAllowed,
  repoChecks,
  checksShared,
  detectChecks,
  setRepoChecks,
  setChecksShared,
} from './checks.mjs';
import { AGENTS } from './agents/registry.mjs';
import { CLAUDE_FIX, checkClaude } from './agents/claude.mjs';
import { onAgentLine } from './agents/stream.mjs';
import { cancelSession, startSession } from './sessions.mjs';
import { removeHooks } from './hooks-install.mjs';
import { linkOf } from './cli.mjs';
import { readTree, hashOf, repoFile } from './files.mjs';
import { showAt } from './snapshots.mjs';
import { recordedAuthors, exportAttribution } from './authorship.mjs';
import { runs, active, saveRun, publicRun, beginRun, finishRun, push, revertRun } from './runs.mjs';
import { armIdle, ownWrite, writeConfig, watchOff } from './watch.mjs';
import { seq, events, waiters, emit } from './events.mjs';

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
    let b = '';
    req.on('data', d => {
      b += d;
      if (b.length > 1e6) req.destroy();
    });
    req.on('end', () => {
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
  if (!safeEq(auth, TOKEN)) {
    wrongTokens++;
    if (locked()) console.error(`\n  ${LOCKED}\n`);
    const wait = Math.min(100 * 2 ** (wrongTokens - 1), 5000);
    return setTimeout(() => send(res, 401, { error: 'Bad token' }, cors), wait);
  }
  try {
    const p = url.pathname;
    if (req.method === 'GET' && p === '/api/state') {
      return send(
        res,
        200,
        {
          repo: { name: path.basename(ROOT), branch: safeBranch(), root: ROOT },
          agents: AGENTS,
          tree: readTree(),
          runs: [...runs.values()].sort((a, b) => a.id - b.id).map(publicRun),
          active: active?.run.id ?? null,
          seq,
          version: VERSION,
          suggestedChecks: CONF.checks?.length ? [] : repoChecks.length ? repoChecks : detectChecks(),
          ...(repoChecks.length ? { suggestedChecksFrom: 'repo' } : {}),
          checksOn: (CONF.checks || []).map(c => c.name),
          watchOff,
        },
        cors,
      );
    }
    if (req.method === 'GET' && p === '/api/events') {
      const since = Number(url.searchParams.get('since') || 0);
      // Deltas go only to apps that ask for them; any other app refetches the state, as before.
      const withDelta = url.searchParams.get('delta') === '1';
      const ready = () =>
        events.filter(e => e.seq > since).map(e => (withDelta || !e.delta ? e : { ...e, delta: undefined }));
      if (!ready().length)
        await new Promise(r => {
          const w = () => r();
          waiters.add(w);
          setTimeout(() => {
            waiters.delete(w);
            r();
          }, 25000);
        });
      return send(res, 200, { seq, events: ready() }, cors);
    }
    if (req.method === 'POST' && p === '/api/runs') {
      const b = await readBody(req);
      if (b.agent === 'claude') await new Promise(r => checkClaude(r));
      if (AGENTS[b.agent]?.problem === 'loggedOut')
        return send(
          res,
          400,
          {
            error: `${AGENTS[b.agent].name} is not logged in. Run: claude auth login`,
            code: 'not-logged-in',
            args: { agent: b.agent },
          },
          cors,
        );
      if (!AGENTS[b.agent]?.available)
        return send(
          res,
          400,
          { error: `${b.agent} is not installed on this machine`, code: 'not-installed', args: { agent: b.agent } },
          cors,
        );
      // Lines selected in the app come with their text and the lines around them. Each range is found by them in the
      // file as it is now, from one read that the scope lock then holds: moved if its lines moved, refused if they
      // changed or can't be told apart from a copy.
      let scope = Array.isArray(b.scope) ? b.scope : [];
      const read = {};
      if (b.lines && typeof b.lines === 'object') {
        const found = [];
        for (const s of scope) {
          const e = scopeEntry(s);
          const want =
            e.from && typeof b.lines[e.path] === 'string' ? b.lines[e.path].replace(/\r/g, '').split('\n') : null;
          if (!want) {
            found.push(s);
            continue;
          }
          const abs = repoFile(e.path);
          const text = abs ? fs.readFileSync(abs, 'utf8') : null;
          const near = b.context?.[e.path];
          const context =
            near && typeof near === 'object'
              ? {
                  before: Array.isArray(near.before) ? near.before.map(String) : [],
                  after: Array.isArray(near.after) ? near.after.map(String) : [],
                  twin: near.twin !== false,
                }
              : null;
          const at = text === null ? null : relocate(textLines(text), want, e.from, context);
          if (at === null)
            return send(
              res,
              409,
              {
                error: `The lines you selected in ${path.basename(e.path)} changed. Select them again.`,
                code: 'lines-changed',
                args: { name: path.basename(e.path) },
                stale: e.path,
              },
              cors,
            );
          read[e.path] = text;
          found.push(`${e.path}:${at}-${at + want.length - 1}`);
        }
        scope = found;
      }
      const parent = b.resumeFrom ? runs.get(b.resumeFrom) : null;
      const run = await beginRun({
        agent: b.agent,
        prompt: b.prompt,
        scope,
        resumeFrom: parent?.id ?? null,
        sessionId: parent?.agent === b.agent ? parent.sessionId : null,
      });
      startSession(run, read);
      return send(res, 200, publicRun(run), cors);
    }
    const m = p.match(/^\/api\/runs\/(\d+)\/(cancel|keep|revert)$/);
    if (req.method === 'POST' && m) {
      const run = runs.get(+m[1]);
      if (!run) return send(res, 404, { error: 'No such run' }, cors);
      const b = await readBody(req);
      if (m[2] === 'cancel') {
        // A captured terminal turn has no agent of ours to stop: it ends here.
        if (active?.run === run && !cancelSession(run)) {
          run.status = 'cancelled';
          await finishRun(run, 'cancelled');
        }
        return send(res, 200, { ok: true }, cors);
      }
      if (m[2] === 'keep') {
        run.kept = true;
        saveRun(run);
        emit('state');
        return send(res, 200, { ok: true }, cors);
      }
      if (m[2] === 'revert') {
        const r = await revertRun(run, !!b.force);
        return send(res, r.conflict ? 409 : 200, r, cors);
      }
    }
    // The map's layout, kept per repo so a reload, another window size or the other app opens it as it was.
    // Writes attribution to a git note on HEAD, only when the person asks (exportAttribution).
    if (req.method === 'POST' && p === '/api/attribution/export') {
      const b = await readBody(req);
      const r = await exportAttribution(b.format === 'git-ai' ? 'git-ai' : 'agent-trace', b.files);
      return send(res, r.error ? 409 : 200, r, cors);
    }
    // Authorship git records for a file at HEAD: Git AI notes and co-author trailers (recordedAuthors).
    if (req.method === 'GET' && p === '/api/authors') {
      const rel = url.searchParams.get('path');
      if (!repoFile(rel)) return send(res, 404, { error: 'Not a file on the map' }, cors);
      return send(res, 200, { lines: (await recordedAuthors(rel)) ?? [] }, cors);
    }
    if (req.method === 'GET' && p === '/api/layout')
      return send(res, 200, { layout: readJson(LAYOUT_FILE, null) }, cors);
    if (req.method === 'POST' && p === '/api/layout') {
      const { layout } = await readBody(req);
      const ok =
        layout?.v === 1 && [layout.dirs, layout.files].every(o => o && typeof o === 'object' && !Array.isArray(o));
      if (!ok) return send(res, 400, { error: 'Not a layout' }, cors);
      fs.writeFileSync(LAYOUT_FILE, JSON.stringify(layout));
      return send(res, 200, { ok: true }, cors);
    }
    if (req.method === 'GET' && p === '/api/file') {
      const abs = repoFile(url.searchParams.get('path'));
      if (!abs) return send(res, 404, { error: 'Not a file on the map' }, cors);
      const text = fs.readFileSync(abs, 'utf8');
      return send(res, 200, { path: url.searchParams.get('path'), text, hash: hashOf(text) }, cors);
    }
    // A file a run changed, whole, as the run found it: the state keeps only its first 4,000 lines (computeChanges).
    const before = p.match(/^\/api\/runs\/(\d+)\/before$/);
    if (req.method === 'GET' && before) {
      const run = runs.get(+before[1]),
        rel = url.searchParams.get('path');
      if (!run?.before || !run.changes?.some(c => c.path === rel))
        return send(res, 404, { error: 'That file is not in this run' }, cors);
      return send(res, 200, { text: (await showAt(run.before, rel)) ?? '' }, cors);
    }
    // A save from the editor is a run by "You": the same snapshots, history and revert as an agent's.
    // Turns on checks the bridge found, or approves the ones the repo's loa.config.json asks for (all of them).
    // The page names them; the commands are the bridge's own or the repo's, so a page can never put a command of
    // its choosing into loa.config.json.
    if (req.method === 'POST' && p === '/api/checks') {
      const b = await readBody(req);
      const names = new Set(Array.isArray(b.names) ? b.names : []);
      if (repoChecks.length) {
        if (!repoChecks.every(c => names.has(c.name)))
          return send(res, 400, { error: 'No such checks to turn on' }, cors);
        saveAllowed({ approved: repoChecks });
        CONF.checks = repoChecks;
        setRepoChecks([]);
        setChecksShared(true);
        emit('state');
        return send(res, 200, { checks: CONF.checks }, cors);
      }
      const chosen = detectChecks().filter(c => names.has(c.name));
      if (!chosen.length || CONF.checks?.length) return send(res, 400, { error: 'No such checks to turn on' }, cors);
      if (b.share) {
        if (active) return send(res, 409, { error: 'Wait for the run to finish', code: 'wait-for-run' }, cors);
        await writeConfig({ ...readJson(CONFIG_FILE, {}), checks: chosen });
        saveAllowed({ approved: chosen });
        setChecksShared(true);
      } else saveAllowed({ private: chosen });
      CONF.checks = chosen;
      emit('state');
      return send(res, 200, { checks: chosen }, cors);
    }
    // Turns one check off: out of loa.config.json, the file's other settings kept, and if the bridge found
    // it, never offered again.
    if (req.method === 'POST' && p === '/api/checks/off') {
      const b = await readBody(req);
      const gone = (CONF.checks || []).find(c => c.name === b.name);
      if (!gone) return send(res, 404, { error: 'No such check' }, cors);
      if (checksShared && active)
        return send(res, 409, { error: 'Wait for the run to finish', code: 'wait-for-run' }, cors);
      CONF.checks = CONF.checks.filter(c => c !== gone);
      if (checksShared) {
        const file = readJson(CONFIG_FILE, {});
        file.checks = (file.checks || []).filter(c => c.name !== gone.name);
        if (!file.checks.length) delete file.checks;
        await writeConfig(file);
        saveAllowed({ approved: file.checks || [] });
        setChecksShared(!!CONF.checks.length);
      } else saveAllowed({ private: CONF.checks });
      fs.writeFileSync(CHECKS_OFF, JSON.stringify([...readJson(CHECKS_OFF, []), `${gone.name}\0${gone.run}`]));
      emit('state');
      return send(res, 200, { ok: true }, cors);
    }
    if (req.method === 'POST' && p === '/api/hooks/remove') {
      if (active)
        return send(
          res,
          409,
          { error: 'A run is in progress. Remove the hooks once it finishes.', code: 'hooks-run-active' },
          cors,
        );
      return send(res, 200, { removed: await ownWrite(removeHooks) }, cors);
    }
    if (req.method === 'POST' && p === '/api/save') {
      const b = await readBody(req);
      const abs = repoFile(b.path);
      if (!abs || typeof b.text !== 'string') return send(res, 404, { error: 'Not a file on the map' }, cors);
      const now = fs.readFileSync(abs, 'utf8');
      // Changed on disk since it was opened: never overwrite silently.
      if (hashOf(now) !== b.base) return send(res, 409, { error: 'changed', text: now, hash: hashOf(now) }, cors);
      if (now === b.text) return send(res, 200, { unchanged: true }, cors);
      const run = await beginRun({ agent: 'you' });
      fs.writeFileSync(abs, b.text);
      await finishRun(run);
      return send(res, 200, publicRun(run), cors);
    }
    if (req.method === 'POST' && p === '/api/capture/start') {
      const b = await readBody(req);
      const hookRun = r => Object.values(HOOK_AGENT).includes(r.agent);
      if (active && !hookRun(active.run)) return send(res, 200, { ignored: true }, cors);
      // The same prompt from a second set of hooks (a plugin's and the repo's): one run, not two.
      if (active && active.run.sessionId === (b.sessionId || null) && active.run.prompt === (b.prompt || ''))
        return send(res, 200, { ignored: true }, cors);
      // A terminal turn that never sent Stop was interrupted; the next prompt closes it.
      if (active) await finishRun(active.run, 'interrupted');
      const run = await beginRun({
        agent: Object.values(HOOK_AGENT).includes(b.agent) ? b.agent : 'claude-terminal',
        prompt: b.prompt,
        sessionId: b.sessionId || null,
      });
      push(run, {
        t: 'text',
        text: run.agent === 'cursor-editor' ? 'Captured from Cursor.' : 'Captured from a terminal session.',
      });
      armIdle();
      return send(res, 200, { id: run.id }, cors);
    }
    if (req.method === 'POST' && p === '/api/capture/stop') {
      const b = await readBody(req);
      // A stop from another conversation (a second Cursor window, another terminal) leaves this run running.
      const other = b.sessionId && active?.run.sessionId && b.sessionId !== active.run.sessionId;
      if (active && Object.values(HOOK_AGENT).includes(active.run.agent) && !other) {
        for (const e of Array.isArray(b.events) ? b.events : []) onAgentLine(active.run, JSON.stringify(e));
        if (b.summary) active.run.summary = b.summary;
        // Cursor says how the turn ended.
        await finishRun(active.run, b.status === 'aborted' ? 'cancelled' : b.status === 'error' ? 'failed' : 'done');
      }
      return send(res, 200, { ok: true }, cors);
    }
    return send(res, 404, { error: 'Unknown endpoint' }, cors);
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
function safeBranch() {
  try {
    return git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  } catch {
    return '';
  }
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
