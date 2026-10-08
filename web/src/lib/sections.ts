// Sections of the repository that runs work on, and when two of them overlap. The same rules as the bridge's
// (bridge/lib/scope.mjs inScope, bridge/lib/parallel.mjs clash), so the app refuses what the bridge would refuse,
// before anything starts.

/** The path a scope entry names: a file, a folder ending in /, or "/" for the whole repository; lines drop away. */
export const area = (entry: string) => /^(.+):\d+-\d+$/.exec(entry)?.[1] ?? entry;

/** Two sections overlap when either holds the other, or either is the whole repository. */
export function overlaps(a: string, b: string): boolean {
  const [x, y] = [area(a), area(b)];
  return (
    x === '/' || y === '/' || x === y || (x.endsWith('/') && y.startsWith(x)) || (y.endsWith('/') && x.startsWith(y))
  );
}

/** Whether section a holds section b: a is the whole repository, or a folder b is in. */
const holds = (a: string, b: string) => a === '/' || (a.endsWith('/') && b.startsWith(a) && a !== b);

/** Whether a run on this scope may change the file. An empty or missing scope is the whole repository. */
export function covers(scope: string[] | undefined, path: string): boolean {
  return !scope?.length || scope.some(e => overlaps(e, path));
}

export interface Clash {
  /** The section that can't start, "/" for the whole repository. */
  path: string;
  /** The section it falls in or holds, also "/" for the whole repository. */
  inside: string;
  /** The run at work on `inside`, when it isn't another section picked with it. */
  run?: number;
}

/** Why runs on these sections can't start beside the runs at work, or null when they can. */
export function clashOf(sections: string[], working: { id: number; scope?: string[] }[]): Clash | null {
  const own = sections.length ? sections.map(area) : ['/'];
  for (const [i, a] of own.entries())
    for (const b of own.slice(0, i))
      if (overlaps(a, b)) return holds(a, b) ? { path: b, inside: a } : { path: a, inside: b };
  for (const r of working) {
    const theirs = r.scope?.length ? r.scope.map(area) : ['/'];
    for (const a of own) for (const b of theirs) if (overlaps(a, b)) return { path: a, run: r.id, inside: b };
  }
  return null;
}
