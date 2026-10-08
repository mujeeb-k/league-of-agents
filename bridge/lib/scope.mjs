// A run's scope, and what counts as inside it: shared by the bridge and the scope lock in the hooks.

/** A scope entry: a folder (ends in /), a file, or lines of a file (path:12-18). */
export function scopeEntry(s) {
  const m = /^(.+):(\d+)-(\d+)$/.exec(s);
  return m ? { path: m[1], from: +m[2], to: +m[3] } : { path: s };
}
/**
 * Where selected lines start in the file now (1-based), or null when that can't be told. A selection is held by its
 * text and the lines around it (`context`: up to 3 lines before and after that told it apart from identical copies,
 * and whether a copy existed), never by numbers alone, which point at other code as soon as anything above changes.
 * The app applies the same rule (web/src/lib/anchor.ts): kept where it was if no copy could be there instead; else
 * the one copy whose lines on either side still match; else, for code that had no copy, its one exact match. Without
 * context, lines are taken only where their numbers say.
 */
export function relocate(lines, wanted, from, context) {
  const n = wanted.length;
  if (!n) return null;
  const found = [];
  for (let s = 1; s + n - 1 <= lines.length; s++) if (wanted.every((w, i) => lines[s - 1 + i] === w)) found.push(s);
  if (!context) return found.includes(from) ? from : null;
  const { before = [], after = [], twin = true } = context;
  const told = s =>
    (before.length > 0 && before.every((b, i) => lines[s - 1 - before.length + i] === b)) ||
    (after.length > 0 && after.every((x, i) => lines[s - 1 + n + i] === x));
  if (found.includes(from) && (found.length === 1 || told(from))) return from;
  const kept = found.filter(told);
  if (kept.length === 1) return kept[0];
  return !twin && found.length === 1 ? found[0] : null;
}
export function inScope(scope, rel) {
  return scope
    .map(scopeEntry)
    .some(e => (e.path.endsWith('/') ? e.path === '/' || rel.startsWith(e.path) : rel === e.path));
}
/**
 * A change kept to lines from..to of the file as it was (before) leaves every line around them as it was.
 * Held by the surroundings, not by line numbers, which move as soon as the range itself grows or shrinks.
 */
export function rangeKept(before, after, { from, to }) {
  const head = from - 1,
    tail = Math.max(0, before.length - to);
  if (after.length < head + tail) return false;
  for (let i = 0; i < head; i++) if (before[i] !== after[i]) return false;
  for (let i = 1; i <= tail; i++) if (before[before.length - i] !== after[after.length - i]) return false;
  return true;
}
