// The commands run from a terminal: start (in the background), stop, status, uninstall and hooks remove.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline/promises';
import { spawn, execFileSync } from 'node:child_process';
import { ENTRY } from './paths.mjs';
import { readJson } from './util.mjs';
import { argv, SITE, WEB_URL, APP_PATH } from './args.mjs';
import { ROOT, LOA, bridgeFile, EXCLUDED, excludeFile, git } from './repo.mjs';
import { CHECKS_FILE } from './checks.mjs';
import { CLAUDE_FIX, claudeProblemNow } from './agents/claude.mjs';
import { hookFiles, shown, removeHooks } from './hooks-install.mjs';

// The bridge runs in the background, in its own process group, so it outlives the terminal or the agent
// session that started it. .loa/bridge.json holds its port, token and process id.
export const linkOf = b => `http://127.0.0.1:${b.port}${APP_PATH}#t=${b.token}`;
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
export async function running() {
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
export async function startInBackground(hooks) {
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
  const child = spawn(process.execPath, [ENTRY, 'serve', ...pass, hooks ? '--hooks' : '--no-hooks'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, LOA_MANAGED: '' },
  });
  child.unref();
  // A first start reads the whole repository: seconds for a large one. Waited for while the bridge runs, and said so.
  let told = false;
  for (const t0 = Date.now(); Date.now() - t0 < 600000; await new Promise(r => setTimeout(r, 100))) {
    const b = await running();
    if (b?.pid === child.pid) open(b);
    if (child.exitCode !== null) break;
    if (!told && Date.now() - t0 > 2000) {
      told = true;
      console.log(`  Reading ${path.basename(ROOT)}. A large repository takes a few seconds.`);
    }
  }
  console.error(fs.readFileSync(path.join(LOA, 'bridge.log'), 'utf8').trim() || "The bridge didn't start.");
  process.exit(1);
}
export async function stopBridge(exit = true) {
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
export async function bridgeStatus() {
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

export async function askForHooks() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `\n  Add hooks so prompts you send in Claude Code, Codex and Cursor become runs here, titled by the prompt?\n` +
      `  They go in ${Object.values(hookFiles()).map(shown).join(', ')}. Your own hooks are kept.\n` +
      `  Remove them any time: npx leagueofagents-cli@latest hooks remove\n  Add hooks? [Y/n] `,
  );
  rl.close();
  return !/^\s*n/i.test(answer);
}

/**
 * Leaves the repo as if the bridge had never run: stops it, then removes our hooks, the snapshot refs, the
 * lines we added to .git/info/exclude, and .loa/. Says what it removed.
 */
export async function uninstall() {
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
/** `hooks remove`: a running bridge takes them out itself, so its watch mode doesn't record the change as a run. */
export async function removeHooksCommand() {
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
