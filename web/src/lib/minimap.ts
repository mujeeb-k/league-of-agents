// Minimap and run footprints (small multiples).
import { S, dom, st } from '../state/app';
import { CH, CW } from './constants';
import { allDirs, existsNow } from './model';
import type { Run } from './types';
import { markers } from '../state/watch';
import { sessionSlot } from '../state/sessions';

const css: Record<string, string> = {};
export function readCss() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of [
    'surface',
    'hair',
    'spark',
    'sel',
    'add',
    'mod',
    'ink3',
    ...[1, 2, 3, 4, 5].map(n => `session-${n}`),
  ])
    css[k] = cs.getPropertyValue('--' + k).trim();
}

/** Where the map sits on a canvas of this size: its scale and offset. */
export function mapGeometry(w: number, h: number, withView: boolean) {
  const WB = S.WB;
  const m = withView ? 10 : 5,
    k = Math.min((w - m * 2) / WB.w, (h - m * 2) / WB.h);
  return { k, ox: (w - WB.w * k) / 2 - WB.x * k, oy: (h - WB.h * k) / 2 - WB.y * k };
}

/** A canvas sized for its box at the screen's pixel ratio, cleared, its context in CSS pixels; null when hidden. */
function prepare(cv: HTMLCanvasElement, w: number, h: number) {
  const dpr = devicePixelRatio || 1;
  if (!w || !h) return null;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const c = cv.getContext('2d');
  if (!c) return null;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  return c;
}

/** The folders (minimap only) and files, with the run's changes marked. */
function paintFiles(c: CanvasRenderingContext2D, w: number, h: number, run: Run | null | undefined, withView: boolean) {
  const { k, ox, oy } = mapGeometry(w, h, withView);
  const X = (x: number) => ox + x * k,
    Y = (y: number) => oy + y * k;
  c.lineWidth = 1;
  c.strokeStyle = css.hair ?? '';
  if (withView)
    for (const d of allDirs())
      c.strokeRect(Math.round(X(d.x)) + 0.5, Math.round(Y(d.y)) + 0.5, Math.max(2, d.w * k), Math.max(2, d.h * k));
  for (const f of S.FILES.values()) {
    const chg = run && run.changes.get(f.path);
    if (!existsNow(f) && !chg) continue;
    c.fillStyle = (chg ? (chg.created ? css.add : css.mod) : css.spark) ?? '';
    c.globalAlpha = run && !chg ? 0.55 : 1;
    const s = chg && !withView ? 2 : 0;
    c.fillRect(X(f.x) - s, Y(f.y) - s, Math.max(1.5, CW * k) + s * 2, Math.max(1.5, CH * k) + s * 2);
  }
  c.globalAlpha = 1;
}

/** A run's footprint: the files, its changes marked. */
export function drawMap(cv: HTMLCanvasElement, run: Run | null | undefined) {
  if (!S.ROOT) return;
  const w = cv.clientWidth,
    h = cv.clientHeight,
    c = prepare(cv, w, h);
  if (c) paintFiles(c, w, h, run, false);
}

/** Where every file is and whether it exists, as one number: computed once for all footprints. */
export function filesPrint() {
  let at = 0;
  for (const f of S.FILES.values()) at = (at * 31 + f.x * 7 + f.y + (existsNow(f) ? 1 : 0)) % 2147483647;
  return at;
}

/**
 * What a run's footprint shows: where each file is and whether it exists, the run's changes, the colours and the
 * canvas size. A footprint whose key is unchanged is left as drawn: state events redraw only those that changed.
 */
export function footprintKey(cv: HTMLCanvasElement, run: Run | null | undefined, at: number) {
  const changes = run ? [...run.changes].map(([p, c]) => `${p}${c.created ? '+' : ''}`).join(',') : '';
  return [run?.id, at, changes, Object.values(css).join(), cv.clientWidth, cv.clientHeight, devicePixelRatio].join('|');
}

/** The minimap's files as last painted, and what they showed: painted again only when that changes. */
let mini: { key: string; image: HTMLCanvasElement } | null = null;

/** The minimap: its files (painted again only when they changed) and the view box, which moves with each pan and zoom. */
export function drawMini() {
  const cv = dom.mini;
  if (!cv || !S.ROOT) return;
  const w = cv.clientWidth,
    h = cv.clientHeight,
    key = footprintKey(cv, st.run, filesPrint());
  if (mini?.key !== key) {
    const image = mini?.image ?? document.createElement('canvas');
    const c = prepare(image, w, h);
    if (!c) return;
    paintFiles(c, w, h, st.run, true);
    mini = { key, image };
  }
  const c = prepare(cv, w, h);
  if (!c) return;
  c.drawImage(mini.image, 0, 0, w, h);
  const { k, ox, oy } = mapGeometry(w, h, true);
  const { x, y, s } = st.v;
  c.strokeStyle = css.sel ?? '';
  c.lineWidth = 1.5;
  c.strokeRect(ox + (-x / s) * k, oy + (-y / s) * k, (dom.stage.clientWidth / s) * k, (dom.stage.clientHeight / s) * k);
  // Where each session at work is: a dot in its colour on its file, over the painted files (state/watch.ts).
  const here = markers();
  for (const { run, at } of here) {
    const f = S.FILES.get(at.file!)!;
    c.fillStyle = css[`session-${sessionSlot(run)}`] ?? '';
    c.beginPath();
    c.arc(ox + (f.x + CW / 2) * k, oy + (f.y + CH / 2) * k, 3.5, 0, Math.PI * 2);
    c.fill();
  }
  cv.dataset.here = here.map(m => `${m.run.id} ${m.at.file}`).join(',');
}
