// A large map draws only what is near the view: tiles zoomed out, cards zoomed in. Ten thousand of either switched on
// together as the map zooms across take over a second a frame. A map of fewer than CULL_FROM files draws them all, as
// it always has.
import { S, dom, st } from '../state/app';
import type { Box } from './types';

/** Files from which a map draws only what is near the view: as many as from which the bridge sends no lines. */
export const CULL_FROM = 1500;

export const culling = () => S.FILES.size >= CULL_FROM;

/** The part of the map drawn: the view when it was last drawn, and half the view again around it; and at which zoom. */
let shown: Box | null = null,
  shownNear = false;

/** Whether a file's tile or card is in the part of the map drawn. */
export const drawn = (f: { x: number; y: number }, w: number, h: number) =>
  !!shown && f.x + w >= shown.x && f.y + h >= shown.y && f.x <= shown.x + shown.w && f.y <= shown.y + shown.h;

const inside = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/** After the view moved: whether what is drawn changes, as the view leaves the part last drawn or the zoom crosses. */
export function recull(): boolean {
  if (!culling() || !dom.stage) return false;
  const { x, y, s } = st.v,
    w = dom.stage.clientWidth / s,
    h = dom.stage.clientHeight / s;
  const view = { x: -x / s, y: -y / s, w, h };
  // Kept while the view is inside it, at the same zoom side, and not far smaller (zooming in, the tiles far outside
  // go a few at a time, not all at once as the zoom crosses to cards).
  if (shown && inside(view, shown) && shownNear === !!st.near && shown.w < w * 4) return false;
  shown = { x: view.x - w / 2, y: view.y - h / 2, w: w * 2, h: h * 2 };
  shownNear = !!st.near;
  return true;
}
