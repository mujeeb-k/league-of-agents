// The lines that changed between two versions of a file, as hunks: what a session at work has changed so far, a
// step of its run, a renamed file, a save in the demo, a file that changed on disk. A line diff (jsdiff, Myers), so
// edits in separate places are separate hunks, as git shows them once the run has ended.
import { diffArrays } from 'diff/lib/diff/array.js';
import type { Hunk } from './types';

/**
 * Past this many lines added and removed the diff is no longer searched for: the search costs their number squared
 * (50 ms here, 200 ms at twice as many, on a 4,000-line file), and a file rewritten whole reads no better in
 * pieces. The block that changed stands in.
 */
const MAX_CHANGED = 1000;

export function lineDiff(a: string[], b: string[]): Hunk[] {
  const parts = diffArrays(a, b, { maxEditLength: MAX_CHANGED });
  if (!parts) return changedBlock(a, b);
  const hunks: Hunk[] = [];
  let at = 0,
    open: Hunk | null = null;
  for (const p of parts) {
    if (!p.added && !p.removed) {
      at += p.value.length;
      open = null;
      continue;
    }
    if (!open) hunks.push((open = { at, del: 0, add: [] }));
    if (p.added) open.add.push(...p.value);
    else {
      open.del += p.value.length;
      at += p.value.length;
    }
  }
  return hunks;
}

/**
 * Each hunk with where its added lines begin in the new version (`now`, 0-based): `at` counts in the old one, and
 * every hunk before it moved the rest by what it added and removed.
 */
export function inNewVersion(hunks: Hunk[]): (Hunk & { now: number })[] {
  let moved = 0;
  return hunks.map(h => {
    const now = h.at + moved;
    moved += h.add.length - h.del;
    return { ...h, now };
  });
}

/** Everything between the lines both versions share at the start and at the end, as one hunk. */
function changedBlock(a: string[], b: string[]): Hunk[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  if (start === a.length && start === b.length) return [];
  return [{ at: start, del: a.length - start - end, add: b.slice(start, b.length - end) }];
}
