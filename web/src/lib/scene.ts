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
import { union } from './camera';
import { area, overlaps } from './sections';
import { ended, endedAs, sessionColour, workingRuns } from '../state/sessions';
import { obstacles, pathOf, route, type Rect } from './route';
import { allDirs, dirStat, filesUnder, linesAt, viewOf } from './model';
import { momentOf, readOnly } from './live';
import type { DirNode, FileView, RowKind } from './types';
import { authorsOf, shareOf, type Author } from './attribution';
import { t, tn } from '../i18n';

/** A file zoomed out: a tile in its card's slot, with its name and its changed lines marked. */
export interface TileData {
  path: string;
  name: string;
  kind: FileKind;
  cls: string;
  /** Selected: kept apart from cls so a selection change replaces only the tiles it touches (reselect). */
  sel: boolean;
  x: number;
  y: number;
  /** Changed lines, by tick row. */
  ticks: { k: RowKind; row: number }[];
  /** Coloured by author: the share of the file's lines each wrote. */
  share: Record<Author, number> | null;
}
export interface FrameData {
  path: string;
  name: string;
  note: string;
  cls: string;
  sel: boolean;
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
  /** Coloured by author: who wrote the line, and its line number, to show its run when clicked. */
  au: Author | null;
  ln: number | null;
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
      /** In a run that renamed the file, its old name. */
      from: string | null;
      /** The step of the open run's timeline it is shown at, if one is picked. */
      at: number | null;
      /** Its lines are on their way (a large map). */
      loading: boolean;
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

/** A section a session works on, in the session's colour; the first of a session's sections names it. */
export interface ZoneBox {
  run: number;
  file: boolean;
  /** A session that ended without finishing: its section, free again, marked with how it ended. */
  ended: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  colour: string;
  label: string | null;
}

export interface SceneData {
  frames: FrameData[];
  tiles: TileData[];
  cards: CardData[];
  wires: WireData[];
  sels: SelBox[];
  zones: ZoneBox[];
}

export let scene: SceneData | null = null;
/** Each file's card as last built, with what it showed: reused while that is unchanged. */
const cards = new Map<string, { key: string; card: CardData }>();
/** The previous objects for the same files or folders where nothing in them changed, so memoized components skip them. */
function same<T extends { path: string }>(prev: T[] | undefined, next: T[]): T[] {
  if (!prev) return next;
  const old = new Map(prev.map(p => [p.path, p]));
  return next.map(n => {
    const o = old.get(n.path);
    return o && JSON.stringify(o) === JSON.stringify(n) ? o : n;
  });
}
/** Each file's view when the scene was computed: a selection change reuses them. */
let views = new Map<string, FileView>();

/** Tick rows a tile has room for, 4 world pixels each (05-canvas.css `.fr .tk i`). */
const ROWS = 60;
/** Changed lines as tick rows, one tick per row and kind: a file longer than ROWS lines folds several into a row. */
function ticksOf(v: FileView): TileData['ticks'] {
  const per = Math.max(1, Math.ceil(v.rows.length / ROWS));
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
  views = new Map<string, FileView>();
  for (const f of S.FILES.values()) views.set(f.path, viewOf(f));
  // Coloured by author: who wrote each line of the files as they are now.
  const byAuthor = st.byAuthor && !run;
  S.AUTHORS = byAuthor
    ? authorsOf(
        S.RUNS,
        new Map([...views].filter(([, v]) => v.exists).map(([p, v]) => [p, v.lines])),
        S.RECORDED,
        (r, p) => linesAt(S.FILES.get(p)!, S.RUNS.indexOf(r)).L,
      )
    : new Map();
  const out: SceneData = { frames: [], tiles: [], cards: [], wires: [], sels: [], zones: zonesOf() };
  // With a run open, the files it only read: shown with its changes, the places it looked at.
  const read = run ? readOnly(run.id) : null;
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
        run && st.cur === f.path ? 'cur' : '',
        drafts.has(f.path) ? 'dirty' : '',
        read?.has(f.path) ? 'read' : '',
      ].join(' ');
      out.tiles.push({
        path: f.path,
        name: f.name,
        kind: fileKind(f.name),
        cls,
        sel: st.sel.has(f.path),
        x: f.x,
        y: f.y,
        ticks: !v.ghost && v.kind ? ticksOf(v) : [],
        share: byAuthor ? shareOf(S.AUTHORS.get(f.path) ?? []) : null,
      });
      count++;
    }
    const empty = !d.files.length;
    out.frames.push({
      path: d.path,
      name: d.name,
      note: d.note,
      cls: `frame${empty ? ' bare' : ''}${empty && !d.dirs.length ? ' leaf' : ''}${ds ? ' hot' : ''}`,
      x: d.x,
      y: d.y,
      w: d.w,
      h: d.h,
      sel: st.sel.has('d:' + d.path),
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
  }

  for (const f of S.FILES.values()) {
    const v = views.get(f.path)!;
    if (!v.exists && !v.ghost) continue;
    // Live, the bridge sends a file's first 400 lines; its length is the real one.
    const beyond = beyondOf(f.path, v);
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
    const cls = [
      'card',
      drafts.has(f.path) ? 'dirty' : '',
      v.kind ? 'k-' + v.kind : '',
      run && st.cur === f.path ? 'cur' : '',
    ].join(' ');
    const from = run?.changes.get(f.path)?.renamedFrom?.split('/').pop() ?? null;
    const at = momentOf(f.path)?.i ?? null;
    // On a large map, a file whose lines haven't come yet (api/live.ts wantHeads).
    const loading = S.HEADLESS.has(f.path);
    // A card that shows what it showed last time is the same object: memoized, it isn't highlighted or drawn again.
    const key = byAuthor
      ? null
      : JSON.stringify([
          f.x,
          f.y,
          cls,
          from,
          at,
          loading,
          v.kind && [v.a, v.d],
          start,
          rest,
          slice.map(r => [r.k, r.n, r.t, r.wd]),
        ]);
    const cached = key && cards.get(f.path);
    if (cached && cached.key === key) {
      out.cards.push(cached.card);
      continue;
    }
    const ids = new Map<string, number>();
    const lineId = (k: RowKind, t: string) => {
      const base = k + '|' + t,
        n = ids.get(base) ?? 0;
      ids.set(base, n + 1);
      return base + '|' + n;
    };
    const card: CardData = {
      ghost: false,
      path: f.path,
      name: f.name,
      x: f.x,
      y: f.y,
      cls,
      stat: v.kind ? { a: v.a!, d: v.d! } : null,
      from,
      at,
      above: start,
      rows: slice.map(r => ({
        id: lineId(r.k, r.t || ''),
        k: r.k,
        gutter: r.k === 'add' ? '+' : r.k === 'del' ? '−' : String(r.n),
        tokens: markWords(hl(r.t || ' '), r.wd),
        au: byAuthor && r.n ? (S.AUTHORS.get(f.path)?.[r.n - 1]?.author ?? null) : null,
        ln: byAuthor && r.n ? r.n : null,
      })),
      rest,
      empty: !rows.length && !loading,
      loading,
      imports: 0,
      usedBy: 0,
    };
    if (key) cards.set(f.path, { key, card });
    out.cards.push(card);
  }
  for (const f of S.FILES.values()) {
    const v = views.get(f.path)!;
    if (!v.exists) continue;
    const outs = imports(f.path, v.lines);
    S.GRAPH.out.set(f.path, outs);
    for (const to of outs) {
      if (!S.GRAPH.in.has(to)) S.GRAPH.in.set(to, []);
      S.GRAPH.in.get(to)!.push(f.path);
    }
  }
  // Import counts are set on a copy when they changed: a card handed to React is never changed in place.
  out.cards = out.cards.map(c => {
    if (c.ghost) return c;
    const imports = S.GRAPH.out.get(c.path)?.length ?? 0,
      usedBy = S.GRAPH.in.get(c.path)?.length ?? 0;
    if (c.imports === imports && c.usedBy === usedBy) return c;
    const copy = { ...c, imports, usedBy };
    const cached = cards.get(c.path);
    if (cached?.card === c) cached.card = copy;
    return copy;
  });
  out.tiles = same(scene?.tiles, out.tiles);
  out.frames = same(scene?.frames, out.frames);
  out.sels = selsOf();
  scene = out;
  return out;
}

/** Lines past the 400 the bridge sends: live, a file's length is the real one. */
const beyondOf = (path: string, v: FileView) => (st.run ? 0 : Math.max(0, (S.TOTALS.get(path) ?? 0) - v.rows.length));

/** A box around each selected file and folder, labelled with its size. */
function selsOf(): SelBox[] {
  const out: SelBox[] = [];
  for (const k of st.sel) {
    if (k.startsWith('d:')) {
      const d = S.DIRMAP.get(k.slice(2));
      if (!d?.files.length) continue;
      const n = filesUnder(d).filter(f => views.get(f.path)?.exists).length;
      out.push({ file: false, x: d.x, y: d.y, w: d.w, h: d.h, label: tn(n, '{n} file', '{n} files') });
      continue;
    }
    const f = S.FILES.get(k),
      v = views.get(k);
    if (!f || !v || (!v.exists && !v.ghost)) continue;
    out.push({
      file: true,
      x: f.x,
      y: f.y,
      w: CW,
      h: CH,
      label: v.ghost
        ? t('not created yet')
        : tn((v.rows.filter(r => r.k !== 'del').length || v.rows.length) + beyondOf(k, v), '{n} line', '{n} lines'),
    });
  }
  return out;
}

/** Around a folder and every folder in it that has files: all a session on the folder may change. */
const folderBox = (d: DirNode) =>
  union(allDirs().filter(x => x === d || (x.files.length && (!d.path || x.path.startsWith(d.path + '/')))));

/** The sections of the sessions at work: a box around each folder or file, the whole map for the repository. */
function zonesOf(): ZoneBox[] {
  const out: ZoneBox[] = [];
  const working = workingRuns();
  // An ended session's mark goes once another session works on its section.
  for (const id of ended) {
    const r = S.RUNS.find(x => x.id === id);
    if (!r || working.some(w => (w.scope ?? []).some(a => (r.scope ?? []).some(b => overlaps(a, b))))) ended.delete(id);
  }
  const shown = [...working, ...S.RUNS.filter(r => ended.has(r.id))];
  for (const run of shown) {
    const how = ended.has(run.id) ? endedAs(run) : null;
    const colour = how ? 'var(--ink3)' : sessionColour(run);
    const name = t('Run {id} · {agent}', { id: run.id, agent: agentOf(run.agent).name });
    let label: string | null = how ? `${name} · ${how}` : name;
    for (const entry of run.scope?.length ? run.scope : ['/']) {
      const p = area(entry);
      const at = p.endsWith('/') ? S.DIRMAP.get(p.slice(0, -1)) : S.FILES.get(p);
      if (!at) continue;
      const file = at.type !== 'dir';
      out.push({
        run: run.id,
        file,
        ended: !!how,
        colour,
        label,
        ...(file ? { x: at.x, y: at.y, w: CW, h: CH } : folderBox(at)),
      });
      label = null;
    }
  }
  return out;
}

/**
 * A selection change, without computing the scene again: new objects only for the tiles and frames whose
 * selection changed, and new selection boxes. Everything else keeps its object, so memoized components skip it.
 */
export function reselect(): SceneData {
  if (!scene) return computeScene();
  const tiles = scene.tiles.map(t => (t.sel === st.sel.has(t.path) ? t : { ...t, sel: !t.sel }));
  const frames = scene.frames.map(f => (f.sel === st.sel.has('d:' + f.path) ? f : { ...f, sel: !f.sel }));
  scene = { ...scene, tiles, frames, sels: selsOf() };
  return scene;
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
