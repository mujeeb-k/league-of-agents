// Renames, found from a run's changes alone. The bridge records a rename as one file deleted and one created
// (`git diff --no-renames`, computeChanges); finding them here leaves the bridge's records, and reverting them, as
// they are.

/** A change as the bridge sends it: what matters here is whether the file came or went, and its text. */
interface Gone {
  path: string;
  created: boolean;
  deleted: boolean;
  pre: string[];
  hunks: { add: string[] }[];
}

/** The share of lines two texts have in common, counting repeats: 1 for the same text, 0 for nothing shared. */
function similarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const counts = new Map<string, number>();
  for (const l of a) counts.set(l, (counts.get(l) ?? 0) + 1);
  let shared = 0;
  for (const l of b) {
    const n = counts.get(l) ?? 0;
    if (n) {
      shared++;
      counts.set(l, n - 1);
    }
  }
  return shared / Math.max(a.length, b.length);
}

/**
 * A run's renames, new path to old: a deleted file and a created one that share at least half their lines (git's
 * default for finding renames, `git diff -M`). Paired one to one, closest first; a file with two equally close
 * matches stays unpaired.
 */
export function renamesOf(changes: Gone[]): Map<string, string> {
  const deleted = changes.filter(c => c.deleted),
    created = changes.filter(c => c.created);
  const pairs: { from: string; to: string; score: number }[] = [];
  for (const d of deleted)
    for (const c of created) {
      const score = similarity(
        d.pre,
        c.hunks.flatMap(h => h.add),
      );
      if (score >= 0.5) pairs.push({ from: d.path, to: c.path, score });
    }
  pairs.sort((a, b) => b.score - a.score);
  const out = new Map<string, string>(),
    used = new Set<string>();
  for (const p of pairs) {
    if (used.has(p.from) || used.has(p.to)) continue;
    const rival = pairs.some(
      q =>
        q !== p && q.score === p.score && (q.from === p.from || q.to === p.to) && !used.has(q.from) && !used.has(q.to),
    );
    used.add(p.from);
    used.add(p.to);
    if (!rival) out.set(p.to, p.from);
  }
  return out;
}
