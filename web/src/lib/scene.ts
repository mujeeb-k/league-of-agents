// Scene data for the canvas, computed for renderScene(). This builds the content as
// data, and components/Canvas renders it into markup.
import { S, st } from '../state/app';
import { agentOf, CH, CODE_COLS, COLGAP, CW, MAXL } from './constants';
import { hl, markWords, type Token } from './highlight';
import { wrapCount } from './worddiff';
import { fileKind, type FileKind } from './fileKind';
import { importResolver } from './imports';
import { LABEL } from './layout';
import { drafts } from '../state/editing';
import { ROWS, textureOf, textureUrl } from './texture';
import { obstacles, pathOf, route, type Rect } from './route';
import { allDirs, dirStat, filesUnder, viewOf } from './model';
import type { FileView, RowKind } from './types';
import { plural } from './util';

/** A file zoomed out: a tile in its card's slot, with its name and the texture of its lines. */
export interface TileData {
  path: string;
  name: string;
  kind: FileKind;
  cls: string;
  x: number;
  y: number;
  /** The texture image; null for a file created later in the run, shown as a ghost. */
  texture: string | null;
  /** Changed lines, by texture row. */
  ticks: { k: RowKind; row: number }[];
}
export interface FrameData {
  path: string;
  name: string;
  note: string;
  cls: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hotc: string | null;
  stat: { a: number; d: number } | null;
  /** Files directly in the folder, shown in the overview. */
  count: number;
}
export interface CodeRow {
  /** Stable across views: the same line keeps its element when switching before, after and diff. */
  id: string;
  k: RowKind;
  gutter: string;
  tokens: Token[];
}
export type CardData =
  | { ghost: true; path: string; name: string; x: number; y: number }
  | {
      ghost: false;
      path: string;
      name: string;
      cls: string;
      x: number;
      y: number;
      stat: { a: number; d: number } | null;
      above: number;
      rows: CodeRow[];
      rest: number;
      empty: boolean;
      imports: number;
      usedBy: number;
    };
export interface WireData {
  d: string;
  hot: boolean;
  color: string | null;
}
export interface SelBox {
  file: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export interface SceneData {
  frames: FrameData[];
  tiles: TileData[];
  cards: CardData[];
  wires: WireData[];
  sels: SelBox[];
}

export let scene: SceneData | null = null;

/** Changed lines as texture rows, one tick per row and kind. */
function ticksOf(v: FileView, per: number): TileData['ticks'] {
  const out: TileData['ticks'] = [],
    seen = new Set<string>();
  v.rows.forEach((r, i) => {
    const row = Math.floor(i / per),
      key = r.k + row;
    if (r.k && !seen.has(key) && row < ROWS) {
      seen.add(key);
      out.push({ k: r.k, row });
    }
  });
  return out;
}

export function computeScene(): SceneData {
  const run = st.run,
    rc = run ? agentOf(run.agent).c : null;
  const views = new Map<string, FileView>();
  for (const f of S.FILES.values()) views.set(f.path, viewOf(f));
  const out: SceneData = { frames: [], tiles: [], cards: [], wires: [], sels: [] };
  // Import lines: between files as they are in the view on screen.
  const imports = importResolver({
    has: p => !!views.get(p)?.exists,
    read: p => (views.get(p)?.exists ? views.get(p)!.lines.join('\n') : null),
  });
  S.GRAPH = { out: new Map(), in: new Map() };

  for (const d of allDirs()) {
    const ds = run && dirStat(run, d);
    let count = 0;
    for (const f of d.files) {
      const v = views.get(f.path)!;
      if (!v.exists && !v.ghost) continue;
      const cls = [
        'fr',
        v.kind ? 'k-' + v.kind : '',
        v.ghost ? 'ghost' : '',
        run && !v.kind ? 'dim' : '',
        st.sel.has(f.path) ? 'sel' : '',
        run && st.cur === f.path ? 'cur' : '',
        drafts.has(f.path) ? 'dirty' : '',
      ].join(' ');
      const tex = v.ghost ? null : textureOf(v.rows);
      out.tiles.push({
        path: f.path,
        name: f.name,
        kind: fileKind(f.name),
        cls,
        x: f.x,
        y: f.y,
        texture: tex && textureUrl(tex),
        ticks: tex && v.kind ? ticksOf(v, tex.per) : [],
      });
      count++;
    }
    const empty = !d.files.length;
    out.frames.push({
      path: d.path,
      name: d.name,
      note: d.note,
      cls: `frame${st.sel.has('d:' + d.path) ? ' sel' : ''}${empty ? ' bare' : ''}${empty && !d.dirs.length ? ' leaf' : ''}${ds ? ' hot' : ''}${run && !ds ? ' dim' : ''}`,
      x: d.x,
      y: d.y,
      w: d.w,
      h: d.h,
      hotc: ds ? rc : null,
      stat: ds && d.path !== '' ? { a: ds.a, d: ds.d } : null,
      count,
    });
    if (d.parent) {
      // Tree lines stay in the gaps the layout keeps empty (layout.ts). A subfolder in the first column beside
      // its parent is reached through the gap between them. One in a later column is reached by a short bus
      // above the columns, then down that column's own gap.
      const p = d.parent,
        x1 = p.x + p.w,
        gap0 = x1 + COLGAP / 2,
        gap = d.x - COLGAP / 2;
      const path =
        gap === gap0
          ? `M${x1} ${p.y}H${gap}V${d.y}H${d.x}`
          : `M${x1} ${p.y}H${gap0}V${p.y - LABEL - 8}H${gap}V${d.y}H${d.x}`;
      out.wires.push({ d: path, hot: !!ds, color: ds ? rc : null });
    }
    if (st.sel.has('d:' + d.path) && !empty) {
      const n = filesUnder(d).filter(f => views.get(f.path)!.exists).length;
      out.sels.push({ file: false, x: d.x, y: d.y, w: d.w, h: d.h, label: plural(n, 'file') });
    }
  }

  for (const f of S.FILES.values()) {
    const v = views.get(f.path)!;
    if (!v.exists && !v.ghost) continue;
    // Live, the bridge sends a file's first 400 lines; its length is the real one.
    const beyond = run ? 0 : Math.max(0, (S.TOTALS.get(f.path) ?? 0) - v.rows.length);
    if (st.sel.has(f.path))
      out.sels.push({
        file: true,
        x: f.x,
        y: f.y,
        w: CW,
        h: CH,
        label: v.ghost
          ? 'not created yet'
          : plural((v.rows.filter(r => r.k !== 'del').length || v.rows.length) + beyond, 'line'),
      });
    if (v.ghost) {
      out.cards.push({ ghost: true, path: f.path, name: f.name, x: f.x, y: f.y });
      continue;
    }
    const rows = v.rows,
      first = rows.findIndex(r => r.k),
      start = first > 6 ? first - 4 : 0;
    // Added and removed lines wrap, so fill the card by visual lines, not rows.
    const slice: typeof rows = [];
    for (let i = start, used = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const h = r.k ? wrapCount(r.t || ' ', CODE_COLS) : 1;
      if (slice.length && used + h > MAXL) break;
      slice.push(r);
      used += h;
    }
    const rest = rows.length - start - slice.length + beyond;
    const ids = new Map<string, number>();
    const lineId = (k: RowKind, t: string) => {
      const base = k + '|' + t,
        n = ids.get(base) ?? 0;
      ids.set(base, n + 1);
      return base + '|' + n;
    };
    out.cards.push({
      ghost: false,
      path: f.path,
      name: f.name,
      x: f.x,
      y: f.y,
      cls: [
        'card',
        drafts.has(f.path) ? 'dirty' : '',
        v.kind ? 'k-' + v.kind : '',
        run && !v.kind ? 'dim' : '',
        run && st.cur === f.path ? 'cur' : '',
      ].join(' '),
      stat: v.kind ? { a: v.a!, d: v.d! } : null,
      above: start,
      rows: slice.map(r => ({
        id: lineId(r.k, r.t || ''),
        k: r.k,
        gutter: r.k === 'add' ? '+' : r.k === 'del' ? '−' : String(r.n),
        tokens: markWords(hl(r.t || ' '), r.wd),
      })),
      rest,
      empty: !rows.length,
      imports: 0,
      usedBy: 0,
    });

    const outs = imports(f.path, v.lines);
    S.GRAPH.out.set(f.path, outs);
    for (const to of outs) {
      if (!S.GRAPH.in.has(to)) S.GRAPH.in.set(to, []);
      S.GRAPH.in.get(to)!.push(f.path);
    }
  }
  for (const c of out.cards)
    if (!c.ghost) {
      c.imports = S.GRAPH.out.get(c.path)?.length ?? 0;
      c.usedBy = S.GRAPH.in.get(c.path)?.length ?? 0;
    }
  scene = out;
  return out;
}

let cache: { rev: number; obs: Rect[]; paths: Map<string, string | null> } | null = null;

/**
 * Draws the import lines of the hovered, selected and current files, and no others. Lines are routed only
 * now, for those files, and cached until the layout changes (route.ts).
 */
export function updateEdgeFocus(links: SVGSVGElement | undefined) {
  if (!links) return;
  const focus = new Set([...st.sel].filter(k => !k.startsWith('d:')));
  if (st.hover) focus.add(st.hover);
  if (st.run && st.cur) focus.add(st.cur);
  if (!cache || cache.rev !== S.LAYOUT_REV) cache = { rev: S.LAYOUT_REV, obs: obstacles(), paths: new Map() };
  const c = cache;
  const pairs = new Set<string>();
  for (const p of focus) {
    for (const to of S.GRAPH.out.get(p) ?? []) pairs.add(p + '>' + to);
    for (const from of S.GRAPH.in.get(p) ?? []) pairs.add(from + '>' + p);
  }
  let svg = '';
  for (const key of pairs) {
    if (!c.paths.has(key)) {
      const [a, b] = key.split('>') as [string, string];
      const fa = S.FILES.get(a),
        fb = S.FILES.get(b);
      const pts = fa && fb ? route(fa, fb, c.obs) : null;
      c.paths.set(key, pts ? pathOf(pts) : null);
    }
    const d = c.paths.get(key);
    if (!d) continue;
    const [a, b] = key.split('>');
    svg += `<path class="edge on" data-a="${esc(a!)}" data-b="${esc(b!)}" d="${d}"/>`;
  }
  links.innerHTML = svg;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
