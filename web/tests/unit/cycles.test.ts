// Modules that import each other in a circle can run before one another is ready: a call made as a module loads then
// fails only at run time, in the browser. No new circle may appear. The ones still here are listed, and may only
// shrink: taking a module out of one passes, adding one or starting another fails.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = path.join(__dirname, '../../..');

/** The circles left, by root: each a set of modules that reach each other. */
const KNOWN: Record<string, string[][]> = {
  'web/src': [
    [
      'lib/camera.ts',
      'lib/minimap.ts',
      'lib/scene.ts',
      'state/editing.ts',
      'state/panels.ts',
      'state/render.ts',
      'state/watch.ts',
    ],
    ['api/live.ts', 'components/ConflictDialog.tsx', 'demo/sessions.ts', 'state/actions.ts'],
  ],
  bridge: [
    [
      'lib/agents/acp.mjs',
      'lib/agents/claude.mjs',
      'lib/agents/process.mjs',
      'lib/agents/registry.mjs',
      'lib/agents/stream.mjs',
      'lib/checks.mjs',
      'lib/events.mjs',
      'lib/parallel.mjs',
      'lib/runs.mjs',
      'lib/shell.mjs',
      'lib/steps.mjs',
      'lib/watch.mjs',
    ],
  ],
};

/** Each module's imports that run code (type-only imports don't), as files under the root. */
function graphOf(root: string) {
  const files = (fs.readdirSync(root, { recursive: true }) as string[])
    .filter(f => /\.(ts|tsx|mjs)$/.test(f) && !f.includes('i18n/'))
    .map(f => f.split(path.sep).join('/'));
  const known = new Set(files);
  const graph = new Map<string, string[]>();
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const deps: string[] = [];
    for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) {
      const spec = m[1]!;
      const base = spec.startsWith('@/')
        ? spec.slice(2)
        : spec.startsWith('.')
          ? path.posix.normalize(path.posix.join(path.posix.dirname(f), spec))
          : null;
      if (base === null) continue;
      const hit = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}/index.ts`].find(c => known.has(c));
      if (hit) deps.push(hit);
    }
    graph.set(f, deps);
  }
  return graph;
}

/** Groups of modules that reach each other (Tarjan's strongly connected components of more than one module). */
function circles(graph: Map<string, string[]>) {
  let n = 0;
  const index = new Map<string, number>(),
    low = new Map<string, number>(),
    stack: string[] = [],
    on = new Set<string>(),
    out: string[][] = [];
  const visit = (v: string) => {
    index.set(v, n);
    low.set(v, n++);
    stack.push(v);
    on.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) !== index.get(v)) return;
    const group: string[] = [];
    let w: string;
    do {
      w = stack.pop()!;
      on.delete(w);
      group.push(w);
    } while (w !== v);
    if (group.length > 1) out.push(group.sort());
  };
  for (const v of graph.keys()) if (!index.has(v)) visit(v);
  return out;
}

describe('import circles', () => {
  it.each(Object.keys(KNOWN))('%s has none but the ones listed, which may only shrink', root => {
    const found = circles(graphOf(path.join(REPO, root)));
    const extra = found.flatMap(group => {
      const home = KNOWN[root]!.find(k => group.every(m => k.includes(m)));
      return home ? [] : [group.filter(m => !KNOWN[root]!.some(k => k.includes(m))).join(', ') || group.join(', ')];
    });
    expect(extra).toEqual([]);
  });
});
