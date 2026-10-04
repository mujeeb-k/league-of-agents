// Lines selected in a file are held by their text and the lines around them, not their numbers: numbers point at
// other code as soon as anything above them changes (an edit, a branch switch, a rebase). A selection points at the
// code that was picked, or says it can't: never at another copy. The bridge applies the same rule
// (bridge/loa.mjs, relocate).

/** A file's text as lines, line endings normalised, without the empty line after a final newline. */
export function toLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * What selected lines are held by: their text; up to 3 lines before and after them, each side kept only if no
 * identical copy had the same lines on that side; and whether such a copy existed. Taken again after every keep or
 * follow, from the file as it is then. The bridge applies the same rule (bridge/loa.mjs, relocate).
 */
export interface Anchor {
  text: string[];
  before: string[];
  after: string[];
  twin: boolean;
}

/** Where the lines `want` start in the file (1-based), every place they are. */
function matches(lines: string[], want: string[]): number[] {
  const out: number[] = [];
  for (let s = 1; s + want.length - 1 <= lines.length; s++)
    if (want.every((w, i) => lines[s - 1 + i] === w)) out.push(s);
  return out;
}

export function anchorAt(lines: string[], from: number, to: number): Anchor {
  const n = to - from + 1;
  const around = (s: number) => ({
    before: lines.slice(Math.max(0, s - 4), s - 1),
    after: lines.slice(s - 1 + n, s + n + 2),
  });
  const text = lines.slice(from - 1, to);
  let { before, after } = around(from);
  const twins = matches(lines, text).filter(s => s !== from);
  for (const s of twins) {
    const o = around(s);
    if (o.before.join('\n') === before.join('\n')) before = [];
    if (o.after.join('\n') === after.join('\n')) after = [];
  }
  return { text, before, after, twin: twins.length > 0 };
}

/**
 * Where the anchored lines start in the file now (1-based), or null when that can't be told. Kept where they were
 * if no copy could be there instead; else the one copy whose stored lines on either side still match; else, for
 * code that had no copy, its one exact match. Never another copy of it.
 */
export function relocate(lines: string[], a: Anchor, from: number): number | null {
  const n = a.text.length;
  if (!n) return null;
  const found = matches(lines, a.text);
  const told = (s: number) =>
    (a.before.length > 0 && a.before.every((b, i) => lines[s - 1 - a.before.length + i] === b)) ||
    (a.after.length > 0 && a.after.every((x, i) => lines[s - 1 + n + i] === x));
  if (found.includes(from) && (found.length === 1 || told(from))) return from;
  const kept = found.filter(told);
  if (kept.length === 1) return kept[0]!;
  return !a.twin && found.length === 1 ? found[0]! : null;
}

/**
 * Where lines from..to of `before` are in `after` when every line around them is unchanged: an edit inside the
 * selection, which grows or shrinks it, or 'removed' when the edit took out every one of them. Null when anything
 * outside them changed.
 */
export function grown(
  before: string[],
  after: string[],
  [from, to]: [number, number],
): [number, number] | 'removed' | null {
  const head = from - 1,
    tail = before.length - to;
  if (after.length < head + tail) return null;
  for (let i = 0; i < head; i++) if (before[i] !== after[i]) return null;
  for (let i = 1; i <= tail; i++) if (before[before.length - i] !== after[after.length - i]) return null;
  const end = after.length - tail;
  return end >= from ? [from, end] : 'removed';
}
