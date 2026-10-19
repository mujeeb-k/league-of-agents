// A session's shell commands. Its edit tools name what they change; a shell command names nothing, so the hooks
// bracket each one (lib/hook.mjs): a snapshot before, one after, and what changed between is the command's.
// Inside the session's section it is the session's write (run.wrote), taken out on its revert; none of its lines is
// credited to the agent, which wrote them by no edit step. In the sandbox (sandbox.mjs) nothing outside
// can change by the command, so only the section is looked at. Without one, what changed outside, in no other
// session's section, is put back at once and the agent told; what was there is kept, to restore in one click. The
// window is the whole command: a save of the person's outside every section while it runs is put back too.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { line, refused, sameSecret, serial } from './util.mjs';
import { inScope, scopeEntry } from './scope.mjs';
import { ROOT, storeAsync } from './repo.mjs';
import { blobAt, blobNow, computeChanges, pin, restoreFrom, snapshotNow } from './snapshots.mjs';
import { push, runs, saveRun, working } from './runs.mjs';
import { stepsOf } from './steps.mjs';
import { lockOfRun } from './sandbox.mjs';

/**
 * How a session's hooks reach the bridge: its port, and a token good only for that run's shell route. A session in
 * the sandbox can't read the bridge's own token (its bridge.json), so it can't ask the bridge to write for it.
 */
let port = 0;
export const setShellPort = p => (port = p);
const tokens = new Map();
export function shellAccess(run) {
  if (!tokens.has(run.id)) tokens.set(run.id, crypto.randomBytes(24).toString('hex'));
  return { LOA_BRIDGE_PORT: String(port), LOA_SHELL_TOKEN: tokens.get(run.id) };
}
/** A run ended: its token is good for nothing more. */
export const forgetShell = run => tokens.delete(run.id);
/** Whether a request is a run's hooks calling its own shell or ask route with its token. */
export function shellTokenFits(pathname, token) {
  const id = Number(/^\/api\/runs\/(\d+)\/(shell|ask)$/.exec(pathname)?.[1]);
  const t = tokens.get(id);
  return !!t && sameSecret(token, t);
}

/** When each shell command under way began, and the snapshot then, by run and tool call. */
const before = new Map();
/** What a run's snapshots look at: its section in the sandbox, the whole tree without one. */
const watched = run =>
  lockOfRun(run) === 'sandbox' && run.scope.length ? run.scope.map(s => scopeEntry(s).path) : null;

export function shellStarts(run, tool) {
  return serial(async () => {
    const at = Date.now();
    before.set(`${run.id}:${tool}`, {
      at,
      commit: (await snapshotNow(`run ${run.id} before a shell command`, watched(run))).commit,
    });
  });
}

/** Ends a shell command's bracket: returns the files it changed outside the section, now put back. */
export function shellEnds(run, tool) {
  const key = `${run.id}:${tool}`,
    began = before.get(key);
  before.delete(key);
  if (!began) return Promise.resolve([]);
  const from = began.commit;
  return serial(async () => {
    const sections = watched(run);
    const to = (await snapshotNow(`run ${run.id} after a shell command`, sections)).commit;
    const others = [...working.values()].filter(r => r !== run).flatMap(r => (r.scope?.length ? r.scope : ['/']));
    const undone = [],
      wrote = [];
    // Another session's edit while the command ran, wherever it landed: never the command's to put back.
    const editedMeanwhile = file =>
      [...runs.values()].some(
        r =>
          r !== run &&
          stepsOf(r).some(st => st?.act === 'edit' && st.file === file && !st.refused && (st.end ?? st.at) >= began.at),
      );
    for (const c of await computeChanges(from, to, { unseen: true })) {
      if (!inScope(run.scope, c.path) && !sections && !inScope(others, c.path) && !editedMeanwhile(c.path)) {
        if ((await blobAt(from, c.path)) === null) fs.rmSync(path.join(ROOT, c.path), { force: true });
        else await restoreFrom(from, [c.path]);
        undone.push(c.path);
        continue;
      }
      // What it changed in its own section is the run's write, taken out on its revert (writes.mjs); its lines are its
      // agent's, by a command, where no other writer touched the file meanwhile (lines.mjs). In another session's
      // section it may be that session's at the same moment: left to it.
      if (inScope(run.scope, c.path))
        wrote.push({
          start: began.at,
          at: Date.now(),
          file: c.path,
          from: await blobAt(from, c.path),
          to: await blobAt(to, c.path),
        });
    }
    if (wrote.length) {
      (run.wrote ??= []).push(...wrote);
      saveRun(run);
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
          commit: to,
          put: await blobAt(from, p),
          restored: false,
        });
      saveRun(run);
      push(
        run,
        line('warn', 'put-back', `Put back what a shell command changed outside the section: ${undone.join(', ')}`, {
          files: undone.join(', '),
        }),
      );
    }
    return undone;
  });
}

/**
 * Writes back a file as the last shell command to change it left it, before it was put back; refused if the file
 * changed since it was put back, so nothing written later is lost. Earlier put-backs of the file are done with too.
 */
export function restorePutBack(run, file) {
  const kept = run.putBack?.findLast(k => k.path === file && !k.restored);
  if (!kept) return Promise.resolve(false);
  return serial(async () => {
    const abs = path.join(ROOT, file);
    if ((await blobNow(file)) !== kept.put)
      throw refused('changed-since-put-back', `${file} changed since it was put back.`, { name: file });
    // The store's ref, for a put-back recorded before its commit was.
    const from = kept.commit ?? (await storeAsync(['rev-parse', kept.ref])).trim();
    if ((await blobAt(from, file)) === null) fs.rmSync(abs, { force: true });
    else await restoreFrom(from, [file]);
    for (const k of run.putBack) if (k.path === file) k.restored = true;
    saveRun(run);
    return true;
  });
}
