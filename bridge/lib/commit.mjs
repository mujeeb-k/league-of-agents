// Committing one session's files, and only when the person clicks Commit: the bridge never commits or stages on its
// own. The commit is built in an index of its own from HEAD plus the session's files as the session left them, so
// nothing else the person has staged or changed goes in, and committed by git itself, so the person's hooks and
// signing apply. In the person's own index, only the committed files' entries change, to what was committed, so they
// show clean and everything else staged stays exactly as it was. A hook may commit more than it was handed (a
// formatter's index file, a generated list): those files are named on the run, and are the commit's, not a session's.
// A file another session also wrote goes in with this session's lines only (writes.mjs); while a pre-commit hook
// runs, the working tree holds that version, and the other's lines are put back after. A commit waits until no
// session is working, so nothing is swapped under an agent at work.
import fs from 'node:fs';
import path from 'node:path';
import { logError, readJson, refused, serial } from './util.mjs';
import { LOA, ROOT, gitAsync } from './repo.mjs';
import { blobAt, blobNow, headNow, putBlobs } from './snapshots.mjs';
import { takeOut } from './writes.mjs';
import { emitRun } from './events.mjs';
import { runs, saveRun, working } from './runs.mjs';
import { line } from './util.mjs';

/** Files held at the commit's version while git commits (commitRun), until they are put back. */
const heldFile = () => path.join(LOA, 'held.json');
/** Whether the repo has a pre-commit hook git would run: it may stage files again from the working tree. */
async function preCommitHook() {
  const set = (await gitAsync(['config', '--get', 'core.hooksPath']).catch(() => '')).trim();
  const dir = set
    ? path.resolve(ROOT, set)
    : path.resolve(ROOT, (await gitAsync(['rev-parse', '--git-path', 'hooks'])).trim());
  try {
    fs.accessSync(path.join(dir, 'pre-commit'), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
/**
 * Files a commit held and didn't put back (the bridge stopped, or the put-back failed): each gets the other session's
 * lines back, merged into the file as it is now (a hook may have formatted it); where they no longer fit, the file
 * as it was. The list goes only once that is done. At start, and before a commit holds files again (commitRun).
 */
export async function restoreHeld() {
  const held = readJson(heldFile(), null);
  if (!Array.isArray(held)) return;
  const head = await headNow();
  if (!head.commit) return;
  const back = [];
  for (const [p, was, put] of held) {
    const out = await takeOut([[was, put]], await blobNow(p, true));
    back.push([p, 'blob' in out ? out.blob : was]);
  }
  await putBlobs(back, 'files held by a commit, put back', head.commit);
  fs.rmSync(heldFile(), { force: true });
}
/**
 * Whether anything but other sessions' recorded writes (writes.mjs) changed a file after the run ended: their lines
 * don't go in with the run's commit, so they don't stop it.
 */
async function changedSince(run, p) {
  const after = await blobAt(run.after, p),
    now = await blobNow(p, true);
  if (now === after) return false;
  const others = [...runs.values()]
    .filter(r => r !== run)
    .flatMap(r => r.writes?.[p] ?? [])
    .filter(w => w[2] > run.endedAt)
    .sort((a, b) => a[2] - b[2]);
  const back = await takeOut(others, now);
  return !('blob' in back) || back.blob !== after;
}
/**
 * A file another session wrote too, as the run's commit holds it: the run's own change (writes.mjs), from the file as
 * its writes found it to the file as they left it, applied to the file as HEAD has it. So none of the other session's
 * lines go in, and none already committed come out. Where its lines and the other's touch, they can't be told apart:
 * the whole file goes in, as the run left it (`whole`).
 */
async function ownVersion(run, p) {
  const head = await headNow();
  const after = await blobAt(run.after, p);
  const base = await takeOut(run.writes?.[p] ?? [[await blobAt(run.before, p), after]], after);
  const own =
    'blob' in base ? await takeOut([[after, base.blob]], head.commit ? await blobAt(head.commit, p) : null) : null;
  return own && 'blob' in own ? { blob: own.blob, whole: false } : { blob: after, whole: true };
}
/**
 * What committing the run would hold. `files`: its own. `yours`: files it changed that the person had changed too
 * before it started (left out unless ticked). `shared`: files another session wrote too (left out unless ticked;
 * `include` names the ones that are), committed with this run's lines only; `whole`, those whose lines can't be told
 * apart from the other's, which go in whole. `later`: the shared files changed since it ended by anything but the
 * other session's writes. `changed`: files changed since it ended (nothing commits until they are reviewed again);
 * a shared file left out isn't asked.
 */
export async function commitPreview(run, include = []) {
  const head = await headNow();
  const both = (run.shared ?? []).map(s => s.path);
  const files = [],
    yours = [],
    shared = [],
    whole = [],
    later = [],
    changed = [];
  for (const { path: p } of [...run.changes, ...(run.unseen ?? [])]) {
    const since = await changedSince(run, p);
    if (both.includes(p)) {
      shared.push(p);
      if ((await ownVersion(run, p)).whole) whole.push(p);
      if (since) later.push(p);
      if (since && include.includes(p)) changed.push(p);
      continue;
    }
    if (since) changed.push(p);
    if (head.commit && (await blobAt(run.before, p)) !== (await blobAt(head.commit, p))) yours.push(p);
    else files.push(p);
  }
  const branch = head.ref.startsWith('refs/heads/') ? head.ref.slice('refs/heads/'.length) : null;
  return { files, yours, shared, whole, later, changed, branch };
}

/** Commits the run's files with the person's message, and the files of theirs they ticked. */
export function commitRun(run, { message = '', include = [] } = {}) {
  return serial(async () => {
    if (run.committed) throw refused('already-committed', `Run ${run.id} is already committed.`, { id: run.id });
    if (run.status === 'running' || run.reverted)
      throw refused('not-committable', 'Only a finished run can be committed.');
    if (!message.trim()) throw refused('no-message', 'Write a commit message first.');
    // Nothing is committed under a session at work: Commit waits until none is.
    if (working.size) throw refused('sessions-working', 'Commit waits until no session is working.');
    // An earlier commit's held files not yet put back go back first, before this one reads the files.
    await restoreHeld();
    const { files, yours, shared, changed } = await commitPreview(run, include);
    if (changed.length)
      throw refused('changed-since', `${changed.join(', ')} changed since the run.`, { files: changed.join(', ') });
    const head = await headNow();
    if (!head.ref.startsWith('refs/heads/')) throw refused('detached-head', 'HEAD is detached. Check out a branch.');
    const chosen = [...files, ...[...yours, ...shared].filter(p => include.includes(p))];
    if (!chosen.length) throw refused('nothing-to-commit', 'Nothing to commit.');
    // Each file as the run left it, as its tree entry (mode, type, id), or null where the run deleted it. A shared
    // one without the other session's lines.
    /** @type {[string, string[] | null][]} */
    const entries = [];
    for (const p of chosen) {
      const entry = (await gitAsync(['ls-tree', run.after, '--', p])).trim();
      const fields = entry ? entry.split(/\s+/).slice(0, 3) : null;
      // Its own lines only, where another session wrote the file too (shared, or its writes kept: parallel.mjs).
      const own = shared.includes(p) || run.writes?.[p] ? (await ownVersion(run, p)).blob : undefined;
      if (own === null) entries.push([p, null]);
      else if (own) entries.push([p, [fields?.[0] ?? '100644', 'blob', own]]);
      else entries.push([p, fields]);
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
    // A file may hold another session's lines too. While git commits, with a pre-commit hook to run, it holds the
    // commit's version, so a hook that formats files and stages them again from the working tree stages that; the
    // other's lines go back after. What is held is written down first, so a bridge stopped meanwhile puts it back
    // when it starts (restoreHeld).
    /** @type {[string, string | null, string][]} */
    const held = [];
    if (await preCommitHook())
      for (const [p, entry] of entries)
        if (entry) {
          const now = await blobNow(p, true);
          if (now !== entry[2]) held.push([p, now, entry[2]]);
        }
    if (held.length) {
      fs.writeFileSync(heldFile(), JSON.stringify(held));
      await putBlobs(
        held.map(([p, , put]) => [p, put]),
        `run ${run.id} committing`,
        run.after,
      );
    }
    let made = false;
    /** Held files something else wrote while the commit held them. */
    const touched = [];
    try {
      await gitAsync(['commit', '-q', '-F', '-'], { env, input: message });
      made = true;
      // A held file is as the bridge put it, or as a pre-commit hook made it and committed it. Anything else wrote
      // it meanwhile (an editor, an agent in a terminal): the commit is taken back, so nothing is committed under it.
      if (held.length) {
        const sha = (await gitAsync(['rev-parse', 'HEAD'])).trim();
        for (const [p, , put] of held) {
          const now = await blobNow(p, true);
          if (now !== put && now !== (await blobAt(sha, p))) touched.push(p);
        }
        if (touched.length) {
          await (head.commit
            ? gitAsync(['update-ref', head.ref, head.commit, sha])
            : gitAsync(['update-ref', '-d', head.ref, sha]));
          made = false;
        }
      }
    } catch (e) {
      const output = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim();
      // A hook that refused, or git itself (no name and email set, say): its own words.
      throw refused('git-refused', `Git refused the commit: ${output}`, { output });
    } finally {
      fs.rmSync(index, { force: true });
      // Each held file as it was before the swap, or, committed, as the commit left it (a hook may have formatted it)
      // with the other session's lines put back in. What something else wrote meanwhile stays on top; where it can't
      // be kept apart from the swap, the file goes back exactly as it was, and that other version is kept in
      // .loa/interrupted/ for the person. A failure here leaves the list for the next start.
      if (held.length)
        try {
          const back = [];
          for (const [p, was, put] of held) {
            const now = await blobNow(p, true);
            const out = made || touched.includes(p) ? await takeOut([[was, put]], now) : { blob: was };
            if (!('blob' in out) && touched.includes(p)) {
              const keep = path.join(LOA, 'interrupted', p);
              fs.mkdirSync(path.dirname(keep), { recursive: true });
              fs.copyFileSync(path.join(ROOT, p), keep);
            }
            back.push([p, 'blob' in out ? out.blob : was]);
          }
          await putBlobs(back, `run ${run.id} ${made ? 'committed' : 'not committed'}`, run.after);
          fs.rmSync(heldFile(), { force: true });
        } catch (e) {
          logError(e);
        }
    }
    if (touched.length)
      throw refused(
        'commit-interrupted',
        `${touched.join(', ')} changed while the commit held it. Nothing was committed, and every file is back.`,
        { files: touched.join(', ') },
      );
    const sha = (await gitAsync(['rev-parse', 'HEAD'])).trim();
    // What git committed: the chosen files, and any file a hook staged besides them.
    const committed = (await gitAsync(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', sha]))
      .split('\0')
      .filter(Boolean);
    const hook = committed.filter(p => !chosen.includes(p));
    // In the person's index, only the committed files change, to what was committed (a hook may have reformatted
    // one): they show clean, and everything else staged stays as it was. So does a hook's file the person had
    // staged a change of their own to: what they staged is theirs, not the commit's to replace.
    const id = async args => (await gitAsync(args)).trim().split(/\s+/)[args[0] === 'ls-tree' ? 2 : 1] ?? null;
    entries.length = 0;
    for (const p of [...chosen, ...hook]) {
      // A branch's first commit has no commit before it: anything in their staging area then is their own.
      const before = head.commit ? await id(['ls-tree', head.commit, '--', p]) : null;
      if (hook.includes(p) && (await id(['ls-files', '-s', '--', p])) !== before) continue;
      const entry = (await gitAsync(['ls-tree', sha, '--', p])).trim();
      entries.push([p, entry ? entry.split(/\s+/).slice(0, 3) : null]);
    }
    await setEntries(process.env);
    run.committed = { sha, at: Date.now(), files: chosen, ...(hook.length ? { hook } : {}) };
    if (hook.length)
      run.stream.push(
        line('warn', 'hook-committed', `Your commit hook also committed: ${hook.join(', ')}`, {
          files: hook.join(', '),
        }),
      );
    saveRun(run);
    emitRun(run);
    return run.committed;
  });
}
