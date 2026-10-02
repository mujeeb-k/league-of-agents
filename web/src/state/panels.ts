// The sidebar and the inspector around the canvas. The sidebar floats over the canvas, so showing or
// hiding it moves only opacity and position; the canvas never resizes for it. Choices are remembered.
import { NEAR } from '../lib/constants';
import { dom, st } from './app';
import { bump } from './render';

/** Auto steps aside below code zoom, where the canvas itself shows the tree. */
export type SideMode = 'auto' | 'pinned' | 'closed';

const KEY = 'loa.panels';
export const INSP_MIN = 280,
  INSP_MAX = 480;

function load(): { side: SideMode; insp: boolean; inspW: number } {
  const d = { side: 'auto' as SideMode, insp: true, inspW: 316 };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<typeof d>;
    return {
      side: v.side === 'pinned' || v.side === 'closed' ? v.side : d.side,
      insp: v.insp !== false,
      inspW: typeof v.inspW === 'number' ? Math.min(INSP_MAX, Math.max(INSP_MIN, v.inspW)) : d.inspW,
    };
  } catch {
    return d;
  }
}
export const panels = load();
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(panels));
  } catch {
    /* storage blocked: choices last for this visit */
  }
}

const narrow = () => matchMedia('(width < 860px)').matches;
/** In auto mode the sidebar shows on first load, whatever the zoom, until the first zoom, so a first-time visitor sees the files. */
let firstLoad = true;
export function endFirstLoad() {
  if (!firstLoad) return;
  firstLoad = false;
  applyPanels();
}

export const sideVisibleAt = (s: number) =>
  !narrow() && (panels.side === 'pinned' || (panels.side === 'auto' && !st.editing && (firstLoad || s >= NEAR)));

/** Width of the sidebar where it covers the canvas, or 0 when it is out of the way at scale s. */
export const sideInset = (s: number) => (sideVisibleAt(s) ? dom.side.offsetWidth : 0);

let shown: boolean | null = null;
/** Applies the panel state to the page directly, without re-rendering the canvas. */
export function applyPanels() {
  const vis = sideVisibleAt(st.v.s);
  if (vis !== shown) {
    shown = vis;
    dom.side.classList.toggle('away', !vis);
    dom.side.inert = !vis;
    bump('top');
  }
  // Only the layers that move get the variable; setting it on the canvas would restyle every row.
  const inset = vis ? dom.side.offsetWidth + 'px' : '0px';
  for (const el of dom.stage.querySelectorAll<HTMLElement>(':scope > [data-inset]'))
    el.style.setProperty('--inset', inset);
  dom.app.style.setProperty('--insp-w', panels.insp ? panels.inspW + 'px' : '0px');
  dom.insp.inert = !panels.insp;
}

/** `[`: hide a visible sidebar, show a hidden one and keep it. */
export function toggleSide() {
  panels.side = sideVisibleAt(st.v.s) ? 'closed' : 'pinned';
  save();
  applyPanels();
  bump('side');
}
export function setPinned(pinned: boolean) {
  panels.side = pinned ? 'pinned' : 'auto';
  save();
  applyPanels();
  bump('side');
}
/** `]`: show or hide the inspector. */
export function toggleInsp() {
  panels.insp = !panels.insp;
  save();
  applyPanels();
  bump('top');
}
/** Sets the inspector width; while dragging, pass remember = false and save once at the end. */
export function setInspW(w: number, remember = true) {
  panels.inspW = Math.round(Math.min(INSP_MAX, Math.max(INSP_MIN, w)));
  if (remember) save();
  applyPanels();
}
