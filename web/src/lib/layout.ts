// The map's layout. One geometry at every zoom: folders are frames holding a grid of file slots,
// and a folder's subfolders sit just to its right, stacked, so children stay next to their parent. The root's
// subtrees are packed into columns so the whole map matches the canvas's shape.
//
// A layout is kept, and saved per repo in live mode (.loa/layout.json through the bridge, or the browser with
// bridges before 0.2.0; api/live.ts): later opens place every known folder and file where it was, whatever the
// window's shape. New files take a free slot; a full folder grows down, then right, only where it collides with
// nothing; a new folder goes at the end of its parent's stack, at the first free height. Existing files never
// move. "Tidy layout" lays everything out afresh.
import { CH, COLGAP, CW, GAP, PAD, SIB } from './constants';
import type { DirNode } from './types';

/** Height of the label strip above each frame, and the size of a folder without files. */
export const LABEL = 30;
const BARE_W = 320,
  BARE_H = 60;

export interface SavedLayout {
  v: 1;
  /** Each folder's top-left corner and grid size. */
  dirs: Record<string, { x: number; y: number; cols: number; rows: number }>;
  /** Each file's slot in its folder's grid, row by row. */
  files: Record<string, number>;
}

export interface LayoutResult {
  saved: SavedLayout;
}

type Rect = { x: number; y: number; w: number; h: number };

const frameW = (cols: number) => (cols ? PAD * 2 + cols * CW + (cols - 1) * GAP : BARE_W);
const frameH = (rows: number) => (rows ? PAD * 2 + rows * CH + (rows - 1) * GAP : BARE_H);

/** Grid columns near the target that leave at least one free slot, so a new file never moves anything. */
export function pickCols(n: number, target: number): { cols: number; rows: number } {
  if (!n) return { cols: 0, rows: 0 };
  const t = Math.max(1, Math.min(target, n + 1));
  for (const c of [t, t + 1, t - 1, t + 2, t - 2])
    if (c >= 1 && n % c !== 0) return { cols: c, rows: Math.ceil(n / c) };
  return { cols: t, rows: n / t + 1 };
}

function slotXY(d: DirNode, i: number) {
  return { x: d.x + PAD + (i % d.cols) * (CW + GAP), y: d.y + PAD + Math.floor(i / d.cols) * (CH + GAP) };
}

function placeFiles(d: DirNode, slots: Map<string, number>) {
  for (const f of d.files) {
    const p = slotXY(d, slots.get(f.path)!);
    f.x = p.x;
    f.y = p.y;
  }
}

// ---------------------------------------------------------------- fresh layout

interface Box {
  d: DirNode;
  cols: number;
  rows: number;
  w: number;
  h: number;
  /** Subfolders, packed into columns to the right of the frame. */
  columns: Box[][];
  colW: number[];
  /** The subtree's size: the frame and its subfolder columns. */
  tw: number;
  th: number;
}

/** Fill a column up to the target height, then start the next; at most k columns. */
function pack(kids: Box[], k: number) {
  const total = kids.reduce((a, b) => a + b.th, 0) + SIB * Math.max(0, kids.length - 1);
  const target = total / k;
  const cols: Box[][] = [[]];
  let h = 0;
  for (const b of kids) {
    const col = cols[cols.length - 1]!;
    if (col.length && h + SIB + b.th > target * 1.05 && cols.length < k) {
      cols.push([b]);
      h = b.th;
    } else {
      col.push(b);
      h += (col.length > 1 ? SIB : 0) + b.th;
    }
  }
  return cols;
}

/**
 * Measures a subtree. The frame's grid follows `aspect`; its subfolders are packed into as many columns as
 * bring the subtree's shape closest to the canvas's (`want`, a log ratio of width to height).
 */
function measure(d: DirNode, aspect: number, want: number): Box {
  const n = d.files.length;
  const { cols, rows } = pickCols(n, Math.ceil(Math.sqrt(n * aspect)));
  const w = frameW(cols),
    h = frameH(rows);
  const kids = d.dirs.map(c => measure(c, aspect, want));
  let best: Box = { d, cols, rows, w, h, columns: [], colW: [], tw: w, th: h };
  let bestScore = Infinity;
  for (let k = 1; k <= Math.max(1, Math.min(8, kids.length)); k++) {
    const columns = kids.length ? pack(kids, k) : [];
    const colW = columns.map(c => c.reduce((a, b) => Math.max(a, b.tw), 0));
    const colH = columns.map(c => c.reduce((a, b) => a + b.th, 0) + SIB * (c.length - 1));
    const tw = w + colW.reduce((a, x) => a + COLGAP + x, 0);
    const th = Math.max(h, ...colH, 0);
    const score = Math.abs(Math.log(tw / (th + LABEL)) - want);
    if (score < bestScore - 0.01) {
      bestScore = score;
      best = { d, cols, rows, w, h, columns, colW, tw, th };
    }
  }
  return best;
}

function place(b: Box, x: number, y: number) {
  Object.assign(b.d, { x, y, cols: b.cols, rows: b.rows, w: b.w, h: b.h });
  let cx = x + b.w + COLGAP;
  b.columns.forEach((col, i) => {
    let cy = y;
    for (const k of col) {
      place(k, cx, cy);
      cy += k.th + SIB;
    }
    cx += b.colW[i]! + COLGAP;
  });
}

function fresh(root: DirNode, target: { w: number; h: number }) {
  const want = Math.log(target.w / target.h);
  let best: { score: number; box: Box } | null = null;
  for (const aspect of [0.6, 1, 1.6, 2.6, 4]) {
    const box = measure(root, aspect, want);
    const score = Math.abs(Math.log(box.tw / (box.th + LABEL)) - want);
    if (
      !best ||
      score < best.score - 0.02 ||
      (Math.abs(score - best.score) <= 0.02 && box.tw * box.th < best.box.tw * best.box.th)
    )
      best = { score, box };
  }
  place(best!.box, 0, 0);
}

// ---------------------------------------------------------------- keeping a saved layout

const all = (d: DirNode): DirNode[] => [d, ...d.dirs.flatMap(all)];
/** A frame with its label strip, which nothing else may overlap. */
const occupied = (d: DirNode): Rect => ({ x: d.x, y: d.y - LABEL, w: d.w, h: d.h + LABEL });
const hits = (a: Rect, b: Rect) =>
  a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

/**
 * Lays out the tree. With no saved layout, or with `tidy`, everything is placed afresh to fit `target` (the
 * visible canvas, as a shape). Otherwise the saved layout is kept and only new folders and files are placed.
 */
export function layoutTree(
  root: DirNode,
  saved: SavedLayout | null,
  target: { w: number; h: number },
  tidy = false,
): LayoutResult {
  const dirs = all(root);
  const slots = new Map<string, number>();
  if (!saved || tidy) {
    fresh(root, target);
    for (const d of dirs) d.files.forEach((f, i) => slots.set(f.path, i));
  } else {
    // Known folders where they were; new folders after, in tree order, once their parents are placed.
    const fresh: DirNode[] = [];
    for (const d of dirs) {
      const s = saved.dirs[d.path];
      if (s) Object.assign(d, { x: s.x, y: s.y, cols: s.cols, rows: s.rows, w: frameW(s.cols), h: frameH(s.rows) });
      else fresh.push(d);
    }
    const placed = new Set(dirs.filter(d => saved.dirs[d.path]));
    const others = (d: DirNode) => [...placed].filter(o => o !== d).map(occupied);
    const free = (d: DirNode, r: Rect) => !others(d).some(o => hits(r, o));
    for (const d of fresh) {
      const { cols, rows } = pickCols(d.files.length, Math.ceil(Math.sqrt(d.files.length * 1.6)));
      Object.assign(d, { cols, rows, w: frameW(cols), h: frameH(rows) });
      const p = d.parent;
      d.x = p ? p.x + p.w + COLGAP : 0;
      const siblings = p ? p.dirs.filter(s => s !== d && placed.has(s)) : [];
      d.y = siblings.length ? Math.max(...siblings.map(s => s.y + s.h)) + SIB : p ? p.y : 0;
      while (!free(d, occupied(d))) {
        const blocker = others(d).find(o => hits(occupied(d), o))!;
        d.y = blocker.y + blocker.h + LABEL + GAP;
      }
      placed.add(d);
    }
    // Known files keep their slot; new files take the first free one; a full folder grows.
    for (const d of dirs) {
      const used = new Set<number>();
      const added = [];
      for (const f of d.files) {
        const s = saved.files[f.path];
        if (s !== undefined && s < d.cols * d.rows && !used.has(s)) {
          slots.set(f.path, s);
          used.add(s);
        } else added.push(f);
      }
      for (const f of added) {
        let i = 0;
        while (i < d.cols * d.rows && used.has(i)) i++;
        if (i >= d.cols * d.rows) {
          const grow = (cols: number, rows: number) => {
            const r = { x: d.x, y: d.y - LABEL, w: frameW(cols), h: frameH(rows) + LABEL };
            return free(d, r) ? { cols, rows } : null;
          };
          const g = d.cols ? (grow(d.cols, d.rows + 1) ?? grow(d.cols + 1, d.rows)) : (grow(2, 1) ?? grow(1, 1));
          const next = g ?? (d.cols ? { cols: d.cols, rows: d.rows + 1 } : { cols: 2, rows: 1 });
          // Growing a column renumbers slots row by row; keep every file where it was by remapping.
          if (next.cols !== d.cols && d.cols)
            for (const [p, s] of slots)
              if (d.files.some(x => x.path === p)) slots.set(p, Math.floor(s / d.cols) * next.cols + (s % d.cols));
          const remapped = new Set([...slots].filter(([p]) => d.files.some(x => x.path === p)).map(([, s]) => s));
          used.clear();
          remapped.forEach(s => used.add(s));
          Object.assign(d, { cols: next.cols, rows: next.rows, w: frameW(next.cols), h: frameH(next.rows) });
          i = 0;
          while (used.has(i)) i++;
        }
        slots.set(f.path, i);
        used.add(i);
      }
    }
  }
  for (const d of dirs) placeFiles(d, slots);
  const out: SavedLayout = { v: 1, dirs: {}, files: {} };
  for (const d of dirs) out.dirs[d.path] = { x: d.x, y: d.y, cols: d.cols, rows: d.rows };
  for (const [p, s] of slots) out.files[p] = s;
  return { saved: out };
}

/** The bounding box of everything laid out, with room for labels. */
export function bounds(root: DirNode): Rect {
  const ds = all(root);
  const x = Math.min(...ds.map(d => d.x)),
    y = Math.min(...ds.map(d => d.y)) - LABEL;
  return { x, y, w: Math.max(...ds.map(d => d.x + d.w)) - x, h: Math.max(...ds.map(d => d.y + d.h)) - y };
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/**
 * Carries places across renames (new path to old, lib/renames.ts): a renamed file takes its old slot, and a folder
 * renamed as a whole takes the old folder's place, its files their slots. Only where the new path has no place
 * yet, and a folder only once nothing is left in the old one (`present`: every path on the map now).
 */
export function carryRenames(
  saved: SavedLayout | null,
  renames: Map<string, string>,
  present: Set<string>,
): SavedLayout | null {
  if (!saved || !renames.size) return saved;
  const out: SavedLayout = { v: 1, dirs: { ...saved.dirs }, files: { ...saved.files } };
  // Each folder a file moved out of, and where to, matched from the deepest folder up: lib/old/x → lib/new/x
  // also moves lib/old to lib/new.
  const moves = new Map<string, Set<string>>();
  for (const [to, from] of renames) {
    let a = dirOf(from),
      b = dirOf(to);
    while (a !== b) {
      if (!moves.has(a)) moves.set(a, new Set());
      moves.get(a)!.add(b);
      if (a.slice(a.lastIndexOf('/') + 1) !== b.slice(b.lastIndexOf('/') + 1)) break;
      a = dirOf(a);
      b = dirOf(b);
    }
  }
  const emptied = (d: string) => ![...present].some(p => p.startsWith(d + '/'));
  const carried = new Set<string>();
  for (const [from, to] of moves) {
    const target = [...to][0]!;
    if (to.size === 1 && saved.dirs[from] && !saved.dirs[target] && emptied(from)) {
      out.dirs[target] = saved.dirs[from];
      carried.add(from);
    }
  }
  for (const [to, from] of renames)
    if (out.files[to] === undefined && saved.files[from] !== undefined)
      if (dirOf(from) === dirOf(to) || carried.has(dirOf(from))) out.files[to] = saved.files[from];
  return out;
}
