// Committing one session's files, and only when the person clicks Commit: the bridge never commits or stages on its
// own. The commit is built in an index of its own from HEAD plus the session's files as the session left them, so
// nothing else the person has staged or changed goes in. HEAD moves only if it is still where it was. In the person's
// own index, only the committed files' entries change, to what was committed, so they show clean and everything else
// staged stays exactly as it was. Git's commit hooks don't run (they belong to `git commit`); signing does.
import fs from 'node:fs';
import path from 'node:path';
import { serial } from './util.mjs';
import { LOA, ROOT, gitAsync } from './repo.mjs';
import { blobAt, headNow } from './snapshots.mjs';
import { emitRun } from './events.mjs';
import { saveRun } from './runs.mjs';

const refused = (reason, message, args = {}) => Object.assign(new Error(message), { code: 409, reason, args });

/** A file's content id as it is on disk now, or null when it is gone. */
async function blobNow(p) {
  if (!fs.existsSync(path.join(ROOT, p))) return null;
  return (await gitAsync(['hash-object', '--', p])).trim();
}

/**
 * What committing the run would hold. `files`: its own. `yours`: files it changed that the person had changed too
 * before it started (left out unless ticked). `changed`: files changed since it ended (nothing commits until they
 * are reviewed again).
 */
export async function commitPreview(run) {
  const head = await headNow();
  const files = [],
    yours = [],
    changed = [];
  for (const { path: p } of run.changes) {
    if ((await blobNow(p)) !== (await blobAt(run.after, p))) changed.push(p);
    if (head.commit && (await blobAt(run.before, p)) !== (await blobAt(head.commit, p))) yours.push(p);
    else files.push(p);
  }
  const branch = head.ref.startsWith('refs/heads/') ? head.ref.slice('refs/heads/'.length) : null;
  return { files, yours, changed, branch };
}

/** Commits the run's files with the person's message, and the files of theirs they ticked. */
export function commitRun(run, { message = '', include = [] } = {}) {
  return serial(async () => {
    if (run.committed) throw refused('already-committed', `Run ${run.id} is already committed.`, { id: run.id });
    if (run.status === 'running' || run.reverted)
      throw refused('not-committable', 'Only a finished run can be committed.');
    if (!message.trim()) throw refused('no-message', 'Write a commit message first.');
    const { files, yours, changed } = await commitPreview(run);
    if (changed.length)
      throw refused('changed-since', `${changed.join(', ')} changed since the run.`, { files: changed.join(', ') });
    const head = await headNow();
    if (!head.ref.startsWith('refs/heads/')) throw refused('detached-head', 'HEAD is detached. Check out a branch.');
    const chosen = [...files, ...yours.filter(p => include.includes(p))];
    if (!chosen.length) throw refused('nothing-to-commit', 'Nothing to commit.');
    // Each file as the run left it, as its tree entry (mode, type, id), or null where the run deleted it.
    /** @type {[string, string[] | null][]} */
    const entries = [];
    for (const p of chosen) {
      const line = (await gitAsync(['ls-tree', run.after, '--', p])).trim();
      entries.push([p, line ? line.split(/\s+/).slice(0, 3) : null]);
    }
    /** Sets each file's entry in an index: the commit's own, or the person's. */
    const setEntries = async env => {
      for (const [p, entry] of entries)
        await (entry
          ? gitAsync(['update-index', '--add', '--cacheinfo', `${entry[0]},${entry[2]},${p}`], { env })
          : gitAsync(['update-index', '--force-remove', '--', p], { env }));
    };
    const index = path.join(LOA, 'commit.index');
    const env = { ...process.env, GIT_INDEX_FILE: index };
    await gitAsync(['read-tree', head.commit], { env });
    await setEntries(env);
    const tree = (await gitAsync(['write-tree'], { env })).trim();
    fs.rmSync(index, { force: true });
    const sign = (await gitAsync(['config', '--type=bool', 'commit.gpgsign']).catch(() => '')).trim() === 'true';
    const sha = (
      await gitAsync(['commit-tree', tree, '-p', head.commit, ...(sign ? ['-S'] : []), '-F', '-'], { input: message })
    ).trim();
    await gitAsync(['update-ref', '-m', `League of Agents: commit run ${run.id}`, head.ref, sha, head.commit]);
    await setEntries(process.env);
    run.committed = { sha, at: Date.now(), files: chosen };
    saveRun(run);
    emitRun(run);
    return run.committed;
  });
}
