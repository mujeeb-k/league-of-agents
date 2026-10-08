// The agents' own hook files: our entries, installed only with consent, and removed leaving each file as it was.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { BRIDGE_DIR } from './paths.mjs';
import { readJson } from './util.mjs';
import { ROOT, LOA, excludeFromGit, git } from './repo.mjs';

// Each agent's own hook file gets entries that run a copy of this bridge (.loa/bridge.mjs). Hooks that aren't
// ours are never changed; removing ours puts each file back exactly as it was, or deletes a file we created.
// Cursor reads project hooks only from the folder opened as its workspace, which is often a parent of the
// repo, so its hooks go in the user's own Cursor settings; the hook then finds the repo itself (runHook).
export const hookFiles = () => ({
  claude: path.join(ROOT, '.claude/settings.local.json'),
  codex: path.join(ROOT, '.codex/hooks.json'),
  cursor: path.join(os.homedir(), '.cursor/hooks.json'),
});
/** A hook file as people know it: relative inside the repo, from ~ outside it. */
export const shown = p => (p.startsWith(ROOT + path.sep) ? path.relative(ROOT, p) : p.replace(os.homedir(), '~'));
const isOurs = command => /(loa\.mjs|\.loa[\\/]bridge\.mjs)" hook /.test(String(command));
const backupFile = () => path.join(LOA, 'hooks-backup.json');
/** The original of each hook file, by absolute path (older backups keyed them relative to the repo). */
const readBackup = () =>
  Object.fromEntries(Object.entries(readJson(backupFile(), {})).map(([p, v]) => [path.resolve(ROOT, p), v]));
/** What the hooks run: a one-line file that loads the bridge's copy in .loa (copyForHooks). */
export const hookFile = () => path.join(LOA, 'bridge.mjs');
/**
 * Hooks, ours and the Claude Code plugin's, run a copy of the bridge inside the repo, so they keep working when the
 * bridge was started from a temporary place (npx's cache) that may later be cleared. Each copy is a folder named by
 * its contents, and .loa/bridge.mjs is switched to it by a rename: a hook starting meanwhile loads the old copy or the
 * new one, never half of one. Copies over a day old go; a hook still running from one has long since loaded it.
 */
export function copyForHooks() {
  const lib = /** @type {string[]} */ (fs.readdirSync(path.join(BRIDGE_DIR, 'lib'), { recursive: true }));
  const files = ['loa.mjs', ...lib.filter(f => f.endsWith('.mjs')).map(f => `lib/${f}`)];
  const hash = crypto.createHash('sha256');
  for (const f of files) hash.update(f).update(fs.readFileSync(path.join(BRIDGE_DIR, f)));
  const dir = `b-${hash.digest('hex').slice(0, 12)}`,
    target = path.join(LOA, dir);
  if (!fs.existsSync(target)) {
    const tmp = `${target}.${process.pid}.tmp`;
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
      fs.copyFileSync(path.join(BRIDGE_DIR, f), path.join(tmp, f));
    }
    fs.renameSync(tmp, target);
  }
  fs.writeFileSync(`${hookFile()}.tmp`, `import './${dir}/loa.mjs';\n`);
  fs.renameSync(`${hookFile()}.tmp`, hookFile());
  for (const old of fs.readdirSync(LOA))
    if (/^b-[0-9a-f]{12}$/.test(old) && old !== dir && Date.now() - fs.statSync(path.join(LOA, old)).mtimeMs > 864e5)
      fs.rmSync(path.join(LOA, old), { recursive: true, force: true });
}

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

export function installHooks() {
  const cmd = sub => `"${process.execPath}" "${hookFile()}" hook ${sub}`;
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
  fs.writeFileSync(backupFile(), JSON.stringify(backup));
}

/** Takes our hooks out. A file untouched since is restored byte for byte; returns the files changed. */
export function removeHooks() {
  const backup = readBackup();
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
    if (JSON.stringify(stripped) === JSON.stringify(json) && !(p in backup)) continue;
    // Cursor's hooks are shared by every repo; the latest to install them owns them, and only it removes them.
    if (!p.startsWith(ROOT + path.sep) && !JSON.stringify(json).includes(JSON.stringify(hookFile()).slice(1, -1)))
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
  fs.rmSync(backupFile(), { force: true });
  return changed;
}
