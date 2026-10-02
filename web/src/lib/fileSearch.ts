// Ranks files for quick open. Every word of the query must appear in the path, in order of typing;
// matches in the file name rank above matches in folders, and shorter paths break ties.
export interface Searchable {
  path: string;
  name: string;
}

function score(f: Searchable, words: string[]): number {
  const path = f.path.toLowerCase(),
    name = f.name.toLowerCase();
  let s = 0,
    from = 0;
  for (const w of words) {
    const at = path.indexOf(w, from);
    if (at < 0) return -1;
    from = at + w.length;
    s += name.startsWith(w) ? 4 : name.includes(w) ? 3 : 1;
  }
  return s;
}

/** The best `limit` files for the query; with no query, the first `limit` by path. */
export function searchFiles<T extends Searchable>(files: T[], query: string, limit = 50): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...files].sort((a, b) => a.path.localeCompare(b.path)).slice(0, limit);
  return files
    .map(f => ({ f, s: score(f, words) }))
    .filter(x => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.f.path.length - b.f.path.length || a.f.path.localeCompare(b.f.path))
    .slice(0, limit)
    .map(x => x.f);
}
