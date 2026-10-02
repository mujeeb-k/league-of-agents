// The block that changed between two versions of a file, as one hunk: the lines both share at the start and
// at the end are left out. Enough for a save in the demo and for showing what changed on disk.
import type { Hunk } from './types';

export function changedBlock(a: string[], b: string[]): Hunk | null {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  if (start === a.length && start === b.length) return null;
  return { at: start, del: a.length - start - end, add: b.slice(start, b.length - end) };
}
