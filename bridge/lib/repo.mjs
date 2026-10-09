// The repo the bridge runs in: where it is, its config and private folder, and git run there.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { readJson } from './util.mjs';

/** The repo the bridge runs in, set by openRepo before anything else reads it. */
export let ROOT, LOA, RUNS_DIR, CONFIG_FILE, CONF, bridgeFile, LAYOUT_FILE, prev, EXCLUDED;
/**
 * Finds the repo and its .loa/ folder, or says why the bridge can't run here and exits. Reads loa.config.json and the
 * last start's .loa/bridge.json, and keeps .loa/ out of git.
 */
export function openRepo() {
  try {
    ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    console.error('Run this inside a git repository.');
    process.exit(1);
  }
  LOA = path.join(ROOT, '.loa');
  // .loa/ is this machine's own state. A repo that commits it could hand the bridge runs, settings or approvals of
  // its choosing, so the bridge doesn't start on one.
  if (execFileSync('git', ['ls-files', '--', '.loa'], { cwd: ROOT, encoding: 'utf8' }).trim()) {
    console.error(
      'This repo commits .loa/, which League of Agents keeps private to each machine. Take it out of git first:\n' +
        '  git rm -r --cached .loa && git commit -m "Stop tracking .loa"',
    );
    process.exit(1);
  }
  RUNS_DIR = path.join(LOA, 'runs');
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  // .loa/ holds the token (bridge.json, and the links in bridge.log): only this user may open it.
  fs.chmodSync(LOA, 0o700);
  CONFIG_FILE = path.join(ROOT, 'loa.config.json');
  CONF = readJson(CONFIG_FILE, {});
  bridgeFile = path.join(LOA, 'bridge.json');
  /** Where the map's folders and files are placed (web/src/lib/layout.ts SavedLayout). */
  LAYOUT_FILE = path.join(LOA, 'layout.json');
  prev = readJson(bridgeFile, {});
  /** The lines we added to .git/info/exclude, so `uninstall` takes out only those. */
  EXCLUDED = path.join(LOA, 'excluded.json');
  excludeFromGit(['.loa/', '.claude/settings.local.json']);
}
// A fresh token on every start: a link from an earlier run stops working.
export const TOKEN = crypto.randomBytes(18).toString('base64url');
export const excludeFile = () => path.resolve(ROOT, git(['rev-parse', '--git-dir']).trim(), 'info', 'exclude');
export function excludeFromGit(lines) {
  const ex = excludeFile();
  fs.mkdirSync(path.dirname(ex), { recursive: true });
  const cur = fs.existsSync(ex) ? fs.readFileSync(ex, 'utf8') : '';
  const add = lines.filter(l => !cur.split('\n').includes(l));
  if (!add.length) return;
  fs.appendFileSync(ex, (cur.endsWith('\n') || !cur ? '' : '\n') + add.join('\n') + '\n');
  fs.writeFileSync(EXCLUDED, JSON.stringify([...readJson(EXCLUDED, []), ...add]));
}
export function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
}
/**
 * git without blocking the bridge: snapshots, diffs and reverts run while requests are still answered.
 * @param {string[]} args
 * @param {{ input?: string | Buffer } & import('node:child_process').ExecFileOptions} [opts]
 * @returns {Promise<string>}
 */
export function gitAsync(args, { input, ...opts } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts },
      // A failure carries what git printed: a hook's own words, when one refused.
      (e, out, err) =>
        e ? reject(Object.assign(e, { stdout: String(out), stderr: String(err) })) : resolve(String(out)),
    );
    if (input !== undefined) child.stdin.end(input);
  });
}
