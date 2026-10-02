// Render signals. Each screen region has one render function. Components key their
// content on the region's counter, so a render replaces the region's elements
// (fresh elements, entry animations replay, no stale focus).
import { useSyncExternalStore } from 'react';
import { drawMini } from '../lib/minimap';
import { computeScene } from '../lib/scene';

export type Region =
  'scene' | 'top' | 'side' | 'composer' | 'inspector' | 'conn' | 'crumb' | 'dialog' | 'palette' | 'editor';

const revs: Record<Region, number> = {
  scene: 0,
  top: 0,
  side: 0,
  composer: 0,
  inspector: 0,
  conn: 0,
  crumb: 0,
  dialog: 0,
  palette: 0,
  editor: 0,
};
const subs = new Set<() => void>();

export function bump(r: Region) {
  revs[r]++;
  for (const f of subs) f();
}
export function useRegion(r: Region): number {
  return useSyncExternalStore(
    cb => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    () => revs[r],
  );
}

// Render entry points, one per region.
export function renderScene() {
  computeScene();
  bump('scene');
  drawMini();
}
export const renderTop = () => bump('top');
export const renderSide = () => bump('side');
export const renderComposer = () => bump('composer');
export const renderInspector = () => bump('inspector');
export const setConnUI = () => bump('conn');
export const renderCrumb = () => bump('crumb');
export function renderAll() {
  renderScene();
  renderTop();
  renderSide();
  renderComposer();
  renderInspector();
}
export const renderSel = () => {
  renderScene();
  renderSide();
  renderComposer();
  renderInspector();
};
