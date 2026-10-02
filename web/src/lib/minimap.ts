// Minimap and run footprints (small multiples).
import { S, dom, st } from '../state/app';
import { CH, CW } from './constants';
import { allDirs, existsNow } from './model';
import type { Run } from './types';

const css: Record<string, string> = {};
export function readCss() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['surface', 'hair', 'spark', 'sel', 'add', 'mod', 'ink3'])
    css[k] = cs.getPropertyValue('--' + k).trim();
}

export function drawMap(cv: HTMLCanvasElement, run: Run | null | undefined, withView: boolean) {
  if (!S.ROOT) return;
  const WB = S.WB;
  const dpr = devicePixelRatio || 1,
    w = cv.clientWidth,
    h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const c = cv.getContext('2d');
  if (!c) return;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const m = withView ? 10 : 5,
    k = Math.min((w - m * 2) / WB.w, (h - m * 2) / WB.h);
  const ox = (w - WB.w * k) / 2 - WB.x * k,
    oy = (h - WB.h * k) / 2 - WB.y * k;
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
  if (withView) {
    const { x, y, s } = st.v;
    c.strokeStyle = css.sel ?? '';
    c.lineWidth = 1.5;
    c.strokeRect(X(-x / s), Y(-y / s), (dom.stage.clientWidth / s) * k, (dom.stage.clientHeight / s) * k);
  }
  return { k, ox, oy };
}
export const drawMini = () => {
  if (dom.mini) drawMap(dom.mini, st.run, true);
};
