// Committing one session's files, and only when the person clicks Commit: the bridge never commits or stages on its
// own. The commit is built in an index of its own from HEAD plus the session's files as the session left them, so
// nothing else the person has staged or changed goes in, and committed by git itself, so the person's hooks and
// signing apply. In the person's own index, only the committed files' entries change, to what was committed, so they
// show clean and everything else staged stays exactly as it was.
import fs from 'node:fs';
import path from 'node:path';
import { refused, serial } from './util.mjs';
import { LOA, gitAsync } from './repo.mjs';
import { blobAt, blobNow, headNow } from './snapshots.mjs';
import { emitRun } from './events.mjs';
import { saveRun } from './runs.mjs';

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
  for (const { path: p } of [...run.changes, ...(run.unseen ?? [])]) {
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
    // Committed by git itself, from an index of its own: the person's hooks run (pre-commit sees only these files
    // staged; commit-msg may change the message) and signing is as they set it. A failing hook stops the commit.
    const index = path.join(LOA, 'commit.index');
    const env = { ...process.env, GIT_INDEX_FILE: index };
    await gitAsync(head.commit ? ['read-tree', head.commit] : ['read-tree', '--empty'], { env });
    await setEntries(env);
    if ((await headNow()).commit !== head.commit) throw refused('head-moved', 'HEAD moved. Try again.');
    try {
      await gitAsync(['commit', '-q', '-F', '-'], { env, input: message });
    } catch (e) {
      const output = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim();
      // A hook that refused, or git itself (no name and email set, say): its own words.
      throw refused('git-refused', `Git refused the commit: ${output}`, { output });
    } finally {
      fs.rmSync(index, { force: true });
    }
    const sha = (await gitAsync(['rev-parse', 'HEAD'])).trim();
    // In the person's index, only the committed files change, to what was committed (a hook may have reformatted
    // one): they show clean, and everything else staged stays as it was.
    entries.length = 0;
    for (const p of chosen) {
      const line = (await gitAsync(['ls-tree', sha, '--', p])).trim();
      entries.push([p, line ? line.split(/\s+/).slice(0, 3) : null]);
    }
    await setEntries(process.env);
    run.committed = { sha, at: Date.now(), files: chosen };
    saveRun(run);
    emitRun(run);
    return run.committed;
  });
}
