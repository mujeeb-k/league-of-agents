#!/usr/bin/env node
// League of Agents bridge. Zero dependencies. Node 20+.
// Run inside a git repo:  node /path/to/bridge/loa.mjs
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';

const SELF = fileURLToPath(import.meta.url);
// Web app: the built web/dist folder. LOA_WEB_FILE still serves a single HTML file instead.
/** This bridge's version, reported to the app, which asks for an update when it is too old. */
const VERSION = readJson(path.join(path.dirname(SELF), '..', 'package.json'), {}).version ?? null;
const WEB_DIR = process.env.LOA_WEB_DIR || path.join(path.dirname(SELF), '..', 'web', 'dist');
const WEB_FILE = process.env.LOA_WEB_FILE || '';
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};

/** Runs started by an agent's own hooks, by agent: Claude Code and Codex in a terminal, Cursor in its editor. */
const HOOK_AGENT = { claude: 'claude-terminal', codex: 'codex-terminal', cursor: 'cursor-editor' };

// ---------------------------------------------------------------- hooks (run by the agents, not by the server)
if (argv[0] === 'hook') await runHook(argv[1], argv[2]);

// ---------------------------------------------------------------- setup
let ROOT;
try {
  ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
} catch {
  console.error('Run this inside a git repository.');
  process.exit(1);
}
const LOA = path.join(ROOT, '.loa');
// .loa/ is this machine's own state. A repo that commits it could hand the bridge runs, settings or approvals of
// its choosing, so the bridge doesn't start on one.
if (execFileSync('git', ['ls-files', '--', '.loa'], { cwd: ROOT, encoding: 'utf8' }).trim()) {
  console.error(
    'This repo commits .loa/, which League of Agents keeps private to each machine. Take it out of git first:\n' +
      '  git rm -r --cached .loa && git commit -m "Stop tracking .loa"',
  );
  process.exit(1);
}
const RUNS_DIR = path.join(LOA, 'runs');
fs.mkdirSync(RUNS_DIR, { recursive: true });
// .loa/ holds the token (bridge.json, and the links in bridge.log): only this user may open it.
fs.chmodSync(LOA, 0o700);
/** The first port from `from` that nothing on this machine is listening on. */
async function firstFreePort(from) {
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
// A port asked for is used as it is (and a busy one says so); otherwise the first free one from 43210, so a
// second repo's bridge doesn't fail because the first holds the usual port.
const ASKED_PORT = flag('port', process.env.LOA_PORT);
const PORT = ASKED_PORT ? Number(ASKED_PORT) : argv[0] === 'serve' ? await firstFreePort(43210) : 43210;
const SITE = 'https://leagueofagents.dev';
// --local: the local app only, in every browser. The website is never opened or printed, and can't connect.
const WEB_URL = argv.includes('--local') ? '' : flag('web', process.env.LOA_WEB_URL || SITE).replace(/\/$/, '');
// Where the app lives, on the bridge and on the hosted site: "/" today, "/app/" once the site has a homepage.
// The bridge serves it there, and every link it prints or opens points there.
const APP_PATH = `/${flag('app-path', process.env.LOA_APP_PATH || '/')}/`.replace(/\/+/g, '/');
const CONFIG_FILE = path.join(ROOT, 'loa.config.json');
const CONF = readJson(CONFIG_FILE, {});
/** Found checks the person turned off: never offered again (`name\0command`). */
const CHECKS_OFF = path.join(ROOT, '.loa', 'checks-off.json');
/**
 * The checks this person allowed for this repo, kept outside it, in their home folder, so nothing in a repo can
 * allow its own commands. `private`: found checks they turned on (loa.config.json is written only when they share
 * them with their team). `approved`: the committed loa.config.json list they approved. A cloned repo's
 * loa.config.json is the repo's, not the person's: its checks run only once that exact list is approved, and
 * wait again whenever any of it changes.
 */
const CHECKS_FILE = path.join(
  os.homedir(),
  '.config',
  'league-of-agents',
  'repos',
  crypto.createHash('sha256').update(ROOT).digest('hex').slice(0, 32) + '.json',
);
const allowed = { private: [], approved: [], ...readJson(CHECKS_FILE, {}) };
function saveAllowed(change) {
  Object.assign(allowed, change);
  fs.mkdirSync(path.dirname(CHECKS_FILE), { recursive: true });
  fs.writeFileSync(CHECKS_FILE, JSON.stringify({ ...allowed, root: ROOT }, null, 2));
}
const sameChecks = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Committed checks waiting for the person's approval: offered, never run. */
let repoChecks = [];
let checksShared = !!CONF.checks?.length;
if (checksShared && !sameChecks(CONF.checks, allowed.approved)) {
  repoChecks = CONF.checks;
  CONF.checks = [];
  checksShared = false;
}
if (!checksShared && !repoChecks.length) CONF.checks = allowed.private;
/**
 * Checks the repo seems to have, for a repo with none set up: each package's test and typecheck scripts (with
 * the package manager its lockfile names) and pytest, in the repo and in the folders directly inside it. They
 * are only offered; nothing runs until the person turns them on.
 */
function detectChecks() {
  const has = (...p) => fs.existsSync(path.join(ROOT, ...p));
  const skip = /^(\.|node_modules$|dist$|build$|vendor$|target$|venv$)/;
  let dirs = [''];
  try {
    dirs = dirs.concat(
      fs
        .readdirSync(ROOT, { withFileTypes: true })
        .filter(d => d.isDirectory() && !skip.test(d.name))
        .map(d => d.name),
    );
  } catch {}
  const out = [];
  for (const d of dirs) {
    const quoted = /^[\w.-]+$/.test(d) ? d : `'${d.replace(/'/g, "'\\''")}'`;
    const cd = d ? `cd ${quoted} && ` : '',
      label = d ? `${d} ` : '';
    const scripts = readJson(path.join(ROOT, d, 'package.json'), null)?.scripts;
    if (scripts) {
      const lock = f => has(d, f) || has(f);
      const pm = lock('pnpm-lock.yaml')
        ? 'pnpm'
        : lock('yarn.lock')
          ? 'yarn'
          : lock('bun.lockb') || lock('bun.lock')
            ? 'bun'
            : 'npm';
      if (scripts.test && !/no test specified/.test(scripts.test))
        out.push({ name: `${label}tests`, run: `${cd}${pm} test` });
      const tc = ['typecheck', 'type-check', 'check-types', 'tsc'].find(s => scripts[s]);
      if (tc) out.push({ name: `${label}typecheck`, run: `${cd}${pm} run ${tc}` });
    }
    let pyproject = '';
    try {
      pyproject = fs.readFileSync(path.join(ROOT, d, 'pyproject.toml'), 'utf8');
    } catch {}
    let testsDir = [];
    try {
      testsDir = fs.readdirSync(path.join(ROOT, d, 'tests'));
    } catch {}
    if (
      ['pytest.ini', 'conftest.py', 'tox.ini'].some(f => has(d, f)) ||
      /\[tool\.pytest/.test(pyproject) ||
      testsDir.some(f => /^test_.*\.py$/.test(f))
    )
      out.push({ name: `${label}pytest`, run: `${cd}python3 -m pytest -q` });
  }
  const off = new Set(readJson(CHECKS_OFF, []));
  return out.filter(c => !off.has(`${c.name}\0${c.run}`)).slice(0, 6);
}
const IGNORE = (CONF.ignore || []).map(g => g.replace(/\*\*?.*$/, ''));
const bridgeFile = path.join(LOA, 'bridge.json');
/** Where the map's folders and files are placed (web/src/lib/layout.ts SavedLayout). */
const LAYOUT_FILE = path.join(LOA, 'layout.json');
const prev = readJson(bridgeFile, {});
// A fresh token on every start: a link from an earlier run stops working.
const TOKEN = crypto.randomBytes(18).toString('base64url');
const excludeFile = () => path.resolve(ROOT, git(['rev-parse', '--git-dir']).trim(), 'info', 'exclude');
/** The lines we added to .git/info/exclude, so `uninstall` takes out only those. */
const EXCLUDED = path.join(LOA, 'excluded.json');
excludeFromGit(['.loa/', '.claude/settings.local.json']);

const BIN = {
  claude: process.env.LOA_CLAUDE_BIN || 'claude',
  cursor: process.env.LOA_CURSOR_BIN || 'cursor-agent',
  codex: process.env.LOA_CODEX_BIN || 'codex',
};
const AGENTS = {
  // `problem` says why Claude Code can't run: 'missing' (not installed) or 'loggedOut' (checkClaude).
  claude: { name: 'Claude Code', available: onPath(BIN.claude), problem: onPath(BIN.claude) ? null : 'missing' },
  cursor: { name: 'Cursor', available: onPath(BIN.cursor) },
  codex: { name: 'Codex', available: onPath(BIN.codex) },
  detected: { name: 'Watch mode', available: false },
  you: { name: 'You', available: false },
  'claude-terminal': { name: 'Claude Code (terminal)', available: false },
  'codex-terminal': { name: 'Codex (terminal)', available: false },
  'cursor-editor': { name: 'Cursor (editor)', available: false },
};
/**
 * Harnesses that speak the Agent Client Protocol (agentclientprotocol.com), run by startAcp: Hermes Agent and
 * DeepSeek Harness when found, and any the person adds in their own ~/.config/league-of-agents/agents.json, as
 * [{ "id": "goose", "name": "Goose", "command": ["goose", "acp"] }]. Never from the repo, so a cloned repo can't
 * name a command to run. Keys, providers and models stay in each harness's own settings.
 */
const AGENTS_FILE = path.join(os.homedir(), '.config', 'league-of-agents', 'agents.json');
const ACP = {
  // Hermes speaks ACP only with its optional extra installed: it counts as found once `hermes acp --check` passes.
  hermes: {
    name: 'Hermes',
    command: [process.env.LOA_HERMES_BIN || 'hermes', 'acp'],
    check: [process.env.LOA_HERMES_BIN || 'hermes', 'acp', '--check'],
  },
  // In its read-only mode DeepSeek Harness asks before every write (its sandbox denies the write, and it asks to
  // escalate), so its edits outside the scope can be refused. Without it, it writes without asking.
  dsh: {
    name: 'DeepSeek Harness',
    command: [process.env.LOA_DSH_BIN || 'dsh', '--profile', 'acp'],
    env: { DSH_PERMISSION_MODE: 'read-only' },
  },
};
for (const a of [readJson(AGENTS_FILE, [])].flat())
  if (
    /^[a-z0-9-]+$/.test(a?.id) &&
    !AGENTS[a.id] &&
    Array.isArray(a.command) &&
    a.command.length &&
    a.command.every(s => typeof s === 'string' && s)
  )
    ACP[a.id] = { name: typeof a.name === 'string' && a.name ? a.name : a.id, command: a.command };
for (const [id, a] of Object.entries(ACP)) AGENTS[id] = { name: a.name, available: !a.check && onPath(a.command[0]) };

// ---------------------------------------------------------------- utils
function readJson(p, d) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return d;
  }
}
function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
}
/**
 * git without blocking the bridge: snapshots, diffs and reverts run while requests are still answered.
 * @param {string[]} args
 * @param {{ input?: string } & import('node:child_process').ExecFileOptions} [opts]
 * @returns {Promise<string>}
 */
function gitAsync(args, { input, ...opts } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts },
      (e, out) => (e ? reject(e) : resolve(String(out))),
    );
    if (input !== undefined) child.stdin.end(input);
  });
}
const logError = e => console.error(e.message);
/** Runs baseline and snapshot work one at a time, in order: they share the snapshot index and the baseline. */
/** @type {Promise<unknown>} */
let lane = Promise.resolve();
/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function serial(fn) {
  const done = lane.then(fn);
  lane = done.catch(() => {});
  return done;
}
function onPath(bin) {
  if (path.isAbsolute(bin)) return fs.existsSync(bin);
  return (process.env.PATH || '')
    .split(path.delimiter)
    .some(d => ['', '.cmd', '.exe'].some(e => fs.existsSync(path.join(d, bin + e))));
}
/**
 * Whether Claude Code is installed and logged in, asked of `claude auth status` without blocking. Only an
 * explicit "loggedIn": false counts as logged out: an older Claude Code without the command, or an answer that
 * isn't JSON, leaves it runnable. Asked before each Claude Code run, and every 15 s while there is a problem,
 * so installing or logging in clears it without a restart.
 */
const CLAUDE_RECHECK_MS = Number(process.env.LOA_CLAUDE_RECHECK_MS) || 15000;
let claudeAsked = 0;
const loggedOut = out => {
  try {
    return JSON.parse(out).loggedIn === false;
  } catch {
    return false;
  }
};
/** What to tell the person when Claude Code can't run, with the command that fixes it. */
const CLAUDE_FIX = {
  missing: "Claude Code isn't installed. To run it from the map: curl -fsSL https://claude.ai/install.sh | bash",
  loggedOut: "Claude Code isn't logged in. To run it from the map: claude auth login",
};
/** The same check, waited for: `start` says it before it hands over the link. */
function claudeProblemNow() {
  if (!onPath(BIN.claude)) return 'missing';
  let out = '';
  try {
    out = execFileSync(BIN.claude, ['auth', 'status', '--json'], {
      cwd: ROOT,
      timeout: 10000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    out = String(e.stdout || '');
  }
  return loggedOut(out) ? 'loggedOut' : null;
}
function checkClaude(then) {
  const done = () => then?.();
  if (Date.now() - claudeAsked < CLAUDE_RECHECK_MS) return done();
  claudeAsked = Date.now();
  const setProblem = problem => {
    const was = AGENTS.claude.problem;
    AGENTS.claude.problem = problem;
    AGENTS.claude.available = !problem;
    if (was !== problem) emit('state');
  };
  if (!onPath(BIN.claude)) {
    setProblem('missing');
    return done();
  }
  execFile(BIN.claude, ['auth', 'status', '--json'], { cwd: ROOT, timeout: 10000 }, (_, out) => {
    setProblem(loggedOut(out) ? 'loggedOut' : null);
    done();
  });
}
function excludeFromGit(lines) {
  const ex = excludeFile();
  fs.mkdirSync(path.dirname(ex), { recursive: true });
  const cur = fs.existsSync(ex) ? fs.readFileSync(ex, 'utf8') : '';
  const add = lines.filter(l => !cur.split('\n').includes(l));
  if (!add.length) return;
  fs.appendFileSync(ex, (cur.endsWith('\n') || !cur ? '' : '\n') + add.join('\n') + '\n');
  fs.writeFileSync(EXCLUDED, JSON.stringify([...readJson(EXCLUDED, []), ...add]));
}
// ---------------------------------------------------------------- hooks: installed only with consent
// Each agent's own hook file gets entries that run a copy of this bridge (.loa/bridge.mjs). Hooks that aren't
// ours are never changed; removing ours puts each file back exactly as it was, or deletes a file we created.
// Cursor reads project hooks only from the folder opened as its workspace, which is often a parent of the
// repo, so its hooks go in the user's own Cursor settings; the hook then finds the repo itself (runHook).
const HOOK_FILES = {
  claude: path.join(ROOT, '.claude/settings.local.json'),
  codex: path.join(ROOT, '.codex/hooks.json'),
  cursor: path.join(os.homedir(), '.cursor/hooks.json'),
};
/** A hook file as people know it: relative inside the repo, from ~ outside it. */
const shown = p => (p.startsWith(ROOT + path.sep) ? path.relative(ROOT, p) : p.replace(os.homedir(), '~'));
const isOurs = command => /(loa\.mjs|\.loa[\\/]bridge\.mjs)" hook /.test(String(command));
const BACKUP = path.join(LOA, 'hooks-backup.json');
/** The original of each hook file, by absolute path (older backups keyed them relative to the repo). */
const readBackup = () =>
  Object.fromEntries(Object.entries(readJson(BACKUP, {})).map(([p, v]) => [path.resolve(ROOT, p), v]));
/** The copy of this file the hooks run. */
const hookFile = path.join(LOA, 'bridge.mjs');

/** The hook entries for one agent's file, in that file's own shape. */
function ourEntries(agent, cmd) {
  const command = (type, matcher) => ({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: type }] });
  if (agent === 'claude')
    return {
      PreToolUse: [command(cmd('pre'), 'Edit|Write|MultiEdit|NotebookEdit')],
      UserPromptSubmit: [command(cmd('start'))],
      Stop: [command(cmd('stop'))],
      // Stop does not run when the user interrupts a turn; the session ending closes the run instead.
      SessionEnd: [command(cmd('stop'))],
    };
  if (agent === 'codex') return { UserPromptSubmit: [command(cmd('start codex'))], Stop: [command(cmd('stop codex'))] };
  return { beforeSubmitPrompt: [{ command: cmd('start cursor') }], stop: [{ command: cmd('stop cursor') }] };
}

/** A hook file with our entries taken out, and events or files left empty by that removed too. */
function withoutOurs(json) {
  const out = { ...json };
  const hooks = {};
  for (const [event, list] of Object.entries(out.hooks && typeof out.hooks === 'object' ? out.hooks : {})) {
    const kept = (Array.isArray(list) ? list : []).filter(
      e => !isOurs(e?.command) && !(e?.hooks || []).some(h => isOurs(h?.command)),
    );
    if (kept.length) hooks[event] = kept;
  }
  out.hooks = hooks;
  return out;
}
/** Whether a hook file holds anything besides our entries and the keys we add. */
const hasOwnContent = json =>
  Object.keys(json).some(k => k !== 'hooks' && k !== 'version') || Object.keys(json.hooks || {}).length > 0;

function installHooks() {
  const cmd = sub => `"${process.execPath}" "${hookFile}" hook ${sub}`;
  const backup = readBackup();
  for (const [agent, p] of Object.entries(HOOK_FILES)) {
    const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    let json;
    try {
      json = text === null ? {} : JSON.parse(text);
    } catch {
      console.error(`  Left ${shown(p)} as it is: it isn't plain JSON.`);
      continue;
    }
    // A hook file in git is the team's: ours hold this computer's paths, and would show as a change to commit.
    if (p.startsWith(ROOT + path.sep) && git(['ls-files', '--', path.relative(ROOT, p)]).trim()) {
      console.error(`  Left ${shown(p)} as it is: it's in git, and the hooks hold this computer's paths.`);
      continue;
    }
    if (!(p in backup)) backup[p] = { text, dir: fs.existsSync(path.dirname(p)) };
    const next = withoutOurs(json);
    if (agent === 'cursor') next.version ??= 1;
    for (const [event, entries] of Object.entries(ourEntries(agent, cmd)))
      next.hooks[event] = [...(next.hooks[event] || []), ...entries];
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(next, null, 2) + '\n');
    // A file we created in the repo holds this machine's paths: keep it out of git.
    if (text === null && p.startsWith(ROOT + path.sep)) excludeFromGit([path.relative(ROOT, p)]);
  }
  fs.writeFileSync(BACKUP, JSON.stringify(backup));
}

/** Takes our hooks out. A file untouched since is restored byte for byte; returns the files changed. */
function removeHooks() {
  const backup = readBackup();
  const changed = [];
  for (const p of Object.values(HOOK_FILES)) {
    if (!fs.existsSync(p)) continue;
    let json;
    try {
      json = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      continue;
    }
    const stripped = withoutOurs(json);
    if (JSON.stringify(stripped) === JSON.stringify(json) && !(p in backup)) continue;
    // Cursor's hooks are shared by every repo; the latest to install them owns them, and only it removes them.
    if (!p.startsWith(ROOT + path.sep) && !JSON.stringify(json).includes(JSON.stringify(hookFile).slice(1, -1)))
      continue;
    const before = backup[p];
    let original = null,
      clean = false;
    try {
      const parsed = before?.text == null ? null : JSON.parse(before.text);
      original = parsed && withoutOurs(parsed);
      // A file that already held another repo's hooks is not put back as it was.
      clean = !/(loa\.mjs|\.loa[\\/]+bridge\.mjs)\\" hook /.test(before.text);
    } catch {}
    if (before && before.text === null && !hasOwnContent(stripped)) {
      fs.rmSync(p);
      if (!before.dir && !fs.readdirSync(path.dirname(p)).length) fs.rmdirSync(path.dirname(p));
    } else if (before?.text != null && clean && JSON.stringify(original) === JSON.stringify(stripped))
      fs.writeFileSync(p, before.text);
    else fs.writeFileSync(p, JSON.stringify(stripped, null, 2) + '\n');
    changed.push(shown(p));
  }
  fs.rmSync(BACKUP, { force: true });
  return changed;
}

// ---------------------------------------------------------------- start, stop, status
// The bridge runs in the background, in its own process group, so it outlives the terminal or the agent
// session that started it. .loa/bridge.json holds its port, token and process id.
const linkOf = b => `http://127.0.0.1:${b.port}${APP_PATH}#t=${b.token}`;
const siteLinkOf = b => `${WEB_URL}${APP_PATH}#bridge=${b.port}&t=${b.token}`;
/**
 * The Mac's default browser, as its bundle identifier in lower case, or null when it can't be told. LOA_BROWSER
 * names one instead (tests use it).
 */
function defaultBrowser() {
  if (process.env.LOA_BROWSER) return process.env.LOA_BROWSER.toLowerCase();
  if (process.platform !== 'darwin') return null;
  const plist = path.join(
    os.homedir(),
    'Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist',
  );
  try {
    const xml = execFileSync('plutil', ['-convert', 'xml1', '-o', '-', plist], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // Each handler is a dict, with a dict of preferred versions inside it; those go first.
    const https = xml
      .replace(/<key>LSHandlerPreferredVersions<\/key>\s*<dict>[\s\S]*?<\/dict>/g, '')
      .split('<dict>')
      .find(d => /<key>LSHandlerURLScheme<\/key>\s*<string>https<\/string>/.test(d));
    return https?.match(/<key>LSHandlerRoleAll<\/key>\s*<string>([^<]+)<\/string>/)?.[1].toLowerCase() ?? null;
  } catch {
    return null;
  }
}
/** Chrome, Edge, Brave and Arc, in their release and preview builds: they open the site, connected. */
const CHROMIUM =
  /^(com\.google\.chrome(\.beta|\.dev|\.canary)?|com\.microsoft\.edgemac(\.beta|\.dev|\.canary)?|com\.brave\.browser(\.beta|\.nightly)?|company\.thebrowser\.browser)$/;
/**
 * The link to open: leagueofagents.dev, connected, in a Chrome-family default browser, which asks once to let the
 * site reach this computer; the local app otherwise, which every browser can reach with no prompt.
 */
const openLinkOf = b => (WEB_URL && CHROMIUM.test(defaultBrowser() ?? '') ? siteLinkOf(b) : linkOf(b));
/**
 * The bridge this repo's .loa/bridge.json describes, if it answers with that token; `locked` if it is locked.
 * Bridges before 0.1.0 wrote no process id; they still count, though `stop` can't stop them.
 */
async function running() {
  const b = readJson(bridgeFile, null);
  if (!b?.token || !b.port) return null;
  try {
    const r = await fetch(`http://127.0.0.1:${b.port}/api/state`, {
      headers: { authorization: 'Bearer ' + b.token },
      signal: AbortSignal.timeout(2000),
    });
    return r.ok ? b : r.status === 423 ? { ...b, locked: true } : null;
  } catch {
    return null;
  }
}
/** Opens a link in the default browser. */
function openInBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}
async function startInBackground(hooks) {
  const open = b => {
    const problem = claudeProblemNow();
    const link = openLinkOf(b);
    console.log(`\n  League of Agents is running for ${path.basename(ROOT)}.\n  Open    ${link}`);
    // The local app as well: it works in every browser, and when the site can't reach this computer.
    if (link !== linkOf(b)) console.log(`  or      ${linkOf(b)}   (the local app, any browser)`);
    console.log('');
    if (problem) console.log(`  ${CLAUDE_FIX[problem]}\n`);
    if (!argv.includes('--no-open')) openInBrowser(link);
    process.exit(0);
  };
  const already = await running();
  // A locked bridge is replaced by a fresh one, with a new token; so is one that lets a different website in
  // (`--local`, `--web`). Bridges before 0.2.0 don't record theirs: they let the site in.
  if (already?.locked || (already && (already.web ?? SITE) !== WEB_URL)) await stopBridge(false);
  else if (already) open(already);
  const log = fs.openSync(path.join(LOA, 'bridge.log'), 'w');
  const pass = argv.filter(a => !['start', '--hooks', '--no-hooks', '--no-open'].includes(a));
  const child = spawn(process.execPath, [SELF, 'serve', ...pass, hooks ? '--hooks' : '--no-hooks'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, LOA_MANAGED: '' },
  });
  child.unref();
  for (const t0 = Date.now(); Date.now() - t0 < 15000; await new Promise(r => setTimeout(r, 100))) {
    const b = await running();
    if (b?.pid === child.pid) open(b);
    if (child.exitCode !== null) break;
  }
  console.error(fs.readFileSync(path.join(LOA, 'bridge.log'), 'utf8').trim() || "The bridge didn't start.");
  process.exit(1);
}
async function stopBridge(exit = true) {
  const b = await running();
  if (!b) {
    console.log('League of Agents is not running for this repo.');
    process.exit(0);
  }
  if (!b.pid) {
    console.error(`An older League of Agents bridge is running on port ${b.port}. Stop it where it was started.`);
    process.exit(1);
  }
  process.kill(b.pid, 'SIGTERM');
  for (const t0 = Date.now(); Date.now() - t0 < 5000 && (await running());) await new Promise(r => setTimeout(r, 100));
  if (!exit) return;
  console.log('Stopped League of Agents.');
  process.exit(0);
}
async function bridgeStatus() {
  const b = await running();
  console.log(
    b?.locked
      ? `League of Agents is locked for ${path.basename(ROOT)}: too many wrong tokens. Restart it: npx leagueofagents-cli@latest start`
      : b
        ? `League of Agents is running for ${path.basename(ROOT)}: ${linkOf(b)}`
        : 'League of Agents is not running for this repo.',
  );
  process.exit(0);
}

async function askForHooks() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `\n  Add hooks so prompts you send in Claude Code, Codex and Cursor become runs here, titled by the prompt?\n` +
      `  They go in ${Object.values(HOOK_FILES).map(shown).join(', ')}. Your own hooks are kept.\n` +
      `  Remove them any time: npx leagueofagents-cli@latest hooks remove\n  Add hooks? [Y/n] `,
  );
  rl.close();
  return !/^\s*n/i.test(answer);
}

/**
 * Leaves the repo as if the bridge had never run: stops it, then removes our hooks, the snapshot refs, the
 * lines we added to .git/info/exclude, and .loa/. Says what it removed.
 */
async function uninstall() {
  if (await running()) await stopBridge(false);
  const removed = removeHooks().map(f => `hooks in ${f}`);
  const refs = git(['for-each-ref', '--format=%(refname)', 'refs/loa/']).split('\n').filter(Boolean);
  for (const ref of refs) git(['update-ref', '-d', ref]);
  if (refs.length) removed.push(`${refs.length} snapshot ${refs.length === 1 ? 'ref' : 'refs'} (refs/loa/)`);
  // Bridges before 0.1.0 didn't record their lines; of those, only .loa/ is surely ours.
  const ours = fs.existsSync(EXCLUDED) ? readJson(EXCLUDED, []) : ['.loa/'];
  const ex = excludeFile();
  if (fs.existsSync(ex)) {
    const lines = fs.readFileSync(ex, 'utf8').split('\n');
    for (const l of ours) {
      const i = lines.lastIndexOf(l);
      if (i >= 0) lines.splice(i, 1);
    }
    fs.writeFileSync(ex, lines.join('\n'));
    removed.push('its lines in .git/info/exclude');
  }
  fs.rmSync(LOA, { recursive: true, force: true });
  removed.push('.loa/');
  if (fs.existsSync(CHECKS_FILE)) {
    fs.rmSync(CHECKS_FILE);
    removed.push(`the checks you allowed for it (${CHECKS_FILE.replace(os.homedir(), '~')})`);
  }
  console.log(
    `Removed League of Agents from ${path.basename(ROOT)}:\n${removed.map(r => `  - ${r}`).join('\n')}\n` +
      'If you added the Claude Code plugin, remove it in Claude Code: /plugin uninstall league-of-agents',
  );
  process.exit(0);
}
if (argv[0] === 'uninstall') await uninstall();
if (argv[0] === 'hooks' && argv[1] === 'remove') {
  // A running bridge takes them out itself, so its watch mode doesn't record the change as a run.
  const b = await running();
  let removed;
  if (b?.pid && !b.locked) {
    const r = await fetch(`http://127.0.0.1:${b.port}/api/hooks/remove`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + b.token },
    });
    /** @type {{ error?: string; removed?: string[] }} */
    const body = await r.json();
    if (!r.ok) {
      console.error(body.error);
      process.exit(1);
    }
    removed = body.removed;
  } else removed = removeHooks();
  console.log(removed.length ? 'Removed the League of Agents hooks.' : 'No League of Agents hooks to remove.');
  process.exit(0);
}
if (argv[0] === 'stop') await stopBridge();
if (argv[0] === 'status') await bridgeStatus();
// Hooks go in only with consent: asked once in the terminal and remembered; --hooks and --no-hooks decide.
const HOOKS = argv.includes('--hooks')
  ? true
  : argv.includes('--no-hooks')
    ? false
    : typeof prev.hooks === 'boolean'
      ? prev.hooks
      : process.stdin.isTTY
        ? await askForHooks()
        : false;
// `start` (and no command) runs the bridge in the background; `serve` runs it here, in the foreground.
if (argv[0] !== 'serve') await startInBackground(HOOKS);
// One bridge per repo. A second would take over .loa/bridge.json, and the hooks, which find the bridge there,
// would send its prompts and stops to the wrong one. `start` already opened the running one instead.
{
  const other = await running();
  if (other) {
    console.log(`League of Agents is already running for ${path.basename(ROOT)}: ${linkOf(other)}`);
    process.exit(0);
  }
}
fs.writeFileSync(
  bridgeFile,
  JSON.stringify({ port: PORT, token: TOKEN, hooks: HOOKS, pid: process.pid, web: WEB_URL }, null, 2),
);
// Hooks, ours and the Claude Code plugin's, run a copy of this file inside the repo, so they keep working when
// the bridge was started from a temporary place (npx's cache) that may later be cleared. Built-ins only.
fs.copyFileSync(SELF, hookFile);
if (HOOKS) installHooks();
else removeHooks();
const CODE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|py|go|rs|rb|java|kt|swift|c|h|cpp|cs|php|vue|svelte|css|scss|html|sql|sh|md|yml|yaml|toml)$/i;
const SKIP =
  /(^|\/)(node_modules|\.git|\.loa|dist|build|coverage|\.next|\.turbo)(\/|$)|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$|(^|\/)\.env/;
const MAX_LINES = 400,
  MAX_FILES = 1500,
  // Larger files are left off the map and can't be opened: a guard against reading a giant file into memory.
  MAX_BYTES = 16 * 1024 * 1024;
/** Text, as git judges it: no NUL byte in the first 8,000 bytes. */
const isText = buf => !buf.subarray(0, 8000).includes(0);

function listFiles() {
  const out = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean);
  return [...new Set(out)]
    .filter(p => CODE_EXT.test(p) && !SKIP.test(p) && !IGNORE.some(g => g && p.startsWith(g)))
    .sort()
    .slice(0, MAX_FILES);
}
/**
 * A file as the map shows it: its length and first lines; null for one the map leaves out. The whole file opens on
 * demand (/api/file), so only its start is decoded here.
 */
function treeEntry(p) {
  const abs = path.join(ROOT, p);
  let buf;
  try {
    if (fs.statSync(abs).size > MAX_BYTES) return null;
    buf = fs.readFileSync(abs);
  } catch {
    return null;
  }
  if (!isText(buf)) return null;
  let total = 0;
  for (let i = buf.indexOf(10); i >= 0; i = buf.indexOf(10, i + 1)) total++;
  if (buf.length && buf[buf.length - 1] !== 10) total++;
  const head = buf
    .subarray(0, 256 * 1024)
    .toString('utf8')
    .split('\n');
  return { path: p, total, lines: head.slice(0, Math.min(MAX_LINES, total)) };
}
function readTree() {
  return listFiles().map(treeEntry).filter(Boolean);
}

// ---------------------------------------------------------------- snapshots (private index, never touches your branch or staging)
const SNAP_INDEX = path.join(LOA, 'snapshot.index');
/** Names of files that usually hold secrets, at any depth: untracked ones stay out of snapshots. The README lists them. */
const SECRET_FILES = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  '*.keystore',
  '*.kdbx',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.git-credentials',
  '.htpasswd',
  'credentials.json',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
  'service-account*.json',
  '*.tfvars',
];
/**
 * The working tree as a git tree, written through a private index. The index is kept between snapshots, so
 * git hashes only the files that changed since the last one. `fresh` starts it again from HEAD.
 */
async function writeTree(fresh = false) {
  const env = { ...process.env, GIT_INDEX_FILE: SNAP_INDEX };
  if (fresh || !fs.existsSync(SNAP_INDEX)) {
    try {
      fs.rmSync(SNAP_INDEX);
    } catch {}
    await gitAsync((await headNow()).commit ? ['read-tree', 'HEAD'] : ['read-tree', '--empty'], { env });
  }
  // Untracked files that usually hold secrets (not ignored, not committed) never enter a snapshot. Tracked ones,
  // such as .env.example templates, are already in the repo's history and are snapshotted like any file.
  const untrackedSecrets = (
    await gitAsync([
      'ls-files',
      '-z',
      '--others',
      '--exclude-standard',
      '--',
      ...SECRET_FILES.map(g => `:(glob)**/${g}`),
    ])
  )
    .split('\0')
    .filter(Boolean);
  await gitAsync(['add', '-A'], { env });
  if (untrackedSecrets.length) await gitAsync(['rm', '--cached', '-q', '--', ...untrackedSecrets], { env });
  return (await gitAsync(['write-tree'], { env })).trim();
}
/** A commit of the tree on top of HEAD, reachable only from the refs it is pinned to. */
async function commitTree(tree, label, head) {
  const out = await gitAsync(['commit-tree', tree, ...(head.commit ? ['-p', head.commit] : []), '-m', 'loa ' + label], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'loa',
      GIT_AUTHOR_EMAIL: 'loa@localhost',
      GIT_COMMITTER_NAME: 'loa',
      GIT_COMMITTER_EMAIL: 'loa@localhost',
    },
  });
  return out.trim();
}
/** The branch HEAD points at and its commit; both empty before the first commit. */
async function headNow() {
  try {
    const [commit, ref] = (await gitAsync(['rev-parse', 'HEAD', '--symbolic-full-name', 'HEAD'])).trim().split('\n');
    return { commit, ref };
  } catch {
    return { commit: '', ref: '' };
  }
}
async function pin(id, which, commit) {
  try {
    await gitAsync(['update-ref', `refs/loa/runs/${id}/${which}`, commit]);
  } catch {}
}
async function showAt(ref, p) {
  try {
    return await gitAsync(['show', `${ref}:${p}`]);
  } catch {
    return null;
  }
}
/** A scope entry: a folder (ends in /), a file, or lines of a file (path:12-18). */
function scopeEntry(s) {
  const m = /^(.+):(\d+)-(\d+)$/.exec(s);
  return m ? { path: m[1], from: +m[2], to: +m[3] } : { path: s };
}
/** A file's text as lines, line endings normalised, without the empty line after a final newline. */
function textLines(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
/**
 * Where selected lines start in the file now (1-based), or null when that can't be told. A selection is held by its
 * text and the lines around it (`context`: up to 3 lines before and after that told it apart from identical copies,
 * and whether a copy existed), never by numbers alone, which point at other code as soon as anything above changes.
 * The app applies the same rule (web/src/lib/anchor.ts): kept where it was if no copy could be there instead; else
 * the one copy whose lines on either side still match; else, for code that had no copy, its one exact match. Without
 * context, lines are taken only where their numbers say.
 */
function relocate(lines, wanted, from, context) {
  const n = wanted.length;
  if (!n) return null;
  const found = [];
  for (let s = 1; s + n - 1 <= lines.length; s++) if (wanted.every((w, i) => lines[s - 1 + i] === w)) found.push(s);
  if (!context) return found.includes(from) ? from : null;
  const { before = [], after = [], twin = true } = context;
  const told = s =>
    (before.length > 0 && before.every((b, i) => lines[s - 1 - before.length + i] === b)) ||
    (after.length > 0 && after.every((x, i) => lines[s - 1 + n + i] === x));
  if (found.includes(from) && (found.length === 1 || told(from))) return from;
  const kept = found.filter(told);
  if (kept.length === 1) return kept[0];
  return !twin && found.length === 1 ? found[0] : null;
}
function inScope(scope, rel) {
  return scope
    .map(scopeEntry)
    .some(e => (e.path.endsWith('/') ? e.path === '/' || rel.startsWith(e.path) : rel === e.path));
}
/**
 * A change kept to lines from..to of the file as it was (before) leaves every line around them as it was.
 * Held by the surroundings, not by line numbers, which move as soon as the range itself grows or shrinks.
 */
function rangeKept(before, after, { from, to }) {
  const head = from - 1,
    tail = Math.max(0, before.length - to);
  if (after.length < head + tail) return false;
  for (let i = 0; i < head; i++) if (before[i] !== after[i]) return false;
  for (let i = 1; i <= tail; i++) if (before[before.length - i] !== after[after.length - i]) return false;
  return true;
}
const hashOf = text => crypto.createHash('sha1').update(text).digest('hex');
// ---------------------------------------------------------------- authorship recorded in git (read only)
/**
 * A Git AI authorship log (Git AI Standard v3.0.0, refs/notes/ai): for each file, its lines by author key, and
 * what each key stands for. Lines are 1-based, in the file as the commit has it.
 */
function parseGitAiNote(text) {
  const [attest, meta = '{}'] = text.split(/\n---\n/);
  let m = {};
  try {
    m = JSON.parse(meta);
  } catch {}
  const files = new Map();
  let file = null;
  for (const line of attest.split('\n')) {
    if (!line.trim()) continue;
    if (!line.startsWith('  ')) {
      file = line.replace(/^"(.*)"$/, '$1');
      files.set(file, []);
      continue;
    }
    const [key, spec] = line.trim().split(' ');
    const lines = [];
    for (const part of (spec || '').split(',')) {
      const [a, b] = part.split('-').map(Number);
      for (let n = a; n <= (b || a); n++) lines.push(n);
    }
    let who;
    if (key.startsWith('h_')) who = { author: 'human', by: m.humans?.[key]?.author ?? '' };
    else {
      // s_<session>::t_<trace> names a session; a bare hash, a legacy prompt record.
      const rec = key.startsWith('s_') ? m.sessions?.[key.split('::')[0]] : m.prompts?.[key];
      who = { author: 'agent', by: [rec?.agent_id?.tool, rec?.agent_id?.model].filter(Boolean).join(' · ') };
    }
    if (file) files.get(file).push({ ...who, lines });
  }
  return files;
}
/** Agents that sign commits with a co-author trailer, by the name or address they use. */
const AGENT_COAUTHOR = /anthropic\.com|\bclaude\b|openai|\bcodex\b|cursor|copilot|gemini|\bjules\b|devin/i;
/**
 * Who wrote each line of a file as HEAD has it, from what git records: Git AI notes (refs/notes/ai), and
 * Co-authored-by trailers naming an agent, which cover a whole commit, so its lines are only mixed. Read only.
 */
async function recordedAuthors(rel) {
  let out;
  try {
    out = await gitAsync(['blame', '--porcelain', 'HEAD', '--', rel]);
  } catch {
    return null;
  }
  const commits = new Map(),
    lines = [];
  let cur = null;
  for (const l of out.split('\n')) {
    const head = /^([0-9a-f]{40}) (\d+) \d+/.exec(l);
    if (head) {
      cur = { sha: head[1], orig: Number(head[2]) };
      if (!commits.has(cur.sha)) commits.set(cur.sha, { file: rel });
    } else if (l.startsWith('filename ')) commits.get(cur.sha).file = l.slice(9);
    else if (l.startsWith('\t')) lines.push({ ...cur, text: l.slice(1) });
  }
  for (const [sha, c] of commits) {
    try {
      c.note = parseGitAiNote(await gitAsync(['notes', '--ref=ai', 'show', sha]));
    } catch {}
    const body = await gitAsync(['log', '-1', '--format=%B', sha]).catch(() => '');
    c.coauthor = [...body.matchAll(/^co-authored-by:\s*(.+)$/gim)]
      .map(m => m[1].trim())
      .find(n => AGENT_COAUTHOR.test(n));
  }
  return lines.map(({ sha, orig, text }) => {
    const c = commits.get(sha);
    const hit = c.note?.get(c.file)?.find(e => e.lines.includes(orig));
    const commit = sha.slice(0, 8);
    if (hit) return { text, author: hit.author, source: 'git-ai', by: hit.by, commit };
    if (c.coauthor) return { text, author: 'mixed', source: 'trailer', by: c.coauthor, commit };
    return { text, author: 'unknown', commit };
  });
}

/**
 * Writes who wrote each line, as the app worked it out, to a git note on HEAD: an Agent Trace record (spec 0.1.0,
 * agent-trace.dev; it sets no place to keep records, so this is our choice, refs/notes/agent-trace) or a Git AI
 * authorship log (refs/notes/ai, agent lines only, never over a log already there). Only files whose working copy
 * is HEAD's, so the line numbers are HEAD's. `files`: path to { start, end, author, run } ranges, 1-based. No
 * prompts go in: notes can be pushed.
 * @param {'agent-trace' | 'git-ai'} format
 * @param {Record<string, { start: number; end: number; author: string; run: number | null }[]>} files
 */
async function exportAttribution(format, files) {
  const head = (await headNow()).commit;
  if (!head) return { error: 'There is no commit yet.', code: 'no-commit' };
  /** @type {[string, (typeof files)[string]][]} */
  const asHead = [];
  for (const [p, ranges] of Object.entries(files || {})) {
    if (!repoFile(p) || !Array.isArray(ranges)) continue;
    const same = await gitAsync(['diff', '--quiet', 'HEAD', '--', p]).then(
      () => true,
      () => false,
    );
    if (same) asHead.push([p, ranges.filter(r => r.run && runs.has(r.run))]);
  }
  const named = asHead.filter(([, r]) => r.length);
  if (!named.length)
    return { error: 'No file as the last commit has it has lines from a kept run.', code: 'no-kept-lines' };
  const ref = format === 'git-ai' ? 'refs/notes/ai' : 'refs/notes/agent-trace';
  let note;
  if (format === 'git-ai') {
    const exists = await gitAsync(['notes', '--ref=ai', 'show', head]).then(
      () => true,
      () => false,
    );
    if (exists)
      return {
        error: 'This commit already has a Git AI note; League of Agents never writes over it.',
        code: 'note-exists',
      };
    const sessions = {};
    const attest = [];
    for (const [p, ranges] of named) {
      const keys = new Map();
      for (const r of ranges.filter(r => r.author === 'agent')) {
        const run = runs.get(r.run);
        const tool = run.agent.replace(/-terminal$|-editor$/, '');
        const sid =
          's_' +
          crypto
            .createHash('sha256')
            .update(`${tool}:${run.sessionId ?? run.id}`)
            .digest('hex')
            .slice(0, 14);
        sessions[sid] = {
          agent_id: { tool, id: String(run.sessionId ?? run.id), ...(run.model ? { model: run.model } : {}) },
        };
        const key = `${sid}::t_${crypto.createHash('sha256').update(`${run.id}`).digest('hex').slice(0, 14)}`;
        keys.set(key, [...(keys.get(key) || []), r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`]);
      }
      if (keys.size) attest.push(/[\s"]/.test(p) ? `"${p}"` : p, ...[...keys].map(([k, l]) => `  ${k} ${l.join(',')}`));
    }
    if (!attest.length) return { error: 'No line from a kept run was written by an agent.', code: 'no-agent-lines' };
    note = `${attest.join('\n')}\n---\n${JSON.stringify({ schema_version: 'authorship/3.0.0', base_commit_sha: head, prompts: {}, sessions })}`;
  } else {
    const type = { agent: 'ai', human: 'human', mixed: 'mixed' };
    const record = {
      version: '0.1.0',
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      vcs: { type: 'git', revision: head },
      tool: { name: 'league-of-agents', version: VERSION },
      files: named.map(([p, ranges]) => {
        const byRun = new Map();
        for (const r of ranges.filter(r => type[r.author])) {
          const k = `${r.run}:${r.author}`;
          if (!byRun.has(k)) byRun.set(k, { run: runs.get(r.run), author: r.author, ranges: [] });
          byRun.get(k).ranges.push({ start_line: r.start, end_line: r.end });
        }
        return {
          path: p,
          conversations: [...byRun.values()].map(({ run, author, ranges }) => ({
            contributor: {
              type: type[author],
              ...(author !== 'human' && run.model && /^claude/.test(run.agent)
                ? { model_id: `anthropic/${run.model}` }
                : {}),
            },
            ranges,
          })),
        };
      }),
    };
    note = JSON.stringify(record, null, 2);
  }
  // The note is the person's: their git identity, or League of Agents' own where they have none set.
  const hasIdentity = await gitAsync(['var', 'GIT_AUTHOR_IDENT']).then(
    () => true,
    () => false,
  );
  const who = {
    GIT_AUTHOR_NAME: 'loa',
    GIT_AUTHOR_EMAIL: 'loa@localhost',
    GIT_COMMITTER_NAME: 'loa',
    GIT_COMMITTER_EMAIL: 'loa@localhost',
  };
  await gitAsync(['notes', `--ref=${ref.slice('refs/notes/'.length)}`, 'add', '-f', '-F', '-', head], {
    input: note,
    ...(hasIdentity ? {} : { env: { ...process.env, ...who } }),
  });
  return { ref, commit: head, files: named.length };
}

/**
 * The absolute path of a file the app may read or write, or null: only a file the map shows (listFiles,
 * which leaves out .env files, .git, .loa and the skip list), whose real path is inside the repo, and that
 * is text under MAX_BYTES.
 */
function repoFile(rel) {
  if (typeof rel !== 'string' || !listFiles().includes(rel)) return null;
  const abs = path.join(ROOT, rel);
  try {
    const real = fs.realpathSync(abs);
    if (!real.startsWith(fs.realpathSync(ROOT) + path.sep)) return null;
    const st = fs.statSync(real);
    if (!st.isFile() || st.size > MAX_BYTES || !isText(fs.readFileSync(real))) return null;
  } catch {
    return null;
  }
  return abs;
}
function splitLines(t) {
  const l = t.split('\n');
  if (l.length && l[l.length - 1] === '') l.pop();
  return l;
}
async function computeChanges(before, after) {
  const patch = await gitAsync([
    'diff',
    '--no-color',
    '--no-renames',
    '--no-ext-diff',
    '-U0',
    before,
    after,
    '--',
    '.',
    ':(exclude).loa',
  ]);
  const out = [];
  let cur = null,
    h = null;
  const unq = s => (s.startsWith('"') ? JSON.parse(s) : s);
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = { path: null, created: false, deleted: false, binary: false, hunks: [] };
      out.push(cur);
      h = null;
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('new file mode')) cur.created = true;
    else if (line.startsWith('deleted file mode')) cur.deleted = true;
    else if (line.startsWith('Binary files')) cur.binary = true;
    else if (line.startsWith('--- ')) {
      const a = unq(line.slice(4));
      if (a !== '/dev/null') cur.path = a.replace(/^a\//, '');
    } else if (line.startsWith('+++ ')) {
      const b = unq(line.slice(4));
      if (b !== '/dev/null') cur.path = b.replace(/^b\//, '');
    } else if (line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      const a = +m[1],
        b = m[2] === undefined ? 1 : +m[2];
      h = { at: b === 0 ? a : a - 1, del: b, add: [] };
      cur.hunks.push(h);
    } else if (h && line.startsWith('+')) h.add.push(line.slice(1));
  }
  return Promise.all(
    out
      .filter(c => c.path && !c.binary && !SKIP.test(c.path))
      .map(async c => {
        const pre = c.created ? [] : splitLines((await showAt(before, c.path)) || '');
        return { path: c.path, created: c.created, deleted: c.deleted, pre: pre.slice(0, 4000), hunks: c.hunks };
      }),
  );
}

// ---------------------------------------------------------------- runs
const runs = new Map();
for (const f of fs.readdirSync(RUNS_DIR))
  if (f.endsWith('.json')) {
    const r = readJson(path.join(RUNS_DIR, f));
    if (r) runs.set(r.id, r);
  }
let active = null; // { run, child, cancel }: cancel, for a harness asked to stop its turn (startAcp)
const nextId = () => Math.max(0, ...runs.keys()) + 1;
/** Runs kept: the newest KEEP_RUNS, and every run from the last KEEP_DAYS days, whichever is more. */
const KEEP_RUNS = 500,
  KEEP_DAYS = 30;
/** Deletes the runs older than both limits: their records, their raw output and their snapshot refs. */
function pruneRuns() {
  const ids = [...runs.keys()].sort((a, b) => a - b);
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  const old = ids
    .slice(0, Math.max(0, ids.length - KEEP_RUNS))
    .filter(id => (runs.get(id).endedAt ?? runs.get(id).startedAt ?? 0) < cutoff);
  if (!old.length) return;
  git(['update-ref', '--stdin'], {
    input:
      old.flatMap(id => [`delete refs/loa/runs/${id}/before`, `delete refs/loa/runs/${id}/after`]).join('\n') + '\n',
  });
  for (const id of old) {
    for (const ext of ['.json', '.stream.jsonl', '.stderr.log'])
      fs.rmSync(path.join(RUNS_DIR, id + ext), { force: true });
    runs.delete(id);
  }
}
pruneRuns();
const saveRun = r => fs.writeFileSync(path.join(RUNS_DIR, r.id + '.json'), JSON.stringify(r));
const publicRun = r => ({ ...r, stream: (r.stream || []).slice(-60) });
/** A run's title: the prompt's first line, shortened. */
const title = s => {
  s = String(s || '')
    .trim()
    .split('\n')[0]
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > 72 ? s.slice(0, 70) + '…' : s || 'Untitled run';
};

/**
 * @param {{ agent: string; prompt?: string; scope?: string[]; resumeFrom?: number | null; sessionId?: string | null }} opts
 */
function newRun({ agent, prompt = '', scope = [], resumeFrom = null, sessionId = null }) {
  return {
    id: nextId(),
    agent,
    title: title(prompt),
    prompt: prompt || '',
    scope,
    resumeFrom,
    sessionId,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    before: null,
    after: null,
    changes: [],
    checks: [],
    summary: '',
    stream: [],
    cost: null,
    /** The model the agent reported; null until it does, and for agents that don't (Codex). */
    model: null,
    kept: false,
    reverted: false,
  };
}
function beginRun(opts) {
  return serial(async () => {
    if (active)
      throw Object.assign(new Error(`Run ${active.run.id} is still active`), {
        code: 409,
        reason: 'run-active',
        args: { id: active.run.id },
      });
    // Changes made before the run started are recorded on their own, so they never count as the agent's.
    const before = await settle();
    const run = newRun(opts);
    run.before = before;
    await pin(run.id, 'before', run.before);
    runs.set(run.id, run);
    active = { run, child: null };
    saveRun(run);
    emit('state');
    return run;
  });
}
async function finishRun(run, status = 'done') {
  // Watch mode's runs arrive with their after snapshot; an agent's is taken now and becomes the baseline.
  if (!run.after)
    await serial(async () => {
      const head = await headNow(),
        tree = await writeTree();
      run.after = await commitTree(tree, `run ${run.id} after`, head);
      base = { head, tree, commit: run.after };
    });
  await pin(run.id, 'after', run.after);
  run.changes = await computeChanges(run.before, run.after);
  run.agentLines = agentLinesOf(run);
  if (run.agent === 'detected' || run.agent === 'you') run.title = editedTitle(run.changes);
  const out = await scopeViolations(run);
  if (out.length) run.stream.push({ t: 'warn', text: `Changed outside scope: ${out.join(', ')}` });
  run.outOfScope = out;
  run.status = status;
  run.endedAt = Date.now();
  if (active && active.run === run) active = null;
  saveRun(run);
  pruneRuns();
  emitRun(run);
  if (run.changes.length && CONF.checks?.length) {
    run.checksRunning = true;
    emit('progress', run);
    runChecks(run)
      .catch(e => run.checks.push({ name: 'checks', ok: false, summary: e.message }))
      .finally(() => {
        run.checksRunning = false;
        saveRun(run);
        emitRun(run);
      });
  }
}
/** Names what watch mode saw change: "Edited main.py", or "Edited main.py and 2 more". */
function editedTitle(changes) {
  const first = path.posix.basename(changes[0].path);
  return changes.length > 1 ? `Edited ${first} and ${changes.length - 1} more` : `Edited ${first}`;
}
/** Files and folders outside the scope that changed, and line ranges whose surroundings changed. */
async function scopeViolations(run) {
  if (!run.scope?.length) return [];
  const out = [];
  for (const c of run.changes) {
    if (!inScope(run.scope, c.path)) {
      out.push(c.path);
      continue;
    }
    const range = run.scope.map(scopeEntry).find(e => e.from && e.path === c.path);
    if (range && !rangeKept(c.pre, splitLines((await showAt(run.after, c.path)) ?? ''), range))
      out.push(`${c.path} outside lines ${range.from}–${range.to}`);
  }
  return out;
}
function push(run, entry) {
  run.stream.push(entry);
  if (run.stream.length > 400) run.stream.splice(0, run.stream.length - 400);
  emit('progress', run);
}

// ---------------------------------------------------------------- agents
/**
 * The scope, written above the prompt. What it says holds for every agent: changes outside the scope are reported
 * and can be undone. Only Claude Code's edit tools are blocked outside it, by the scope lock (runHook 'pre'), which
 * is one of the hooks: without them, Claude Code isn't told it is blocked.
 */
function scopePreamble(scope, agent) {
  if (!scope?.length) return '';
  const line = s => {
    const e = scopeEntry(s);
    return e.from
      ? `- ${e.path}, lines ${e.from} to ${e.to} only: keep every other line of this file as it is`
      : '- ' + s;
  };
  const blocked = agent === 'claude' && HOOKS ? '\nEdits outside it made with edit tools are blocked.' : '';
  return `Scope for this task:\n${scope.map(line).join('\n')}\nEdit only inside this scope. Changes outside it are reported to the user and can be undone.${blocked}\n\n`;
}
function startAgent(run, read = {}) {
  const prompt = scopePreamble(run.scope, run.agent) + run.prompt;
  const scopeFile = path.join(LOA, 'scope.json');
  // For line ranges, the hook needs each file as it was when the run started: as read when its lines were found.
  const ranges = {};
  for (const e of (run.scope || []).map(scopeEntry))
    if (e.from)
      ranges[e.path] = {
        from: e.from,
        to: e.to,
        before: read[e.path] ?? fs.readFileSync(path.join(ROOT, e.path), 'utf8'),
      };
  fs.writeFileSync(scopeFile, JSON.stringify({ scope: run.scope || [], ranges }));
  if (ACP[run.agent]) return startAcp(run, prompt, scopeFile);
  let cmd, args;
  if (run.agent === 'claude') {
    cmd = BIN.claude;
    args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'];
    if (run.sessionId) args.push('--resume', run.sessionId);
  } else if (run.agent === 'cursor') {
    cmd = BIN.cursor;
    args = [
      '-p',
      '--force',
      '--output-format',
      'stream-json',
      ...(run.sessionId ? ['--resume', run.sessionId] : []),
      prompt,
    ];
  } else if (run.agent === 'codex') {
    cmd = BIN.codex;
    args = [
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      ...(run.sessionId ? ['resume', run.sessionId] : []),
      prompt,
    ];
  } else throw new Error('Unknown agent ' + run.agent);
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, LOA_MANAGED: '1', LOA_SCOPE_FILE: scopeFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  active.child = child;
  // Raw agent output, kept as-is for fixtures and debugging.
  const rawOut = fs.createWriteStream(path.join(RUNS_DIR, `${run.id}.stream.jsonl`));
  const rawErr = fs.createWriteStream(path.join(RUNS_DIR, `${run.id}.stderr.log`));
  let buf = '';
  child.stdout.on('data', d => {
    rawOut.write(d);
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onAgentLine(run, line);
    }
  });
  child.stderr.on('data', d => {
    rawErr.write(d);
    const t = String(d).trim();
    if (t) push(run, { t: 'err', text: t.slice(0, 500) });
  });
  child.on('error', e => {
    push(run, { t: 'err', text: `Could not start ${cmd}: ${e.message}` });
  });
  child.on('close', code => {
    rawOut.end();
    rawErr.end();
    try {
      fs.rmSync(scopeFile);
    } catch {}
    if (code && run.status === 'running')
      push(run, { t: 'err', text: `${AGENTS[run.agent].name} exited with code ${code}` });
    const ended = ['cancelled', 'interrupted'].includes(run.status) ? run.status : code ? 'failed' : 'done';
    finishRun(run, ended).catch(logError);
  });
}
/**
 * The lines Claude Code wrote itself, per file, from its edit tools' input: what Edit, MultiEdit and Write put
 * in. Kept for the run's attribution; lines it changed any other way (shell commands, scripts) aren't here.
 */
const writes = new Map();
function noteWrites(run, name, input) {
  if (!/^claude/.test(run.agent) || !input?.file_path) return;
  const texts =
    name === 'Write'
      ? [input.content]
      : name === 'Edit'
        ? [input.new_string]
        : name === 'MultiEdit'
          ? (input.edits || []).map(e => e.new_string)
          : [];
  noteLines(run, input.file_path, texts);
}
/** Lines an agent wrote into a file, by the path it named, kept for the run's attribution (agentLinesOf). */
function noteLines(run, file, texts) {
  // Agents name files by the path they were given, which may run through a symlink (macOS's /var is /private/var).
  let abs = path.resolve(ROOT, file);
  try {
    abs = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
  } catch {}
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  if (!writes.has(run.id)) writes.set(run.id, new Map());
  const files = writes.get(run.id);
  for (const t of texts) if (typeof t === 'string') files.set(rel, [...(files.get(rel) || []), ...t.split('\n')]);
}
/**
 * The run's added lines its agent wrote through its edit tools, per file, as [from, to] ranges of line indexes
 * in the file after the run; absent for agents that don't report their edits.
 */
function agentLinesOf(run) {
  const files = writes.get(run.id);
  writes.delete(run.id);
  if (!files) return undefined;
  const out = {};
  for (const c of run.changes) {
    const wrote = new Map();
    for (const l of files.get(c.path) || []) wrote.set(l, (wrote.get(l) || 0) + 1);
    const ranges = [];
    let shift = 0;
    for (const h of c.hunks) {
      h.add.forEach((l, i) => {
        if (!wrote.get(l)) return;
        wrote.set(l, wrote.get(l) - 1);
        const at = h.at + shift + i,
          last = ranges.at(-1);
        if (last && last[1] === at - 1) last[1] = at;
        else ranges.push([at, at]);
      });
      shift += h.add.length - h.del;
    }
    if (ranges.length) out[c.path] = ranges;
  }
  return out;
}
function onAgentLine(run, line) {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    push(run, { t: 'text', text: line.slice(0, 500) });
    return;
  }
  if (m.session_id && !run.sessionId) run.sessionId = m.session_id;
  if (m.sessionId && !run.sessionId) run.sessionId = m.sessionId;
  if (m.type === 'thread.started' && m.thread_id && !run.sessionId) run.sessionId = m.thread_id;
  // The model, as the agent names it: Claude Code's and Cursor's first event, and each of Claude Code's replies.
  // Codex doesn't say. Claude Code marks its own made-up messages "<synthetic>".
  const model =
    m.type === 'system' && m.subtype === 'init' ? m.model : m.type === 'assistant' ? m.message?.model : null;
  if (typeof model === 'string' && model && !model.startsWith('<') && !run.model) run.model = model;
  // Logged out mid-session: Claude Code answers every prompt with "Not logged in".
  if (run.agent === 'claude' && m.type === 'assistant' && m.error === 'authentication_failed') {
    AGENTS.claude.problem = 'loggedOut';
    AGENTS.claude.available = false;
    claudeAsked = Date.now();
    emit('state');
  }
  if (m.type === 'assistant' && m.message?.content) {
    for (const c of m.message.content) {
      if (c.type === 'text' && c.text?.trim()) push(run, { t: 'text', text: c.text.trim() });
      if (c.type === 'tool_use') {
        push(run, { t: 'tool', text: toolLabel(c.name, c.input) });
        noteWrites(run, c.name, c.input);
      }
    }
  } else if (m.type === 'user' && Array.isArray(m.message?.content)) {
    for (const c of m.message.content) if (c.type === 'tool_result' && c.is_error) push(run, toolError(c.content));
  } else if (m.type === 'system' && m.subtype === 'post_turn_summary') {
    // Claude Code's own verdict on the turn: completed or blocked, and what it needs from you. A later
    // turn's verdict replaces an earlier one.
    run.turn = {
      status: String(m.status_category || ''),
      detail: relPaths(String(m.status_detail || '')),
      needs: relPaths(String(m.needs_action || '')),
    };
    emit('progress', run);
  } else if (m.type === 'result') {
    if (typeof m.result === 'string') run.summary = m.result.trim();
    if (m.total_cost_usd != null) run.cost = m.total_cost_usd;
    emit('progress', run);
  } else if (m.type === 'tool_call' || m.type === 'item.completed' || m.type === 'item.started') {
    const it = m.item || m.tool_call || m;
    push(run, { t: 'tool', text: it.type || it.name || m.type });
    if (it.text && m.type === 'item.completed' && /message/.test(it.type || '')) run.summary = it.text;
  }
}
/**
 * A run by an ACP harness: JSON-RPC 2.0 over its stdin and stdout, one message a line. No file system or terminal
 * is offered: the bridge reads what changed from its own snapshots. The harness's reply becomes the run's summary,
 * its tool calls the activity, and the edits it shows as diffs count as its lines. A follow-up resumes the same
 * session. What it asks before doing is answered by permitAcp. When the turn ends, the harness is stopped.
 */
function startAcp(run, prompt, scopeFile) {
  const { name, command, env } = ACP[run.agent];
  const child = spawn(command[0], command.slice(1), {
    cwd: ROOT,
    env: { ...process.env, LOA_MANAGED: '1', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  active.child = child;
  const rawOut = fs.createWriteStream(path.join(RUNS_DIR, `${run.id}.stream.jsonl`));
  const rawErr = fs.createWriteStream(path.join(RUNS_DIR, `${run.id}.stderr.log`));
  // Each tool call as told so far: a permission request may name only the call (DeepSeek Harness does).
  const waiting = new Map(),
    calls = new Map(),
    diffsSeen = new Set();
  let next = 1,
    buf = '',
    said = '',
    lastErr = '',
    prompted = false,
    outcome = null;
  const send = m => child.stdin.writable && child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve, reject });
      send({ id, method, params });
    });
  // The reply so far, as one entry each time the harness turns to something else; the last one is the summary.
  const flush = () => {
    const text = said.trim();
    said = '';
    if (!text) return;
    push(run, { t: 'text', text });
    run.summary = text;
  };
  // The lines a tool call writes, once per call and file: from the diffs it shows (Hermes, in the request to edit
  // and again as it completes), or from an edit's own arguments (DeepSeek Harness's edit and write).
  const noteEdit = (id, tool) => {
    const raw = tool?.rawInput || {};
    const texts = [
      ...(tool?.content || []).filter(c => c?.type === 'diff').map(c => [c.path, c.newText]),
      [raw.file_path, raw.new_string ?? raw.content],
    ];
    for (const [file, text] of texts)
      if (typeof file === 'string' && typeof text === 'string' && !diffsSeen.has(`${id} ${file}`)) {
        diffsSeen.add(`${id} ${file}`);
        noteLines(run, file, [text]);
      }
  };
  const onUpdate = u => {
    if (u.sessionUpdate === 'agent_message_chunk') {
      if (u.content?.type === 'text') said += u.content.text;
      return;
    }
    if (u.sessionUpdate === 'tool_call') {
      flush();
      calls.set(u.toolCallId, u);
      push(run, { t: 'tool', text: acpToolLabel(u) });
      if (u.kind === 'edit') noteEdit(u.toolCallId, { content: u.content });
    } else if (u.sessionUpdate === 'tool_call_update') {
      const tool = { ...calls.get(u.toolCallId), ...u };
      calls.set(u.toolCallId, tool);
      if (tool.kind === 'edit') noteEdit(u.toolCallId, { content: u.content });
      if (u.status === 'failed') {
        const said = (u.content || []).map(c => c?.content?.text || '').join(' ');
        // DeepSeek Harness's read-only mode denies each write until it asks (dsh-sandbox-policy): expected.
        push(
          run,
          /\[sandbox: file access denied/.test(said)
            ? { t: 'warn', text: `Needs permission: ${acpToolLabel(tool)}` }
            : { t: 'err', text: `${acpToolLabel(tool)} failed` },
        );
      }
    } else if (u.sessionUpdate === 'config_option_update') {
      run.model = acpModel(u) ?? run.model;
      emit('progress', run);
    }
  };
  const onMessage = m => {
    if (m.id !== undefined && !m.method) {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      if (w) m.error ? w.reject(new Error(m.error.message || 'error')) : w.resolve(m.result ?? {});
    } else if (m.method === 'session/update') {
      // A resumed session may be replayed first (Hermes does): only what comes once the prompt is sent is this run's.
      const u = m.params?.update || {};
      if (prompted || u.sessionUpdate === 'config_option_update') onUpdate(u);
    } else if (m.method === 'session/request_permission') {
      const req = m.params || {},
        id = req.toolCall?.toolCallId;
      const tool = { ...calls.get(id), ...req.toolCall };
      const answer = permitAcp(run, tool, req.options || []);
      if (answer.optionId && /^allow/.test(req.options.find(o => o.optionId === answer.optionId)?.kind))
        noteEdit(id, tool);
      send({ id: m.id, result: { outcome: answer } });
    } else if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: 'Not offered' } });
  };
  child.stdout.on('data', d => {
    rawOut.write(d);
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {}
    }
  });
  // Harnesses log freely to stderr: kept in the raw log, and its last line said only if the run fails.
  child.stderr.on('data', d => {
    rawErr.write(d);
    lastErr = String(d).trim().split('\n').at(-1) || lastErr;
  });
  child.on('error', e => push(run, { t: 'err', text: `Could not start ${command[0]}: ${e.message}` }));
  // Cancel: the harness is asked to stop the turn, and stopped if it hasn't within 3 s.
  active.cancel = () => {
    send({ method: 'session/cancel', params: { sessionId: run.sessionId } });
    setTimeout(() => child.kill('SIGTERM'), 3000).unref();
  };
  (async () => {
    const init = await call('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'league-of-agents', version: VERSION },
    });
    const where = { cwd: ROOT, mcpServers: [] };
    let session;
    if (run.sessionId && init.agentCapabilities?.sessionCapabilities?.resume)
      session = await call('session/resume', { sessionId: run.sessionId, ...where });
    else {
      if (run.sessionId) push(run, { t: 'warn', text: `${name} can't resume a session: this run starts a new one` });
      session = await call('session/new', where);
      run.sessionId = session.sessionId;
    }
    run.model = acpModel(session) ?? run.model;
    emit('progress', run);
    prompted = true;
    const r = await call('session/prompt', { sessionId: run.sessionId, prompt: [{ type: 'text', text: prompt }] });
    flush();
    if (r.stopReason === 'refusal') push(run, { t: 'err', text: `${name} refused the task` });
    if (r.stopReason === 'max_tokens' || r.stopReason === 'max_turn_requests')
      push(run, { t: 'warn', text: `${name} stopped at its limit before finishing` });
    outcome = r.stopReason === 'cancelled' ? 'cancelled' : r.stopReason === 'refusal' ? 'failed' : 'done';
  })()
    .catch(e => {
      flush();
      push(run, { t: 'err', text: `${name}: ${e.message}`.slice(0, 500) });
      outcome = 'failed';
    })
    .finally(() => {
      child.stdin.end();
      setTimeout(() => child.kill('SIGTERM'), 2000).unref();
    });
  child.on('close', code => {
    rawOut.end();
    rawErr.end();
    waiting.clear();
    try {
      fs.rmSync(scopeFile);
    } catch {}
    if (!outcome && run.status === 'running')
      push(run, { t: 'err', text: `${name} exited with code ${code}${lastErr ? `: ${lastErr.slice(0, 300)}` : ''}` });
    const ended = ['cancelled', 'interrupted'].includes(run.status) ? run.status : outcome || 'failed';
    finishRun(run, ended).catch(logError);
  });
}
/**
 * What an ACP harness asks before doing it (the tool call, as told so far): an edit is allowed when every file it
 * names is in the repo (not its .git or .loa) and in the run's scope, if it has one. Anything else is refused, and
 * the run says what. An edit is a call of kind "edit" (Hermes), or DeepSeek Harness's edit or write tool, which it
 * sends as kind "other" with the file in its arguments.
 */
function permitAcp(run, tool, options) {
  const files = [
    ...(tool.locations || []).map(l => l?.path),
    ...(tool.content || []).filter(c => c?.type === 'diff').map(c => c.path),
    tool.rawInput?.file_path,
  ].filter(f => typeof f === 'string');
  const rel = files.map(f => repoRelative(f).split(path.sep).join('/'));
  const inRepo = rel.every(
    r => r && !r.startsWith('../') && r !== '..' && !path.isAbsolute(r) && !/^\.(git|loa)\//.test(r),
  );
  const edit = tool.kind === 'edit' || (tool.kind === 'other' && ['edit', 'write'].includes(tool.title));
  const ok = edit && rel.length > 0 && inRepo && (!run.scope?.length || rel.every(r => inScope(run.scope, r)));
  const option = options.find(o => (ok ? /^allow/ : /^reject/).test(o.kind));
  if (!ok) {
    const what = acpToolLabel({ title: 'a request', ...tool });
    push(run, { t: 'deny', text: rel.length && inRepo ? `Refused, outside the scope: ${what}` : `Refused: ${what}` });
  }
  return option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' };
}
/** A tool call as an activity entry: its title, with the file or command it names when the title doesn't. */
function acpToolLabel(u) {
  const title = relPaths(String(u.title || u.kind || 'tool')).slice(0, 120);
  const f = u.locations?.[0]?.path || u.rawInput?.file_path || u.rawInput?.path;
  if (typeof f === 'string') return title.includes(path.basename(f)) ? title : `${title} ${repoRelative(f)}`;
  const cmd = u.rawInput?.command;
  return typeof cmd === 'string' && !title.includes(cmd) ? `${title} ${relPaths(cmd).slice(0, 80)}` : title;
}
/**
 * The model an ACP session runs, by the name its harness gives it: its "model" config option (DeepSeek Harness),
 * or its current model (Hermes). Null when it reports neither: never a guess.
 */
function acpModel(s) {
  const opt = (s.configOptions || []).find(o => o?.category === 'model');
  if (opt) {
    const named = (opt.options || []).flatMap(o => o.options || [o]).find(o => o.value === opt.currentValue)?.name;
    return named || (typeof opt.currentValue === 'string' ? opt.currentValue : null);
  }
  const m = s.models;
  if (typeof m?.currentModelId !== 'string') return null;
  return m.availableModels?.find(a => a.modelId === m.currentModelId)?.name || m.currentModelId;
}
/** A failed tool call, as an activity entry: blocked by the scope lock, denied, or an error. */
function toolError(content) {
  const text = relPaths(Array.isArray(content) ? content.map(c => c.text || '').join(' ') : content || '');
  const lock =
    text.match(/League of Agents scope lock: (\S+) is outside the selected scope/) ||
    text.match(/League of Agents scope lock: this edit changes (\S+ outside lines \S+)\./);
  if (lock) return { t: 'warn', text: `Blocked by the scope lock: ${lock[1]}` };
  const line = text.split('\n')[0].slice(0, 300);
  return /requires approval|permission/i.test(line) ? { t: 'deny', text: line } : { t: 'err', text: line };
}
/** Absolute paths inside the repo become repo-relative, in any text. */
function relPaths(text) {
  return String(text)
    .split(ROOT + path.sep)
    .join('')
    .split(ROOT)
    .join('.');
}
/** A path as the repo sees it, following symlinks (macOS /var is /private/var) before making it relative. */
function repoRelative(f) {
  let abs = path.resolve(ROOT, f);
  try {
    abs = fs.realpathSync(abs);
  } catch {
    try {
      abs = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
    } catch {
      /* neither the file nor its folder exists: keep the path as given */
    }
  }
  return path.relative(ROOT, abs);
}
function toolLabel(name, input = {}) {
  const f = input.file_path || input.notebook_path || input.path;
  if (f) return `${name} ${repoRelative(f)}`;
  if (input.command) return `${name} ${relPaths(input.command).slice(0, 80)}`;
  if (input.pattern) return `${name} ${input.pattern}`;
  return name;
}

// ---------------------------------------------------------------- checks
function portBusy(port) {
  return new Promise(r => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => {
      s.destroy();
      r(true);
    });
    s.once('error', () => r(false));
  });
}
async function runChecks(run) {
  run.checks = [];
  for (const c of CONF.checks) {
    if (c.requires_free_port && (await portBusy(c.requires_free_port))) {
      run.checks.push({
        name: c.name,
        ok: null,
        summary: `Skipped: port ${c.requires_free_port} is in use. Stop the running server first.`,
      });
      continue;
    }
    const t0 = Date.now();
    const res = await new Promise(resolve => {
      const ch = spawn(c.run, { cwd: ROOT, shell: true, env: { ...process.env, CI: '1' } });
      let out = '';
      const add = d => {
        out += d;
        if (out.length > 200000) out = out.slice(-100000);
      };
      ch.stdout.on('data', add);
      ch.stderr.on('data', add);
      const timer = setTimeout(() => ch.kill('SIGTERM'), (c.timeout_s || 900) * 1000);
      ch.on('close', code => {
        clearTimeout(timer);
        resolve({ code, out });
      });
    });
    const clean = res.out.replace(/\x1b\[[0-9;]*m/g, '');
    const error = res.code ? setupError(clean, res.code) : null;
    if (error) {
      run.checks.push({
        name: c.name,
        ok: null,
        couldNotRun: true,
        summary: error,
        ms: Date.now() - t0,
        tail: clean.split('\n').slice(-40).join('\n'),
      });
      emit('progress', run);
      continue;
    }
    const hit = clean.match(/(\d+)\s+(passed|passing)[^\n]*/i) || clean.match(/(\d+)\s+failed[^\n]*/i);
    run.checks.push({
      name: c.name,
      ok: res.code === 0,
      summary: hit ? hit[0].trim() : `exit ${res.code}`,
      ms: Date.now() - t0,
      tail: clean.split('\n').slice(-40).join('\n'),
    });
    emit('progress', run);
  }
}

/**
 * Why a check couldn't run on this machine, as the error's own line, or null when it ran and failed. Only
 * clear setup problems count: a command that isn't installed (exit 127), or a package that isn't installed and
 * isn't part of the repo. A missing module the repo has, a failing test or anything else is a real failure.
 */
function setupError(out, code) {
  // pytest marks error lines with a leading "E".
  const lines = out.split('\n').map(l => l.trim().replace(/^E\s+/, ''));
  const line = re => lines.find(l => re.test(l))?.slice(0, 200) ?? null;
  if (code === 127)
    return line(/command not found|not found|No such file or directory/) ?? `Command not found (exit 127)`;
  const missing = [
    ...out.matchAll(/No module named '([\w.]+)'/g),
    ...out.matchAll(/Cannot find (?:module|package) '([^'.\/][^']*)'/g),
  ].map(m => m[1]);
  if (!missing.length) return null;
  const tracked = git(['ls-files']).split('\n');
  const inRepo = name => {
    const top = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split(/[./]/)[0];
    return tracked.some(f =>
      f.split('/').some((seg, i, all) => seg === top || (i === all.length - 1 && seg === `${top}.py`)),
    );
  };
  const outside = missing.find(m => !inRepo(m));
  return outside
    ? line(new RegExp(`(No module named|Cannot find (module|package)) '${outside.replace(/[^\w@/-]/g, '\\$&')}'`))
    : null;
}

// ---------------------------------------------------------------- revert
async function revertRun(run, force) {
  const drift = [];
  for (const c of run.changes) {
    const now = fs.existsSync(path.join(ROOT, c.path)) ? fs.readFileSync(path.join(ROOT, c.path), 'utf8') : null;
    if (now !== (await showAt(run.after, c.path))) drift.push(c.path);
  }
  if (drift.length && !force) return { conflict: drift };
  for (const c of run.changes) {
    const abs = path.resolve(ROOT, c.path);
    // A run names only files inside the repo; anything else in a run file is never touched.
    if (!abs.startsWith(ROOT + path.sep)) continue;
    if (c.created) {
      try {
        fs.rmSync(abs);
      } catch {}
      continue;
    }
    const before = await showAt(run.before, c.path);
    if (before !== null) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, before);
    }
  }
  run.reverted = true;
  // The bridge's own writes are not someone's changes.
  if (!active) await serial(() => rebase());
  saveRun(run);
  emit('state');
  return { ok: true };
}

// ---------------------------------------------------------------- watch mode
// Changes made outside a run, by any editor or agent, become a run ("Edited main.py") once the files have
// been quiet for a while. The baseline is the working tree as last seen: at start, after every run and
// revert. Ignored files never enter a snapshot, so they never make a run. When HEAD moves (a branch switch,
// pull or commit) the baseline resets and nothing is recorded. During a run, the run's own snapshots
// cover every change, so watch mode stays quiet.
const QUIET_MS = Number(process.env.LOA_QUIET_MS || 3000);
/**
 * A run started by an agent's hooks ends with its Stop. If that never comes (the agent crashed, or its stop went
 * elsewhere), the run would hold watch mode quiet for good: after this long with no file changes it is closed as
 * interrupted, with its changes.
 */
const HOOK_IDLE_MS = Number(process.env.LOA_HOOK_IDLE_MS || 30 * 60 * 1000);
/** @type {NodeJS.Timeout | undefined} */
let idleTimer;
function armIdle() {
  clearTimeout(idleTimer);
  const run = active?.run;
  if (!run || !Object.values(HOOK_AGENT).includes(run.agent)) return;
  idleTimer = setTimeout(() => {
    if (active?.run === run) finishRun(run, 'interrupted').catch(logError);
  }, HOOK_IDLE_MS);
}
/** @type {{ head: { commit: string; ref: string }; tree: string; commit: string } | null} */
let base = null;
/** @type {NodeJS.Timeout | undefined} */
let quietTimer;
const pending = new Set();
const sameHead = (a, b) => a.commit === b.commit && a.ref === b.ref;
/** Takes a new baseline; `fresh` restarts the snapshot index from HEAD, as when HEAD moved. */
async function rebase(fresh = false) {
  const head = await headNow(),
    tree = await writeTree(fresh);
  base = { head, tree, commit: await commitTree(tree, 'baseline', head) };
}
/**
 * Brings the baseline up to date, recording any changes since it as a run. Returns the new baseline.
 * Runs in the serial lane.
 */
async function settle() {
  clearTimeout(quietTimer);
  pending.clear();
  const head = await headNow();
  if (!sameHead(head, base.head)) {
    await rebase(true);
    // Not a run, but the map follows: the branch and its files changed.
    emit('state');
    return base.commit;
  }
  const tree = await writeTree();
  if (tree === base.tree) return base.commit;
  const before = base.commit;
  base = { head, tree, commit: await commitTree(tree, 'detected', head) };
  if (!(await computeChanges(before, base.commit)).length) return base.commit;
  const run = newRun({ agent: 'detected' });
  run.before = before;
  run.after = base.commit;
  await pin(run.id, 'before', before);
  runs.set(run.id, run);
  finishRun(run).catch(logError);
  return base.commit;
}
/** True when every changed path is ignored by git, as a dev server's output is: no snapshot needed. */
async function onlyIgnored(paths) {
  if (!paths.length || paths.includes('')) return false;
  try {
    const out = await gitAsync(['check-ignore', '--stdin', '-z'], { input: paths.join('\0') + '\0' });
    return out.split('\0').filter(Boolean).length === paths.length;
  } catch {
    return false; // exit code 1: none of them is ignored
  }
}
function onQuiet() {
  const paths = [...pending];
  pending.clear();
  serial(async () => {
    if (active || (await onlyIgnored(paths))) return;
    await settle();
  }).catch(logError);
}
/**
 * A change League of Agents makes to the person's files, outside any run: changes waiting to be recorded are
 * recorded first, then the new baseline takes the change in, so watch mode never records it.
 */
function ownWrite(write) {
  return serial(async () => {
    await settle();
    const out = write();
    await rebase();
    return out;
  });
}
/** Writes loa.config.json as an own write; a file that would be empty is removed. */
function writeConfig(file) {
  return ownWrite(() => {
    if (Object.keys(file).length) fs.writeFileSync(CONFIG_FILE, JSON.stringify(file, null, 2) + '\n');
    else fs.rmSync(CONFIG_FILE, { force: true });
  });
}
/** Takes the first baseline, then watches. The bridge starts listening only once the baseline exists. */
/** Why watch mode is off, if it is: the app says so, since edits outside a run then go unrecorded. */
let watchOff = null;
function watchFailed(e) {
  watchOff = e.code === 'ENOSPC' ? 'the system limit on watched folders is reached' : e.message;
  console.error('Watch mode is off: ' + watchOff);
  emit('state');
}
async function watch() {
  await serial(() => rebase(true));
  try {
    const watcher = fs.watch(ROOT, { recursive: true }, (_, f) => {
      const p = f ? String(f).split(path.sep).join('/') : '';
      // Inside .git only a moved HEAD or branch matters; the rest is git's own bookkeeping, ours included.
      if (p === '.git' || p.startsWith('.git/')) {
        if (!/^\.git\/(HEAD|packed-refs|refs\/heads\/)/.test(p)) return;
        pending.add('');
      } else if (SKIP.test(p)) return;
      else if (pending.size < 5000) pending.add(p);
      else pending.add('');
      armIdle();
      clearTimeout(quietTimer);
      quietTimer = setTimeout(onQuiet, QUIET_MS);
    });
    watcher.on('error', watchFailed);
  } catch (e) {
    watchFailed(e);
  }
}

// ---------------------------------------------------------------- events (long polling; works where WebSockets get blocked)
let seq = 0;
const events = [];
const waiters = new Set();
// Watch mode starts once events can be sent: it says so if it can't start.
await watch();
/**
 * A run finished or changed: a state event that also carries the run and its files as the map shows them now
 * (null for one no longer on it), so an app that asks for deltas updates without fetching the whole state.
 */
function emitRun(run) {
  const shown = new Set(listFiles());
  const files = Object.fromEntries(run.changes.map(c => [c.path, shown.has(c.path) ? treeEntry(c.path) : null]));
  emit('state', undefined, { run: publicRun(run), files, active: active?.run.id ?? null });
}
function emit(type, run, delta) {
  events.push({
    seq: ++seq,
    type,
    ...(delta ? { delta } : {}),
    run: run
      ? {
          id: run.id,
          status: run.status,
          stream: (run.stream || []).slice(-60),
          summary: run.summary,
          sessionId: run.sessionId,
          checks: run.checks,
          checksRunning: !!run.checksRunning,
          cost: run.cost,
          turn: run.turn,
        }
      : undefined,
  });
  if (events.length > 500) events.splice(0, events.length - 500);
  for (const w of waiters) w();
  waiters.clear();
}

// ---------------------------------------------------------------- http
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
const OWN_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
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

const server = http.createServer(async (req, res) => {
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
      startAgent(run, read);
      return send(res, 200, publicRun(run), cors);
    }
    const m = p.match(/^\/api\/runs\/(\d+)\/(cancel|keep|revert)$/);
    if (req.method === 'POST' && m) {
      const run = runs.get(+m[1]);
      if (!run) return send(res, 404, { error: 'No such run' }, cors);
      const b = await readBody(req);
      if (m[2] === 'cancel') {
        if (active?.run === run) {
          run.status = 'cancelled';
          if (active.cancel) active.cancel();
          else if (active.child) active.child.kill('SIGTERM');
          else await finishRun(run, 'cancelled');
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
        repoChecks = [];
        checksShared = true;
        emit('state');
        return send(res, 200, { checks: CONF.checks }, cors);
      }
      const chosen = detectChecks().filter(c => names.has(c.name));
      if (!chosen.length || CONF.checks?.length) return send(res, 400, { error: 'No such checks to turn on' }, cors);
      if (b.share) {
        if (active) return send(res, 409, { error: 'Wait for the run to finish', code: 'wait-for-run' }, cors);
        await writeConfig({ ...readJson(CONFIG_FILE, {}), checks: chosen });
        saveAllowed({ approved: chosen });
        checksShared = true;
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
        checksShared = !!CONF.checks.length;
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
});
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
      `The web app is not built. Run: npm --prefix "${path.join(path.dirname(SELF), '..', 'web')}" run build`,
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

// A run the bridge stopped during (a crash, a restart) is closed as interrupted, with the changes made so far:
// everything between its before snapshot and the tree as it is now.
for (const r of runs.values())
  if (r.status === 'running') {
    r.after = base.commit;
    await finishRun(r, 'interrupted');
  }
// Stopping the bridge mid-run closes the run the same way; an agent it started is stopped first.
for (const sig of ['SIGTERM', 'SIGINT'])
  process.on(sig, async () => {
    const run = active?.run;
    if (run) {
      run.status = 'interrupted';
      if (active.child) active.child.kill('SIGTERM');
      else await finishRun(run, 'interrupted').catch(logError);
      for (const t0 = Date.now(); active && Date.now() - t0 < 5000;) await new Promise(r => setTimeout(r, 50));
    }
    process.exit(0);
  });

server.listen(PORT, '127.0.0.1', () => checkClaude(listening));
for (const [id, a] of Object.entries(ACP))
  if (a.check && onPath(a.check[0]))
    execFile(a.check[0], a.check.slice(1), { cwd: ROOT, timeout: 60000 }, e => {
      AGENTS[id].available = !e;
      if (!e) emit('state');
    });
setInterval(() => AGENTS.claude.problem && checkClaude(), CLAUDE_RECHECK_MS).unref();
function listening() {
  const local = linkOf({ port: PORT, token: TOKEN });
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
      `  or      ${WEB_URL}${APP_PATH}#bridge=${PORT}&t=${TOKEN}   (Chrome or Edge, allow local network access)`,
    );
  console.log('');
}
server.on('error', (/** @type {NodeJS.ErrnoException} */ e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is busy. Use --port <n>.` : e.message);
  process.exit(1);
});

// ---------------------------------------------------------------- hook implementations
async function runHook(kind, agent = 'claude') {
  let input = '';
  for await (const d of process.stdin) input += d;
  let data = {};
  try {
    data = JSON.parse(input || '{}');
  } catch {}
  // Cursor also runs Claude Code's hook files; its payload says it is Cursor's.
  if (data.cursor_version) agent = 'cursor';
  const cwd = data.cwd || data.workspace_roots?.[0] || process.cwd();
  if (kind === 'pre') {
    const scopeFile = process.env.LOA_SCOPE_FILE;
    if (!scopeFile || !fs.existsSync(scopeFile)) process.exit(0);
    const { scope, ranges } = JSON.parse(fs.readFileSync(scopeFile, 'utf8'));
    if (!scope.length) process.exit(0);
    const input = data.tool_input || {};
    const f = input.file_path || input.notebook_path;
    if (!f) process.exit(0);
    let root = cwd;
    try {
      root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
    } catch {}
    // Real paths on both sides: the repo may sit behind a symlink (macOS's /tmp is /private/tmp).
    const real = p => {
      try {
        return fs.realpathSync(p);
      } catch {
        return path.join(real(path.dirname(p)), path.basename(p));
      }
    };
    const rel = path
      .relative(real(root), real(path.resolve(cwd, f)))
      .split(path.sep)
      .join('/');
    const block = why => {
      process.stderr.write(`League of Agents scope lock: ${why}`);
      process.exit(2);
    };
    if (!inScope(scope, rel)) block(`${rel} is outside the selected scope. Only edit: ${scope.join(', ')}`);
    const range = ranges[rel];
    if (range) {
      // The file as this edit would leave it, held against the file as the run found it.
      let text = fs.existsSync(path.resolve(cwd, f)) ? fs.readFileSync(path.resolve(cwd, f), 'utf8') : '';
      const edits = input.edits || (input.old_string !== undefined ? [input] : []);
      if (input.content !== undefined) text = input.content;
      for (const e of edits)
        text = e.replace_all
          ? text.split(e.old_string).join(e.new_string)
          : text.replace(e.old_string, () => e.new_string);
      if (!rangeKept(splitLines(range.before), splitLines(text), range))
        block(
          `this edit changes ${rel} outside lines ${range.from}–${range.to}. Only edit those lines; keep every other line as it is.`,
        );
    }
    process.exit(0);
  }
  // Cursor reads an answer from every hook; its run goes on either way.
  const done = () => {
    if (agent === 'cursor') process.stdout.write(kind === 'start' ? '{"continue":true}\n' : '{}\n');
    process.exit(0);
  };
  if (process.env.LOA_MANAGED) done();
  // Claude Code also sends its own notices (a background task finishing) as prompts: they are not the person's.
  if (kind === 'start' && /^\s*<task-notification>/.test(data.prompt || '')) done();
  const repos = agent === 'cursor' ? cursorRepos(data, kind) : [repoOf(cwd)].filter(Boolean);
  const sessionId = data.session_id ?? data.conversation_id ?? null;
  // Each agent's payload, as a run: the prompt and session at the start; the reply and outcome at the end.
  const body =
    kind === 'start'
      ? { agent: HOOK_AGENT[agent], prompt: data.prompt, sessionId }
      : {
          sessionId,
          ...(agent === 'codex'
            ? { summary: data.last_assistant_message || '' }
            : agent === 'cursor'
              ? { summary: '', status: data.status }
              : lastTurn(data.transcript_path)),
        };
  await Promise.all(
    repos.map(async root => {
      const b = liveBridge(root);
      if (!b) return;
      try {
        await fetch(`http://127.0.0.1:${b.port}/api/capture/${kind === 'start' ? 'start' : 'stop'}`, {
          method: 'POST',
          headers: { authorization: 'Bearer ' + b.token, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(kind === 'stop' ? 60000 : 3000),
        });
      } catch {}
    }),
  );
  done();
}

/** The git repo a folder is in, or null. */
function repoOf(dir) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

/** A repo's bridge, if one is running there. */
function liveBridge(root) {
  const b = readJson(path.join(root, '.loa', 'bridge.json'), null);
  if (!b?.token || !b.pid) return null;
  try {
    process.kill(b.pid, 0);
    return b;
  } catch {
    return null;
  }
}

/**
 * The repos a Cursor turn belongs to. Cursor's workspace may be the repo, or a folder holding it: each
 * workspace root counts if it is in a repo, and otherwise each folder directly in it that has a running
 * bridge. Files attached to the prompt narrow it down. A prompt records only when one repo is left; watch
 * mode still sees the change otherwise. A stop goes to all of them: each bridge closes only the run of the
 * same conversation.
 */
function cursorRepos(data, kind) {
  const live = roots => [...new Set(roots.filter(Boolean))].filter(liveBridge);
  const inWorkspace = live(
    (data.workspace_roots || []).flatMap(w => {
      const r = repoOf(w);
      if (r) return [r];
      try {
        return fs
          .readdirSync(w, { withFileTypes: true })
          .filter(e => e.isDirectory() && fs.existsSync(path.join(w, e.name, '.loa', 'bridge.json')))
          .map(e => path.join(w, e.name));
      } catch {
        return [];
      }
    }),
  );
  const attached = live(
    (data.attachments || []).map(a => {
      const f = a?.filePath || a?.file_path;
      return f && repoOf(path.dirname(f));
    }),
  );
  if (kind !== 'start') return [...new Set([...inWorkspace, ...attached])];
  const pick = attached.length ? attached : inWorkspace;
  return pick.length === 1 ? pick : [];
}

/**
 * The turn that just ended in a terminal session, read from Claude Code's transcript: the messages after
 * the last prompt, in stream-json shape, and the final reply as the summary. Successful tool output is
 * dropped to keep the request small; failed results are kept so blocks and denials show in the activity.
 */
function lastTurn(transcriptPath) {
  let lines = [];
  try {
    lines = fs
      .readFileSync(transcriptPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l))
      .filter(m => (m.type === 'user' || m.type === 'assistant') && !m.isSidechain && m.message);
  } catch {
    return { summary: '' };
  }
  const isPrompt = m =>
    m.type === 'user' &&
    (typeof m.message.content === 'string' || m.message.content.every(c => c.type !== 'tool_result'));
  let start = lines.length - 1;
  while (start >= 0 && !isPrompt(lines[start])) start--;
  const turn = lines.slice(start + 1);
  const events = turn
    .map(m =>
      m.type === 'assistant'
        ? { type: 'assistant', message: { content: m.message.content, model: m.message.model } }
        : {
            type: 'user',
            message: {
              content: Array.isArray(m.message.content) ? m.message.content.filter(c => c.is_error) : [],
            },
          },
    )
    // The last 200 for the stream; every edit-tool call, which attribution reads, however long the turn.
    .filter(
      (e, i, all) =>
        i >= all.length - 200 ||
        (e.type === 'assistant' && e.message.content.some?.(c => /^(Edit|Write|MultiEdit)$/.test(c.name))),
    );
  const last = [...turn]
    .reverse()
    .find(m => m.type === 'assistant' && m.message.content.some?.(c => c.type === 'text'));
  const summary = last
    ? last.message.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n')
        .trim()
    : '';
  return { summary, events };
}
