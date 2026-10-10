// Temp git repos and bridge processes for the live tests.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP } from './targets';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');
export const BRIDGE = path.join(REPO_ROOT, 'bridge/loa.mjs');
export const FAKE_CLAUDE = path.join(REPO_ROOT, 'tests/fixtures/fake-claude.mjs');
export const FAKE_CODEX = path.join(REPO_ROOT, 'tests/fixtures/fake-codex.mjs');
export const FAKE_ACP = path.join(REPO_ROOT, 'tests/fixtures/fake-acp.mjs');
export const REPLAY_AGENT = path.join(REPO_ROOT, 'tests/fixtures/replay-agent.mjs');
export const AGENT_FIXTURES = path.join(REPO_ROOT, 'tests/fixtures/agents/claude');
export const SLOW_AGENT = path.join(here, 'slow-agent.mjs');
export const PROBE_AGENT = path.join(here, 'probe-agent.mjs');

/** Files seeded into every temp repo. allowlist.ts holds the exact line fake-claude.mjs rewrites. */
export const SEED: Record<string, string> = {
  'shared/allowlist.ts': [
    'export type Policy = { origins: string[]; actions: string[] };',
    '',
    'export function loadPolicy(): Policy {',
    "  return { origins: ['https://console.example.test'], actions: ['read', 'submit'] };",
    '}',
    '',
    'export function assertAllowed(p: Policy, action: string, origin: string) {',
    '  if (!p.origins.includes(origin) || !p.actions.includes(action)) {',
    "    throw new Error('ALLOWLIST_VIOLATION');",
    '  }',
    '}',
    '',
  ].join('\n'),
  'shared/log.ts': 'export const log = (msg: string) => console.log(`[console] ${msg}`);\n',
  'apps/console/main.ts':
    "import { assertAllowed, loadPolicy } from '../../shared/allowlist';\nimport { log } from '../../shared/log';\n\nassertAllowed(loadPolicy(), 'read', 'https://console.example.test');\nlog('ready');\n",
  'loa.config.json':
    JSON.stringify({ checks: [{ name: 'tests', run: 'node -e "console.log(\'3 passed\')"' }] }, null, 2) + '\n',
};

export const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });

/** Where the bridge keeps the checks the person allowed for a repo: in their home folder (bridge CHECKS_FILE). */
export const allowedChecksFile = (repo: string) =>
  path.join(
    homeOf(repo),
    '.config/league-of-agents/repos',
    crypto.createHash('sha256').update(fs.realpathSync(repo)).digest('hex').slice(0, 32) + '.json',
  );

/**
 * Approves the repo's committed checks, as the person does once in the Checks panel; the bridge runs a repo's
 * loa.config.json only after that. "a cloned repo's checks wait for approval" tests the panel.
 */
export function approveChecks(repo: string) {
  const { checks } = JSON.parse(fs.readFileSync(path.join(repo, 'loa.config.json'), 'utf8')) as {
    checks: { name: string; run: string }[];
  };
  fs.mkdirSync(path.dirname(allowedChecksFile(repo)), { recursive: true });
  fs.writeFileSync(allowedChecksFile(repo), JSON.stringify({ private: [], approved: checks }));
}

/** A fresh repo named `sample-repo` on branch main, seeded and committed, its checks approved. */
export function makeRepo(): string {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loa-e2e-')), 'sample-repo');
  for (const [p, text] of Object.entries(SEED)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), text);
  }
  git(dir, 'init', '-q', '-b', 'main');
  // Who commits, as in any real repo: commits and notes need it, and a CI machine has none.
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'user.email', 'test@example.test');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'seed');
  approveChecks(dir);
  return dir;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      const p = typeof a === 'object' && a ? a.port : 0;
      s.close(() => resolve(p));
    });
  });
}

/** The home folder a test bridge sees, next to its repo, so Cursor's user-level hooks never touch the real one. */
export const homeOf = (repo: string) => path.join(path.dirname(repo), 'home');

/**
 * The bridge of a published release, installed once into test-results/bridges/<version>: the app must keep
 * working with bridges people already run.
 */
export function publishedBridge(version: string): string {
  const dir = path.join(REPO_ROOT, 'web/test-results/bridges', version);
  const file = path.join(dir, 'node_modules/leagueofagents-cli/bridge/loa.mjs');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('npm', ['install', '--prefix', dir, '--no-audit', '--no-fund', `leagueofagents-cli@${version}`], {
      stdio: 'ignore',
    });
  }
  return file;
}

export interface Bridge {
  port: number;
  token: string;
  repo: string;
  proc: ChildProcess;
  /** Everything the bridge printed so far. */
  output(): string;
  stop(): void;
}

/** The bridges a test started, for its failure to show what they printed (startedBridges). */
const started: Bridge[] = [];
/** The bridges started since last asked, and forgotten: what a failed test reports. */
export const startedBridges = () => started.splice(0);

export async function startBridge(
  repo: string,
  agentBin = FAKE_CLAUDE,
  env: Record<string, string> = {},
  args: string[] = [],
  bridge = BRIDGE,
): Promise<Bridge> {
  // A given --port is kept, to bring a bridge back where it was.
  const given = args.indexOf('--port');
  const port = given >= 0 ? Number(args[given + 1]) : await freePort();
  // Tests consent to hooks unless they say otherwise; a real bridge asks first.
  const consent = args.includes('--no-hooks') || args.includes('--ask') ? [] : ['--hooks'];
  // In the foreground (serve), so the test owns the process; users run it in the background (start).
  const proc = spawn(
    process.execPath,
    [bridge, 'serve', ...(given >= 0 ? [] : ['--port', String(port)]), ...consent, ...args.filter(a => a !== '--ask')],
    {
      cwd: repo,
      // The test app (APP) stands in for the hosted app, the one other origin the bridge accepts.
      env: { ...process.env, HOME: homeOf(repo), LOA_WEB_URL: APP, LOA_CLAUDE_BIN: agentBin, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    },
  );
  let out = '';
  proc.stdout!.on('data', d => {
    out += d;
  });
  proc.stderr!.on('data', d => {
    out += d;
  });
  const t0 = Date.now();
  while (!out.includes('Open')) {
    if (proc.exitCode !== null || Date.now() - t0 > 10_000) throw new Error('bridge did not start:\n' + out);
    await new Promise(r => setTimeout(r, 50));
  }
  const { token } = JSON.parse(fs.readFileSync(path.join(repo, '.loa/bridge.json'), 'utf8')) as { token: string };
  const b: Bridge = {
    port,
    token,
    repo,
    proc,
    output: () => out,
    stop: () => {
      try {
        process.kill(-proc.pid!, 'SIGTERM');
      } catch {
        /* already gone */
      }
    },
  };
  started.push(b);
  return b;
}

/**
 * A link's one-time code, asked of the bridge with its own token, as the command line asks. A published bridge
 * before 0.2.0 has no codes: its links carry its token.
 */
export function codeFor(b: Bridge): string {
  const ask = `fetch('http://127.0.0.1:${b.port}/api/link',{method:'POST',headers:{authorization:'Bearer ${b.token}'}}).then(r=>r.json()).then(j=>process.stdout.write(j.code??''))`;
  return execFileSync(process.execPath, ['-e', ask], { encoding: 'utf8' }) || b.token;
}
/** A fresh link to the bridge's own app, good for one use. */
export const linkFor = (b: Bridge, app = '/') => `http://127.0.0.1:${b.port}${app}#t=${codeFor(b)}`;

/** Calls the bridge's API as the app does: GET, or POST with a JSON body. */
export async function call(b: Bridge, route: string, body?: object) {
  const res = await fetch(`http://127.0.0.1:${b.port}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: 'Bearer ' + b.token, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
