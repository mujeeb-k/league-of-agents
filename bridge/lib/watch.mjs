// Watch mode. Changes made outside a run, by any editor or agent, become a run ("Edited main.py") once the files have
// been quiet for a while. The baseline is the working tree as last seen: at start, after every run and
// revert. Ignored files never enter a snapshot, so they never make a run. When HEAD moves (a branch switch,
// pull or commit) the baseline resets and nothing is recorded. During a run, the run's own snapshots
// cover every change, so watch mode stays quiet.
import fs from 'node:fs';
import path from 'node:path';
import { logError, serial } from './util.mjs';
import { HOOK_AGENT } from './hook.mjs';
import { ROOT, CONFIG_FILE, gitAsync } from './repo.mjs';
import { SKIP } from './files.mjs';
import { writeTree, commitTree, headNow, pin, computeChanges, startIndex } from './snapshots.mjs';
import { runs, working, newRun, finishRun } from './runs.mjs';
import { emit } from './events.mjs';

export const QUIET_MS = Number(process.env.LOA_QUIET_MS || 3000);
/**
 * A run started by an agent's hooks ends with its Stop. If that never comes (the agent crashed, or its stop went
 * elsewhere), the run would hold watch mode quiet for good: after this long with no file changes it is closed as
 * interrupted, with its changes.
 */
const HOOK_IDLE_MS = Number(process.env.LOA_HOOK_IDLE_MS || 30 * 60 * 1000);
/** @type {NodeJS.Timeout | undefined} */
let idleTimer;
export function armIdle() {
  clearTimeout(idleTimer);
  const run = [...working.values()].find(r => Object.values(HOOK_AGENT).includes(r.agent));
  if (!run) return;
  idleTimer = setTimeout(() => {
    if (working.has(run.id)) finishRun(run, 'interrupted').catch(logError);
  }, HOOK_IDLE_MS);
}
/** @type {{ head: { commit: string; ref: string }; tree: string; commit: string } | null} */
export let base = null;
export const setBase = b => (base = b);
/** @type {NodeJS.Timeout | undefined} */
let quietTimer;
const pending = new Set();
const sameHead = (a, b) => a.commit === b.commit && a.ref === b.ref;
/** Takes a new baseline; `fresh` restarts the snapshot index from HEAD, as when HEAD moved. */
export async function rebase(fresh = false) {
  const head = await headNow(),
    tree = await writeTree(fresh);
  base = { head, tree, commit: await commitTree(tree, 'baseline', head) };
}
/**
 * Brings the baseline up to date, recording any changes since it as a run. Returns the new baseline.
 * Runs in the serial lane.
 */
export async function settle() {
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
    if (working.size || (await onlyIgnored(paths))) return;
    await settle();
  }).catch(logError);
}
/**
 * A change League of Agents makes to the person's files, outside any run: changes waiting to be recorded are
 * recorded first, then the new baseline takes the change in, so watch mode never records it.
 */
export function ownWrite(write) {
  return serial(async () => {
    await settle();
    const out = write();
    await rebase();
    return out;
  });
}
/** Writes loa.config.json as an own write; a file that would be empty is removed. */
export function writeConfig(file) {
  return ownWrite(() => {
    if (Object.keys(file).length) fs.writeFileSync(CONFIG_FILE, JSON.stringify(file, null, 2) + '\n');
    else fs.rmSync(CONFIG_FILE, { force: true });
  });
}
/** Why watch mode is off, if it is: the app says so, since edits outside a run then go unrecorded. */
export let watchOff = null;
function watchFailed(e) {
  watchOff = e.code === 'ENOSPC' ? 'the system limit on watched folders is reached' : e.message;
  console.error('Watch mode is off: ' + watchOff);
  emit('state');
}
/** Takes the first baseline, then watches. The bridge starts listening only once the baseline exists. */
export async function watch() {
  await serial(async () => {
    await startIndex();
    await rebase();
  });
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
