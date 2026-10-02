// Import lines routed at right angles through the space between cards and labels, so a line never crosses a
// card or a folder label. A shortest-path search runs over the channel lines just outside every obstacle, with
// a cost for each turn, so lines take few bends. Routes are found only for the focused file's lines, and each
// is cached for the current layout. If no clear route exists, no line is drawn.
import { S } from '../state/app';
import { CH, CW, GAP } from './constants';
import { LABEL } from './layout';
import type { FileNode } from './types';

const MID = GAP / 2;
/** The port sits on the middle of the card header. */
const PORT = 18;
const TURN = 240;

type Pt = [number, number];
export type Rect = { x: number; y: number; w: number; h: number };

/** Everything a line must not cross: every card, and the label strip above every folder frame. */
export function obstacles(): Rect[] {
  const out: Rect[] = [];
  for (const f of S.FILES.values()) out.push({ x: f.x, y: f.y, w: CW, h: CH });
  for (const d of S.DIRMAP.values()) out.push({ x: d.x, y: d.y - LABEL, w: d.w, h: LABEL });
  return out;
}

/** The first index whose value is at least v, in a sorted array. */
function lowerBound(a: number[], v: number) {
  let lo = 0,
    hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m]! < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

class Heap {
  private a: [number, number][] = [];
  push(cost: number, id: number) {
    const a = this.a;
    a.push([cost, id]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]![0] <= a[i]![0]) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): [number, number] | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0]!,
      last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < a.length && a[l]![0] < a[m]![0]) m = l;
        if (r < a.length && a[r]![0] < a[m]![0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

/** A right-angled path from `from` to `to` that stays outside every obstacle, or null. */
function search(from: Pt, to: Pt, obs: Rect[], box: Rect): Pt[] | null {
  const local = obs.filter(o => o.x < box.x + box.w && o.x + o.w > box.x && o.y < box.y + box.h && o.y + o.h > box.y);
  const uniq = (v: number[]) => [...new Set(v.map(n => Math.round(n)))].sort((a, b) => a - b);
  const xs = uniq([from[0], to[0], ...local.flatMap(o => [o.x - MID, o.x + o.w + MID])]).filter(
      x => x >= box.x && x <= box.x + box.w,
    ),
    ys = uniq([from[1], to[1], ...local.flatMap(o => [o.y - MID, o.y + o.h + MID])]).filter(
      y => y >= box.y && y <= box.y + box.h,
    );
  const nx = xs.length,
    ny = ys.length;
  // For each vertical line, the obstacles it passes through, as y-intervals; the same for horizontal lines.
  // One sweep per line marks the blocked nodes and the blocked moves between neighbouring nodes.
  const free = new Uint8Array(nx * ny).fill(1),
    vOpen = new Uint8Array(nx * ny).fill(1),
    hOpen = new Uint8Array(nx * ny).fill(1);
  const sweep = (
    count: number,
    along: number[],
    at: (k: number) => number,
    span: (o: Rect) => [number, number, number, number],
    mark: (k: number, m: number, node: boolean) => void,
  ) => {
    for (let k = 0; k < count; k++) {
      const c = at(k);
      for (const o of local) {
        const [lo, hi, s0, s1] = span(o);
        if (c <= lo || c >= hi) continue;
        // Nodes strictly inside the obstacle, and moves that overlap it.
        let m = lowerBound(along, s0);
        if (m > 0) m--;
        for (; m < along.length && along[m]! < s1; m++) {
          if (along[m]! > s0) mark(k, m, true);
          if (m + 1 < along.length && along[m + 1]! > s0 && along[m]! < s1) mark(k, m, false);
        }
      }
    }
  };
  sweep(
    nx,
    ys,
    i => xs[i]!,
    o => [o.x, o.x + o.w, o.y, o.y + o.h],
    (i, j, node) => (node ? (free[i * ny + j] = 0) : (vOpen[i * ny + j] = 0)),
  );
  sweep(
    ny,
    xs,
    j => ys[j]!,
    o => [o.y, o.y + o.h, o.x, o.x + o.w],
    (j, i, node) => (node ? (free[i * ny + j] = 0) : (hOpen[i * ny + j] = 0)),
  );
  const clearV = (i: number, j: number) => vOpen[i * ny + j] === 1;
  const clearH = (i: number, j: number) => hOpen[i * ny + j] === 1;
  const si = xs.indexOf(Math.round(from[0])),
    sj = ys.indexOf(Math.round(from[1])),
    ti = xs.indexOf(Math.round(to[0])),
    tj = ys.indexOf(Math.round(to[1]));
  if (si < 0 || sj < 0 || ti < 0 || tj < 0) return null;
  // State: node and the direction it was entered from (0 none, 1 horizontal, 2 vertical).
  const n = nx * ny;
  const dist = new Float64Array(n * 3).fill(Infinity),
    prev = new Int32Array(n * 3).fill(-1);
  const heap = new Heap();
  const start = (si * ny + sj) * 3;
  dist[start] = 0;
  heap.push(0, start);
  const h = (i: number, j: number) => Math.abs(xs[i]! - xs[ti]!) + Math.abs(ys[j]! - ys[tj]!);
  let end = -1;
  for (let item = heap.pop(); item; item = heap.pop()) {
    const [, s] = item;
    const node = Math.floor(s / 3),
      dir = s % 3;
    const i = Math.floor(node / ny),
      j = node % ny;
    if (i === ti && j === tj) {
      end = s;
      break;
    }
    const base = dist[s]!;
    const step = (ni: number, nj: number, ndir: number, len: number) => {
      const nn = ni * ny + nj;
      if (!free[nn]) return;
      const c = base + len + (dir && dir !== ndir ? TURN : 0);
      const ns = nn * 3 + ndir;
      if (c < dist[ns]!) {
        dist[ns] = c;
        prev[ns] = s;
        heap.push(c + h(ni, nj), ns);
      }
    };
    if (i + 1 < nx && clearH(i, j)) step(i + 1, j, 1, xs[i + 1]! - xs[i]!);
    if (i > 0 && clearH(i - 1, j)) step(i - 1, j, 1, xs[i]! - xs[i - 1]!);
    if (j + 1 < ny && clearV(i, j)) step(i, j + 1, 2, ys[j + 1]! - ys[j]!);
    if (j > 0 && clearV(i, j - 1)) step(i, j - 1, 2, ys[j]! - ys[j - 1]!);
  }
  if (end < 0) return null;
  const pts: Pt[] = [];
  for (let s = end; s >= 0; s = prev[s]!) {
    const node = Math.floor(s / 3);
    pts.push([xs[Math.floor(node / ny)]!, ys[node % ny]!]);
  }
  return pts.reverse();
}

/** Corner points of the route from card a to card b, ports included, or null if there is no clear route. */
export function route(a: FileNode, b: FileNode, obs: Rect[]): Pt[] | null {
  const ay = a.y + PORT,
    by = b.y + PORT;
  // Leave from the side facing the other card; when they share a column, both use the right side.
  const aRight = b.x >= a.x,
    bLeft = b.x > a.x;
  const pa: Pt = [aRight ? a.x + CW : a.x, ay],
    pb: Pt = [bLeft ? b.x : b.x + CW, by];
  const ea: Pt = [aRight ? a.x + CW + MID : a.x - MID, ay],
    eb: Pt = [bLeft ? b.x - MID : b.x + CW + MID, by];
  const x0 = Math.min(a.x, b.x),
    y0 = Math.min(a.y, b.y),
    x1 = Math.max(a.x, b.x) + CW,
    y1 = Math.max(a.y, b.y) + CH;
  for (const m of [400, 1600, Infinity]) {
    const box =
      m === Infinity
        ? { x: -1e9, y: -1e9, w: 2e9, h: 2e9 }
        : { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
    const path = search(ea, eb, obs, box);
    if (path) return [pa, ...path, pb];
  }
  return null;
}

/** An SVG path through the points, with small rounded corners. */
export function pathOf(pts: Pt[]): string {
  const p = pts.filter((q, i) => i === 0 || q[0] !== pts[i - 1]![0] || q[1] !== pts[i - 1]![1]);
  // Drop points in the middle of straight runs.
  const q = p.filter(
    (pt, i) =>
      i === 0 ||
      i === p.length - 1 ||
      !((pt[0] === p[i - 1]![0] && pt[0] === p[i + 1]![0]) || (pt[1] === p[i - 1]![1] && pt[1] === p[i + 1]![1])),
  );
  let d = `M${q[0]![0]} ${q[0]![1]}`;
  for (let i = 1; i < q.length - 1; i++) {
    const [x0, y0] = q[i - 1]!,
      [x, y] = q[i]!,
      [x1, y1] = q[i + 1]!;
    const r = Math.min(8, Math.hypot(x - x0, y - y0) / 2, Math.hypot(x1 - x, y1 - y) / 2);
    const ux = Math.sign(x - x0),
      uy = Math.sign(y - y0),
      vx = Math.sign(x1 - x),
      vy = Math.sign(y1 - y);
    d += `L${x - ux * r} ${y - uy * r}Q${x} ${y} ${x + vx * r} ${y + vy * r}`;
  }
  const last = q[q.length - 1]!;
  return d + `L${last[0]} ${last[1]}`;
}
