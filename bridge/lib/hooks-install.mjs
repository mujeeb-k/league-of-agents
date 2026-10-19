// The agents' own hook files: the bridge's entries, installed only with consent, and removed leaving each file as it was.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { BRIDGE_DIR } from './paths.mjs';
import { loaOf, readJson } from './util.mjs';
import { ROOT, LOA, excludeFromGit, git } from './repo.mjs';

// Each agent's own hook file gets entries that run a copy of this bridge. Hooks that aren't the bridge's are never
// changed; removing the bridge's puts each file back exactly as it was, or deletes a file it created. They are
// installed while a bridge runs and taken out when it stops.
// The repo's own hook files run the copy in League of Agents' folder for the repo (loaOf). Cursor reads project
// hooks only from the folder opened as its workspace, which is often a parent of the repo, so its hooks go in the
// user's own Cursor settings, shared by every repo: those run a copy in League of Agents' own settings folder, never
// one inside a repo that may be deleted, and the hook finds the repo itself (runHook).
export const hookFiles = () => ({
  claude: path.join(ROOT, '.claude/settings.local.json'),
  codex: path.join(ROOT, '.codex/hooks.json'),
  cursor: path.join(os.homedir(), '.cursor/hooks.json'),
});
/** A hook file as people know it: relative inside the repo, from ~ outside it. */
export const shown = p => (p.startsWith(ROOT + path.sep) ? path.relative(ROOT, p) : p.replace(os.homedir(), '~'));
const OURS = /(loa\.mjs|\.loa[\\/]bridge\.mjs|league-of-agents[\\/](hook|repos[\\/][0-9a-f]+)[\\/]bridge\.mjs)" hook /;
const isOurs = command => OURS.test(String(command));
const backupFile = () => path.join(LOA, 'hooks-backup.json');
/**
 * Whether the repo's Claude Code hook file holds the bridge's check before an edit. Cursor runs that file too (its
 * docs: on by default; seen with Cursor 2026.10.16), so its edits outside a section are refused and asked first.
 */
export function editHookInstalled() {
  try {
    const json = JSON.parse(fs.readFileSync(hookFiles().claude, 'utf8'));
    return (json.hooks?.PreToolUse ?? []).some(e =>
      (e?.hooks ?? []).some(h => isOurs(h?.command) && / hook pre$/.test(String(h.command))),
    );
  } catch {
    return false;
  }
}
/** The original of each hook file, by absolute path (older backups keyed them relative to the repo). */
const readBackup = () =>
  Object.fromEntries(Object.entries(readJson(backupFile(), {})).map(([p, v]) => [path.resolve(ROOT, p), v]));
/** League of Agents' own settings folder, outside every repo, where approved checks are kept too (checks.mjs). */
const userDir = () => path.join(os.homedir(), '.config', 'league-of-agents');
/** What the repo's hooks run: a one-line file that loads the bridge's copy in League of Agents' folder (copyForHooks). */
const hookFile = () => path.join(LOA, 'bridge.mjs');
/** What Cursor's hooks run, shared by every repo: the copy in League of Agents' own folder. */
const userHookFile = () => path.join(userDir(), 'hook', 'bridge.mjs');
/**
 * The bridges running on this computer, a file each, named by its process id and holding its repo and whether its
 * hooks are in: one stopping leaves Cursor's hooks to another, and a session's hook keeps every bridge's key unread
 * (hook.mjs). A file each, so two starting at once never lose one another.
 */
const runningDir = () => path.join(userDir(), 'running');
/** Whether a listed bridge still runs: its process, and its repo's bridge file still naming it. */
const alive = (pid, root) => {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  // Or, for a bridge before this one, the file it kept in the repo.
  return [loaOf(root), path.join(root, '.loa')].some(d => readJson(path.join(d, 'bridge.json'), {}).pid === pid);
};
/** This bridge is running, with its hooks in or not. */
export function markRunning(hooks) {
  fs.mkdirSync(runningDir(), { recursive: true });
  fs.writeFileSync(path.join(runningDir(), String(process.pid)), JSON.stringify({ root: ROOT, hooks }));
}
/** This bridge has stopped. */
export function markStopped() {
  fs.rmSync(path.join(runningDir(), String(process.pid)), { force: true });
}
/**
 * Bridges before this one (0.2.0) ran Cursor's hooks from their repo's own copy and never registered: those whose
 * entries the person's file held, still running, keep the shared hooks in (they run them too). A stopped one's
 * entry is stale, and goes.
 */
function oldBridgesRunning(text) {
  const roots = [...String(text ?? '').matchAll(/"([^"]+?)[\\/]+\.loa[\\/]+bridge\.mjs\\?" hook/g)].map(m => m[1]);
  return [...new Set(roots)].filter(root => {
    if (root === ROOT) return false;
    const pid = readJson(path.join(root, '.loa/bridge.json'), {}).pid;
    return typeof pid === 'number' && alive(pid, root);
  }).length;
}
/** How many other bridges with hooks still run; the files of those that don't go. */
function othersWithHooks() {
  let n = 0;
  for (const f of fs.existsSync(runningDir()) ? fs.readdirSync(runningDir()) : []) {
    const pid = Number(f),
      b = readJson(path.join(runningDir(), f), {});
    if (pid === process.pid) continue;
    if (!alive(pid, String(b.root))) fs.rmSync(path.join(runningDir(), f), { force: true });
    else if (b.hooks) n++;
  }
  return n;
}
/**
 * Hooks, the bridge's and the Claude Code plugin's, run a copy of the bridge in League of Agents' folder for the repo, so
 * they keep working when the bridge was started from a temporary place (npx's cache) that may later be cleared. Each
 * copy is a folder named by its contents, and bridge.mjs there is switched to it by a rename: a hook starting meanwhile loads the old copy or the
 * new one, never half of one. Copies over a day old go; a hook still running from one has long since loaded it.
 */
export function copyForHooks() {
  copyTo(LOA, hookFile());
  // The Claude Code plugin's hooks look for it in the repo, where bridges before this one kept it: one line there
  // loads this copy.
  const shim = path.join(ROOT, '.loa', 'bridge.mjs');
  fs.mkdirSync(path.dirname(shim), { recursive: true, mode: 0o700 });
  excludeFromGit(['.loa/']);
  fs.writeFileSync(`${shim}.tmp`, `import ${JSON.stringify(pathToFileURL(hookFile()).href)};\n`);
  fs.renameSync(`${shim}.tmp`, shim);
  // The copies an earlier version kept there, which the loader no longer names.
  for (const old of fs.readdirSync(path.dirname(shim)))
    if (/^b-[0-9a-f]{12}$/.test(old)) fs.rmSync(path.join(path.dirname(shim), old), { recursive: true, force: true });
}
/** The same copy in a folder of its own, its entry file at `entry`. */
function copyTo(home, entry) {
  fs.mkdirSync(home, { recursive: true });
  const lib = /** @type {string[]} */ (fs.readdirSync(path.join(BRIDGE_DIR, 'lib'), { recursive: true }));
  const files = ['loa.mjs', ...lib.filter(f => f.endsWith('.mjs')).map(f => `lib/${f}`)];
  const hash = crypto.createHash('sha256');
  for (const f of files) hash.update(f).update(fs.readFileSync(path.join(BRIDGE_DIR, f)));
  const dir = `b-${hash.digest('hex').slice(0, 12)}`,
    target = path.join(home, dir);
  if (!fs.existsSync(target)) {
    const tmp = `${target}.${process.pid}.tmp`;
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
      fs.copyFileSync(path.join(BRIDGE_DIR, f), path.join(tmp, f));
    }
    fs.renameSync(tmp, target);
  }
  fs.writeFileSync(`${entry}.tmp`, `import './${dir}/loa.mjs';\n`);
  fs.renameSync(`${entry}.tmp`, entry);
  for (const old of fs.readdirSync(home))
    if (/^b-[0-9a-f]{12}$/.test(old) && old !== dir && Date.now() - fs.statSync(path.join(home, old)).mtimeMs > 864e5)
      fs.rmSync(path.join(home, old), { recursive: true, force: true });
}

/** The hook entries for one agent's file, in that file's own shape. */
function ourEntries(agent, cmd) {
  const command = (type, matcher) => ({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: type }] });
  if (agent === 'claude')
    return {
      // Shell commands too: bracketed, so what one changes is told apart (lib/shell.mjs).
      PreToolUse: [command(cmd('pre'), 'Edit|Write|MultiEdit|NotebookEdit|Bash')],
      PostToolUse: [command(cmd('post'), 'Bash')],
      UserPromptSubmit: [command(cmd('start'))],
      Stop: [command(cmd('stop'))],
      // Stop does not run when the user interrupts a turn; the session ending closes the run instead.
      SessionEnd: [command(cmd('stop'))],
    };
  if (agent === 'codex') return { UserPromptSubmit: [command(cmd('start codex'))], Stop: [command(cmd('stop codex'))] };
  return { beforeSubmitPrompt: [{ command: cmd('start cursor') }], stop: [{ command: cmd('stop cursor') }] };
}

/** A hook file with the bridge's entries taken out, and events or files left empty by that removed too. */
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
/** Whether a hook file holds anything besides the bridge's entries and the keys it adds. */
const hasOwnContent = json =>
  Object.keys(json).some(k => k !== 'hooks' && k !== 'version') || Object.keys(json.hooks || {}).length > 0;

export function installHooks() {
  copyTo(path.dirname(userHookFile()), userHookFile());
  const backup = readBackup();
  for (const [agent, p] of Object.entries(hookFiles())) {
    const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    let json;
    try {
      json = text === null ? {} : JSON.parse(text);
    } catch {
      console.error(`  Left ${shown(p)} as it is: it isn't plain JSON.`);
      continue;
    }
    // A hook file in git is the team's: the bridge's hold this computer's paths, and would show as a change to commit.
    if (p.startsWith(ROOT + path.sep) && git(['ls-files', '--', path.relative(ROOT, p)]).trim()) {
      console.error(`  Left ${shown(p)} as it is: it's in git, and the hooks hold this computer's paths.`);
      continue;
    }
    if (!(p in backup)) backup[p] = { text, dir: fs.existsSync(path.dirname(p)) };
    const next = withoutOurs(json);
    if (agent === 'cursor') next.version ??= 1;
    const runs = agent === 'cursor' ? userHookFile() : hookFile();
    const cmd = sub => `"${process.execPath}" "${runs}" hook ${sub}`;
    for (const [event, entries] of Object.entries(ourEntries(agent, cmd)))
      next.hooks[event] = [...(next.hooks[event] || []), ...entries];
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(next, null, 2) + '\n');
    // A file the bridge created in the repo holds this machine's paths: kept out of git.
    if (text === null && p.startsWith(ROOT + path.sep)) excludeFromGit([path.relative(ROOT, p)]);
  }
  fs.writeFileSync(backupFile(), JSON.stringify(backup));
}

/**
 * Takes the bridge's hooks out. A file untouched since is restored byte for byte; returns the files changed. Cursor's
 * hooks, shared by every repo, stay while another bridge with hooks still runs; with the last one, the copy they run
 * goes too.
 */
export function removeHooks() {
  const backup = readBackup();
  const others = othersWithHooks() + oldBridgesRunning(backup[hookFiles().cursor]?.text);
  const changed = [];
  for (const p of Object.values(hookFiles())) {
    if (!fs.existsSync(p)) continue;
    let json;
    try {
      json = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      continue;
    }
    const stripped = withoutOurs(json);
    // A file holding none of the bridge's hooks is left as it is, unless the bridge put it there.
    if (JSON.stringify(stripped.hooks) === JSON.stringify(json.hooks ?? {}) && !(p in backup)) continue;
    // Cursor's hooks are shared by every repo: left to another bridge still running.
    if (others && !p.startsWith(ROOT + path.sep)) continue;
    const before = backup[p];
    let original = null,
      clean = false;
    try {
      const parsed = before?.text == null ? null : JSON.parse(before.text);
      original = parsed && withoutOurs(parsed);
      // A file that already held another repo's hooks is not put back as it was.
      clean =
        !/(loa\.mjs|\.loa[\\/]+bridge\.mjs|league-of-agents[\\/]+(hook|repos[\\/]+[0-9a-f]+)[\\/]+bridge\.mjs)\\" hook /.test(
          before.text,
        );
    } catch {}
    if (before && before.text === null && !hasOwnContent(stripped)) {
      fs.rmSync(p);
      if (!before.dir && !fs.readdirSync(path.dirname(p)).length) fs.rmdirSync(path.dirname(p));
    } else if (before?.text != null && clean && JSON.stringify(original) === JSON.stringify(stripped))
      fs.writeFileSync(p, before.text);
    else fs.writeFileSync(p, JSON.stringify(stripped, null, 2) + '\n');
    changed.push(shown(p));
  }
  fs.rmSync(backupFile(), { force: true });
  if (!others) fs.rmSync(path.dirname(userHookFile()), { recursive: true, force: true });
  return changed;
}
