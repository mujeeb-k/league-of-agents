// Lines selected in a file are held by their text, not their numbers: numbers point at other code as soon as
// anything above them changes (an edit, a branch switch, a rebase). The bridge applies the same rule
// (bridge/loa.mjs, relocate).

/** A file's text as lines, line endings normalised, without the empty line after a final newline. */
export function toLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Where the selected lines start in the file now (1-based): where they were, if they are still there; else
 * their one exact match. Null when they are gone, changed, or found in more than one place.
 */
export function relocate(lines: string[], wanted: string[], from: number): number | null {
  const want = wanted.map(l => l.replace(/\r$/, ''));
  if (!want.length) return null;
  const at = (s: number) => want.every((w, i) => lines[s - 1 + i] === w);
  if (from >= 1 && at(from)) return from;
  let found: number | null = null;
  for (let s = 1; s + want.length - 1 <= lines.length; s++)
    if (at(s)) {
      if (found !== null) return null;
      found = s;
    }
  return found;
}

/**
 * Where lines from..to of `before` are in `after` when every line around them is unchanged: an edit inside the
 * selection, which grows or shrinks it. Null when anything outside them changed, or nothing of them is left.
 */
export function grown(before: string[], after: string[], [from, to]: [number, number]): [number, number] | null {
  const head = from - 1,
    tail = before.length - to;
  if (after.length < head + tail) return null;
  for (let i = 0; i < head; i++) if (before[i] !== after[i]) return null;
  for (let i = 1; i <= tail; i++) if (before[before.length - i] !== after[after.length - i]) return null;
  const end = after.length - tail;
  return end >= from ? [from, end] : null;
}
