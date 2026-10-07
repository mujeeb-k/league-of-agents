// Model, layout and diff views.
import { S, dom, st } from '../state/app';
import { wordDiff } from './worddiff';
import { bounds, layoutTree } from './layout';
import type { Change, DirNode, FileNode, FileView, Hunk, Row, Run, SampleRunDef, Stat, TreeSpec } from './types';

/** Parses the "@@ path" sample format. */
export function parseSample(text: string): Record<string, string> {
  const out: Record<string, string[]> = {};
  let cur: string | null = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^@@ (.+)$/);
    if (m && m[1] !== undefined) {
      cur = m[1].trim();
      out[cur] = [];
    } else if (cur) out[cur]!.push(line);
  }
  const res: Record<string, string> = {};
  for (const k in out) {
    const l = out[k]!;
    while (l.length && !l[l.length - 1]!.trim()) l.pop();
    res[k] = l.join('\n');
  }
  return res;
}

const newChange = (p: Partial<Change>): Change => ({
  created: false,
  deleted: false,
  pre: null,
  hunks: [],
  lines: [],
  ...p,
});

export function buildModel(spec: TreeSpec, code: Record<string, string>, runDefs: SampleRunDef[]) {
  S.FILES = new Map();
  S.DIRMAP = new Map();
  S.RUNS = [];
  const walk = (s: TreeSpec, parent: DirNode | null, depth: number): DirNode => {
    const path = parent ? (parent.path ? parent.path + '/' + s.n : s.n) : '';
    const d: DirNode = {
      type: 'dir',
      name: s.n,
      note: s.note || '',
      path,
      parent,
      depth,
      dirs: [],
      files: [],
      cols: 0,
      rows: 0,
      w: 0,
      h: 0,
      x: 0,
      y: 0,
    };
    S.DIRMAP.set(path, d);
    for (const c of s.c) {
      if (typeof c === 'string') {
        const fp = path ? path + '/' + c : c;
        const text = code[fp] || '';
        const f: FileNode = {
          type: 'file',
          name: c,
          path: fp,
          dir: d,
          base: text ? text.split('\n').slice(0, 600) : [],
          createdBy: null,
          gone: false,
          x: 0,
          y: 0,
        };
        S.FILES.set(fp, f);
        d.files.push(f);
      } else d.dirs.push(walk(c, d, depth + 1));
    }
    return d;
  };
  S.ROOT = walk(spec, null, 0);
  for (const r of runDefs) {
    const run: Run = {
      id: r.id,
      agent: r.agent,
      title: r.title,
      model: r.model ?? null,
      when: r.when,
      dur: r.dur,
      prompt: r.prompt,
      summary: r.summary,
      scope: r.scope,
      status: 'done',
      changes: new Map(),
      reviewed: new Set(),
    };
    for (const [p, v] of Object.entries(r.ch)) {
      const f = S.FILES.get(p);
      if (!f) continue;
      if (v === 'CREATE') {
        run.changes.set(p, newChange({ created: true, lines: f.base.slice() }));
        f.base = [];
        f.createdBy = r.id;
      } else run.changes.set(p, newChange({ hunks: v.map(([at, del, add]) => ({ at, del, add })) }));
    }
    S.RUNS.push(run);
  }
  layout();
}

export function applyHunks(L: string[], hunks: Hunk[]): string[] {
  const out = L.slice();
  [...hunks].sort((a, b) => b.at - a.at).forEach(h => out.splice(h.at, h.del, ...h.add));
  return out;
}

export function linesAt(f: FileNode, upto: number): { L: string[]; exists: boolean } {
  if (S.CONN) return { L: f.base, exists: !f.gone };
  let L = f.base,
    exists = !f.createdBy;
  for (let i = 0; i < upto; i++) {
    // A reverted run's changes are gone from every later view.
    const ch = S.RUNS[i]!.reverted ? undefined : S.RUNS[i]!.changes.get(f.path);
    if (!ch) continue;
    if (ch.created) {
      exists = true;
      L = ch.lines;
    } else L = applyHunks(L, ch.hunks);
  }
  return { L, exists };
}
export const existsNow = (f: FileNode) => linesAt(f, S.RUNS.length).exists;

export function diffRows(pre: string[], hunks: Hunk[]): Row[] {
  const out: Row[] = [];
  let i = 0,
    na = 1,
    nb = 1;
  for (const h of [...hunks].sort((a, b) => a.at - b.at)) {
    while (i < h.at && i < pre.length) {
      out.push({ t: pre[i]!, k: '', nb: nb++, na: na++ });
      i++;
    }
    // pre[i] can be undefined when a hunk runs past the end; it renders as a blank row.
    const dels: Row[] = [];
    for (let d = 0; d < h.del; d++) {
      dels.push({ t: pre[i] as string, k: 'del', nb: nb++ });
      i++;
    }
    const adds: Row[] = h.add.map(a => ({ t: a, k: 'add', na: na++ }));
    // Pair the n-th removed line with the n-th added line, and mark the words that changed.
    for (let p = 0; p < Math.min(dels.length, adds.length); p++) {
      const wd = wordDiff(dels[p]!.t ?? '', adds[p]!.t);
      if (wd) {
        dels[p]!.wd = wd.a;
        adds[p]!.wd = wd.b;
      }
    }
    out.push(...dels, ...adds);
  }
  while (i < pre.length) {
    out.push({ t: pre[i]!, k: '', nb: nb++, na: na++ });
    i++;
  }
  return out;
}

export function viewOf(f: FileNode): FileView {
  const ri = st.run ? S.RUNS.indexOf(st.run) : S.RUNS.length;
  const ch = st.run && st.run.changes.get(f.path);
  const pre = ch && ch.pre ? { L: ch.pre, exists: !ch.created } : linesAt(f, ri);
  if (!ch) return { exists: pre.exists, rows: pre.L.map((t, i) => ({ t, k: '', n: i + 1 })), kind: '', lines: pre.L };
  const d: Row[] = ch.created ? ch.lines.map((t, i) => ({ t, k: 'add', na: i + 1 })) : diffRows(pre.L, ch.hunks);
  const a = d.filter(r => r.k === 'add').length,
    dl = d.filter(r => r.k === 'del').length;
  const kind = ch.created ? 'add' : 'mod';
  const afterRows = d.filter(r => r.k !== 'del');
  if (st.mode === 'before') {
    if (ch.created) return { exists: false, ghost: true, kind, a, d: dl, rows: [], lines: [] };
    return {
      exists: true,
      kind,
      a,
      d: dl,
      rows: d.filter(r => r.k !== 'add').map(r => ({ t: r.t, k: r.k, n: r.nb, wd: r.wd })),
      lines: pre.L,
    };
  }
  const rows =
    st.mode === 'after'
      ? afterRows.map(r => ({ t: r.t, k: r.k, n: r.na, wd: r.wd }))
      : d.map(r => ({ t: r.t, k: r.k, n: r.k === 'del' ? r.nb : r.na, wd: r.wd }));
  return { exists: true, kind, a, d: dl, rows, lines: afterRows.map(r => r.t) };
}

export function fileStat(run: Run, p: string): Stat | null {
  const ch = run.changes.get(p);
  if (!ch) return null;
  if (ch.created) return { a: ch.lines.length, d: 0, kind: 'add' };
  let a = 0,
    d = 0;
  ch.hunks.forEach(h => {
    a += h.add.length;
    d += h.del;
  });
  return { a, d, kind: 'mod' };
}
export function runStats(run: Run) {
  let a = 0,
    d = 0;
  for (const p of run.changes.keys()) {
    const s = fileStat(run, p)!;
    a += s.a;
    d += s.d;
  }
  return { a, d, n: run.changes.size };
}
export const under = (d: DirNode, p: string) => d.path === '' || p.startsWith(d.path + '/');
export function dirStat(run: Run, d: DirNode) {
  let a = 0,
    d2 = 0,
    n = 0;
  for (const p of run.changes.keys())
    if (under(d, p)) {
      const s = fileStat(run, p)!;
      a += s.a;
      d2 += s.d;
      n++;
    }
  return n ? { a, d: d2, n } : null;
}

/**
 * Lays out the map (lib/layout.ts), keeping the layout in use. `tidy` lays everything out afresh. The target
 * shape is the canvas the person sees on opening: the stage, less the first-load sidebar and the space kept
 * for the hint and the composer.
 */
export function layout(tidy = false) {
  const target = dom.stage
    ? {
        w: Math.max(200, dom.stage.clientWidth - (dom.side?.offsetWidth ?? 0)),
        h: Math.max(200, dom.stage.clientHeight - 148),
      }
    : { w: 16, h: 10 };
  const r = layoutTree(S.ROOT!, tidy ? null : S.LAYOUT, target, tidy);
  S.LAYOUT = r.saved;
  S.CROWDED = r.crowded;
  S.LAYOUT_REV++;
  const b = bounds(S.ROOT!);
  S.WB = { x: b.x - 40, y: b.y - 40, w: b.w + 80, h: b.h + 80 };
  for (const svg of [dom.wires, dom.links])
    if (svg) {
      svg.setAttribute('width', String(b.x + b.w + 40));
      svg.setAttribute('height', String(b.y + b.h + 40));
    }
}
export const allDirs = () => [...S.DIRMAP.values()];
export const filesUnder = (d: DirNode) => [...S.FILES.values()].filter(f => under(d, f.path));

/** The agent stopped short and is waiting on you: Claude Code said it was blocked, or named an action. */
export const needsYou = (r: Run) => !!r.turn && (r.turn.status === 'blocked' || r.turn.needs !== '');

/** A tree spec from a list of file paths: folders first, then files, each by name. */
export function specFromPaths(rootName: string, paths: string[]): TreeSpec {
  const spec: TreeSpec = { n: rootName, note: '', c: [] },
    dirs = new Map<string, TreeSpec>([['', spec]]);
  for (const p of paths) {
    const parts = p.split('/');
    let cur = spec,
      acc = '';
    for (let j = 0; j < parts.length - 1; j++) {
      acc = acc ? acc + '/' + parts[j] : parts[j]!;
      if (!dirs.has(acc)) {
        const nd: TreeSpec = { n: parts[j]!, note: '', c: [] };
        dirs.set(acc, nd);
        cur.c.push(nd);
      }
      cur = dirs.get(acc)!;
    }
    const leaf = parts[parts.length - 1]!;
    if (!cur.c.includes(leaf)) cur.c.push(leaf);
  }
  const name = (x: string | TreeSpec) => (typeof x === 'string' ? x : x.n);
  const sortSpec = (s: TreeSpec) => {
    s.c.sort((a, b) => Number(typeof a === 'string') - Number(typeof b === 'string') || name(a).localeCompare(name(b)));
    s.c.forEach(c => {
      if (typeof c !== 'string') sortSpec(c);
    });
  };
  sortSpec(spec);
  return spec;
}
