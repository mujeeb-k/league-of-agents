// A session's shell commands. Its edit tools name what they change; a shell command names nothing, so the hooks
// bracket each one (lib/hook.mjs): a snapshot before, one after, and what changed between is the command's.
// Inside the session's section it is the session's own, line for line. In the sandbox (sandbox.mjs) nothing outside
// can change by the command, so only the section is looked at. Without one, what changed outside, in no other
// session's section, is put back at once and the agent told; what was there is kept, to restore in one click. The
// window is the whole command: a save of the person's outside every section while it runs is put back too.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { refused, sameSecret, serial } from './util.mjs';
import { inScope, scopeEntry } from './scope.mjs';
import { ROOT, gitAsync } from './repo.mjs';
import { blobAt, computeChanges, pin, restoreFrom, snapshotNow } from './snapshots.mjs';
import { noteLines } from './agents/lines.mjs';
import { push, saveRun, working } from './runs.mjs';
import { lockOfRun } from './sandbox.mjs';

/**
 * How a session's hooks reach the bridge: its port, and a token good only for that run's shell route. A session in
 * the sandbox can't read the bridge's own token (.loa/bridge.json), so it can't ask the bridge to write for it.
 */
let port = 0;
export const setShellPort = p => (port = p);
const tokens = new Map();
export function shellAccess(run) {
  if (!tokens.has(run.id)) tokens.set(run.id, crypto.randomBytes(24).toString('hex'));
  return { LOA_BRIDGE_PORT: String(port), LOA_SHELL_TOKEN: tokens.get(run.id) };
}
/** Whether a request is a run's hooks calling its own shell route with its token. */
export function shellTokenFits(pathname, token) {
  const id = Number(/^\/api\/runs\/(\d+)\/shell$/.exec(pathname)?.[1]);
  const t = tokens.get(id);
  return !!t && sameSecret(token, t);
}

/** The snapshot before each shell command under way, by run and tool call. */
const before = new Map();
/** What a run's snapshots look at: its section in the sandbox, the whole tree without one. */
const watched = run => (lockOfRun(run) === 'sandbox' ? run.scope.map(s => scopeEntry(s).path) : null);

export function shellStarts(run, tool) {
  return serial(async () => {
    before.set(`${run.id}:${tool}`, (await snapshotNow(`run ${run.id} before a shell command`, watched(run))).commit);
  });
}

/** Ends a shell command's bracket: returns the files it changed outside the section, now put back. */
export function shellEnds(run, tool) {
  const key = `${run.id}:${tool}`,
    from = before.get(key);
  before.delete(key);
  if (!from) return Promise.resolve([]);
  return serial(async () => {
    const to = (await snapshotNow(`run ${run.id} after a shell command`, watched(run))).commit;
    const others = [...working.values()].filter(r => r !== run).flatMap(r => (r.scope?.length ? r.scope : ['/']));
    const undone = [];
    for (const c of await computeChanges(from, to)) {
      if (inScope(run.scope, c.path))
        noteLines(
          run,
          c.path,
          c.hunks.map(h => h.add.join('\n')),
        );
      else if (!watched(run) && !inScope(others, c.path)) {
        if ((await blobAt(from, c.path)) === null) fs.rmSync(path.join(ROOT, c.path), { force: true });
        else await restoreFrom(from, [c.path]);
        undone.push(c.path);
      }
    }
    if (undone.length) {
      // What the command wrote stays in a snapshot of the run's own, to restore (restorePutBack).
      const n = (run.putBack ??= []).length;
      await pin(run.id, `put-back-${n}`, to);
      // `put`: the file as put back, so a restore can tell whether it changed since.
      for (const p of undone)
        run.putBack.push({
          path: p,
          ref: `refs/loa/runs/${run.id}/put-back-${n}`,
          put: await blobAt(from, p),
          restored: false,
        });
      saveRun(run);
      push(run, { t: 'warn', text: `Put back what a shell command changed outside the section: ${undone.join(', ')}` });
    }
    return undone;
  });
}

/**
 * Writes back a file as the shell command left it, before it was put back; refused if the file changed since it was
 * put back, so nothing written later is lost.
 */
export function restorePutBack(run, file) {
  const kept = run.putBack?.find(k => k.path === file && !k.restored);
  if (!kept) return Promise.resolve(false);
  return serial(async () => {
    const abs = path.join(ROOT, file);
    const now = fs.existsSync(abs) ? (await gitAsync(['hash-object', '--', file])).trim() : null;
    if (now !== kept.put)
      throw refused('changed-since-put-back', `${file} changed since it was put back.`, { name: file });
    if ((await blobAt(kept.ref, file)) === null) fs.rmSync(abs, { force: true });
    else await restoreFrom(kept.ref, [file]);
    kept.restored = true;
    saveRun(run);
    return true;
  });
}
