// Camera. Lives outside React: applyView() writes the world transform directly.
import { S, dom, st } from '../state/app';
import { CH, CW, NEAR, OVER, TIGHT } from './constants';
import { fitLabels } from './labels';
import { applyPanels, endFirstLoad, sideInset, sideVisibleAt } from '../state/panels';
import { drawMini } from './minimap';
import type { Box, FileNode, Run, View } from './types';
import { clamp } from './util';

/*
  Zoom stays at 60 fps on large repos by changing only the transform while the scale is moving. The world is
  promoted to its own layer (.zooming), so the compositor scales the last rendering instead of laying out and
  repainting every row. Once the scale has rested for SETTLE_MS, the zoom-dependent sizes (--s) apply once and
  text renders sharp again. The near/far switch applies at once, so zooming out never shows every code card.
  Jumps pass settle and apply everything at once.
*/
const SETTLE_MS = 150;
let scaled = 0,
  settleTimer = 0;
function applyScale() {
  clearTimeout(settleTimer);
  const s = st.v.s;
  scaled = s;
  dom.world.style.setProperty('--s', String(s));
  dom.world.classList.remove('zooming');
  fitLabels();
}

export function applyView(settle = false) {
  const { x, y, s } = st.v;
  // The hovered tile's name label stays where the tile was; it returns on the next pointer move.
  if (dom.tileName) dom.tileName.hidden = true;
  dom.world.style.transform = `translate(${x}px,${y}px) scale(${s})`;
  const near = s >= NEAR;
  if (near !== st.near) {
    st.near = near;
    dom.world.classList.toggle('near', near);
    applyPanels();
  }
  dom.world.classList.toggle('over', s < OVER);
  dom.world.classList.toggle('tight', s < TIGHT);
  if (s !== scaled) {
    if (settle) applyScale();
    else {
      dom.world.classList.add('zooming');
      clearTimeout(settleTimer);
      settleTimer = window.setTimeout(applyScale, SETTLE_MS);
    }
  }
  const g = s > 0.55;
  dom.stage.classList.toggle('grid', g);
  if (g) {
    dom.stage.style.backgroundSize = `${24 * s}px ${24 * s}px`;
    dom.stage.style.backgroundPosition = `${x}px ${y}px`;
  }
  dom.zPct.textContent = Math.round(s * 100) + '%';
  drawMini();
}
export function zoomAt(px: number, py: number, f: number) {
  endFirstLoad();
  const { x, y, s } = st.v,
    ns = clamp(s * f, 0.04, 2.5);
  const wx = (px - x) / s,
    wy = (py - y) / s;
  st.v = { x: px - wx * ns, y: py - wy * ns, s: ns };
  applyView();
}
/** Space kept free at the top for the canvas hint, and at the bottom for the composer. */
const TOP = 48,
  BOTTOM = 100;
/** The view that fits box b, clear of the sidebar if the sidebar shows at that zoom. */
export function fitView(b: Box, pad = 80, maxS = 1.1): View {
  const W = dom.stage.clientWidth,
    H = dom.stage.clientHeight - TOP - BOTTOM;
  const fit = (inset: number): View => {
    const w = W - inset,
      s = clamp(Math.min((w - pad * 2) / b.w, (H - pad * 2) / b.h), 0.04, maxS);
    return { s, x: inset + w / 2 - (b.x + b.w / 2) * s, y: TOP + H / 2 - (b.y + b.h / 2) * s };
  };
  const v = fit(0);
  return sideVisibleAt(v.s) ? fit(sideInset(v.s)) : v;
}
/** The middle of the part of the canvas the sidebar does not cover. */
export function viewCenter(): [number, number] {
  const inset = sideInset(st.v.s);
  return [inset + (dom.stage.clientWidth - inset) / 2, dom.stage.clientHeight / 2];
}
let anim = 0;
export function flyTo(t: View) {
  endFirstLoad();
  cancelAnimationFrame(anim);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    st.v = t;
    applyView(true);
    return;
  }
  const f = { ...st.v },
    t0 = performance.now(),
    dur = 440;
  const W = dom.stage.clientWidth / 2,
    H = dom.stage.clientHeight / 2;
  const cf = { x: (W - f.x) / f.s, y: (H - f.y) / f.s },
    ct = { x: (W - t.x) / t.s, y: (H - t.y) / t.s };
  const step = (now: number) => {
    const p = clamp((now - t0) / dur, 0, 1),
      e = 1 - Math.pow(1 - p, 4);
    const s = Math.exp(Math.log(f.s) + (Math.log(t.s) - Math.log(f.s)) * e);
    st.v = { s, x: W - (cf.x + (ct.x - cf.x) * e) * s, y: H - (cf.y + (ct.y - cf.y) * e) * s };
    applyView(p === 1);
    if (p < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}
export const fileBox = (f: { x: number; y: number }): Box => ({ x: f.x, y: f.y, w: CW, h: CH });
export const dirBox = (d: Box): Box => ({ x: d.x, y: d.y - 40, w: d.w, h: d.h + 40 });
export function union(bs: Box[]): Box {
  const x = Math.min(...bs.map(b => b.x)),
    y = Math.min(...bs.map(b => b.y));
  return { x, y, w: Math.max(...bs.map(b => b.x + b.w)) - x, h: Math.max(...bs.map(b => b.y + b.h)) - y };
}
// Every zoom the person asks for ends the first-load sidebar before its fit is computed (panels.ts).
export const flyFile = (p: string) => {
  endFirstLoad();
  const f = S.FILES.get(p);
  if (f) flyTo(fitView(fileBox(f), 40, 1.1));
};
export const flyDir = (p: string) => {
  endFirstLoad();
  const d = S.DIRMAP.get(p);
  if (d) flyTo(fitView(dirBox(d), 60, 1));
};
export const flyAll = () => {
  endFirstLoad();
  flyTo(fitView(S.WB, 30, 1));
};
export function flyRun(run: Run) {
  endFirstLoad();
  const bs = [...run.changes.keys()]
    .map(p => S.FILES.get(p))
    .filter(f => !!f)
    .map(fileBox);
  if (!bs.length) return;
  let t = fitView(union(bs), 80, 0.95);
  if (t.s < NEAR) {
    const ds = [...new Set([...run.changes.keys()].map(p => S.FILES.get(p)?.dir).filter(d => !!d))].map(dirBox);
    t = fitView(union(ds), 60, 0.95);
  }
  flyTo(t);
}
/**
 * The zoom at which these files' names read in full: 11 px IBM Plex Mono is 6.6 px a character, plus the
 * icon and padding on a tile, or the change stats in a changed file's card header (05-canvas.css). Very long
 * names (over 24 characters) may still shorten.
 */
function readableScale(files: FileNode[], changed = false) {
  const longest = Math.min(24, Math.max(10, ...files.map(f => f.name.length)));
  const s = ((changed ? 90 : 35) + 6.6 * longest) / CW;
  // Past the structure level, the code level shows full names in its card headers.
  return s < NEAR ? Math.max(s, 0.3) : Math.max(s, NEAR + 0.03);
}

/**
 * The first view of a repository: the whole map, if it fits at a zoom where its
 * names read. Otherwise the latest run's files, or the top-level folders, at such a zoom: fitted if they fit,
 * else from their top-left corner. The minimap shows the rest; "Fit everything" (0) still shows the whole map.
 */
export function openingView(): View {
  const all = fitView(S.WB, 30, 1);
  if (all.s >= readableScale([...S.FILES.values()])) return all;
  const root = S.ROOT!,
    run = S.RUNS[S.RUNS.length - 1];
  const changed = run ? [...run.changes.keys()].map(p => S.FILES.get(p)).filter(f => !!f) : [];
  const top = [root, ...root.dirs];
  const b = union(changed.length ? changed.map(fileBox) : top.map(dirBox));
  const s = changed.length ? readableScale(changed, true) : readableScale(top.flatMap(d => d.files));
  const v = fitView(b, 60, s);
  if (v.s >= s) return v;
  return { s, x: sideInset(s) + 60 - b.x * s, y: TOP + 40 - b.y * s };
}

export function flySelection() {
  endFirstLoad();
  const bs: Box[] = [];
  for (const k of st.sel) {
    if (k.startsWith('d:')) {
      const d = S.DIRMAP.get(k.slice(2));
      if (d) bs.push(dirBox(d));
    } else {
      const f = S.FILES.get(k);
      if (f) bs.push(fileBox(f));
    }
  }
  if (bs.length) flyTo(fitView(union(bs), 60, 1.1));
}
