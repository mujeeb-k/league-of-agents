// A run's own writes to a file, and taking them out again. Sessions at once change one file in turns: a run's change
// is what its own writes did, on the file as the others left it, and a revert takes back only those writes, merged
// out of the file as it is now (git merge-file), so another session's lines, committed or not, stay. A write is
// [from, to, at]: the file's blob before and after it (null where there was no file, UNSEEN where that wasn't
// seen), and when it ended.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { LOA, ROOT, gitAsync } from './repo.mjs';
import { splitLines } from './util.mjs';

/** git's empty blob, for a file that isn't there. Written once, so a diff or a merge can name it. */
const EMPTY = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
/** @type {Promise<string> | null} */
let empty = null;
const emptyBlob = () =>
  (empty ??= gitAsync(['hash-object', '-w', '--stdin'], { input: '' }).then(
    () => EMPTY,
    e => {
      empty = null;
      throw e;
    },
  ));

/** git with its output as bytes: a file's text is merged as it is, whatever its encoding. */
const gitBytes = (args, input) =>
  new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd: ROOT, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }, (e, out) =>
      e ? reject(e) : resolve(out),
    );
    if (input !== undefined) child.stdin.end(input);
  });
const bytesOf = blob => gitBytes(['cat-file', 'blob', blob]);
/** A blob of bytes already as git keeps them (a merge of blobs): no filter applies again. */
const blobOf = async bytes => String(await gitBytes(['hash-object', '-w', '--stdin', '--no-filters'], bytes)).trim();

/**
 * `ours` with the change from `base` to `theirs` applied, as git merge-file does it, or null where the two overlap
 * (nothing is written with conflict markers) or a file isn't text.
 */
async function merge(ours, base, theirs) {
  const files = await Promise.all([ours, base, theirs].map(b => (b ? bytesOf(b) : Buffer.alloc(0))));
  if (files.some(f => f.includes(0))) return null;
  const dir = fs.mkdtempSync(path.join(LOA, 'merge-'));
  try {
    const paths = ['ours', 'base', 'theirs'].map((name, i) => {
      const f = path.join(dir, name);
      fs.writeFileSync(f, files[i]);
      return f;
    });
    let out;
    try {
      out = await gitBytes(['merge-file', '-p', '-q', ...paths]);
    } catch {
      // Its exit code is the number of conflicts.
      return null;
    }
    return blobOf(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A file a write found or left that wasn't seen (an edit whose start landed before the bridge heard of it). */
export const UNSEEN = '';
/** @typedef {[string | null, string | null, number?]} Write  A write: the file before, after, and when it ended. */
/**
 * The file `now` with these writes taken out, the last first: `{ blob }` (null: no file), or `{ conflict: true }`
 * where a later change overlaps one of them, or one of them wasn't seen whole. A file the writes left as it is now
 * goes straight back.
 * @param {Write[]} writes
 * @param {string | null} now
 * @returns {Promise<{ blob: string | null } | { conflict: true }>}
 */
export async function takeOut(writes, now) {
  let cur = now;
  for (const [from, to] of [...writes].reverse()) {
    // A guess at what it found could take another's lines out with it: not guessed.
    if (from === UNSEEN || to === UNSEEN) return { conflict: true };
    if (cur === to) {
      cur = from;
      continue;
    }
    // Deleted by the write and there again, or gone since: nothing to merge against.
    if (to === null || cur === null) return { conflict: true };
    const merged = await merge(cur, to, from ?? (await emptyBlob()));
    if (merged === null) return { conflict: true };
    // A file the write created, emptied by taking it out, goes.
    cur = from === null && merged === EMPTY ? null : merged;
  }
  return { blob: cur };
}

/**
 * A file's change from one blob to another, as computeChanges gives it (snapshots.mjs): the file as it was, and the
 * hunks to what it became.
 */
export async function changeOf(p, from, to) {
  const [a, b] = await Promise.all([from ?? emptyBlob(), to ?? emptyBlob()]);
  const out = await gitAsync(['diff', '--no-color', '--no-ext-diff', '-U0', a, b]);
  const hunks = [];
  let h = null;
  for (const line of out.split('\n')) {
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (m) {
      const at = +m[1],
        del = m[2] === undefined ? 1 : +m[2];
      h = { at: del === 0 ? at : at - 1, del, add: [] };
      hunks.push(h);
      // The file headers come before the first hunk; within one, a line starting '+' is an added line.
    } else if (h && line.startsWith('+')) h.add.push(line.slice(1));
  }
  const pre = from ? splitLines(await gitAsync(['cat-file', 'blob', from])) : [];
  return { path: p, created: from === null, deleted: to === null, pre: pre.slice(0, 4000), hunks };
}
