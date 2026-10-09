// Folder labels never overlap. Once the zoom settles, labels are placed in screen
// space, most important first: shallower folders, then folders holding more files.
// - Above its frame (code and structure), a label that would cross a placed label or another folder's frame
//   first drops all but its name, then hides.
// - In the overview, tiles show no names, so a folder's label sits inside its block; one that doesn't fit the
//   block or would cross a placed label drops its file count, then hides.
// Labels keep their natural width, so a name is never cut short.
import { S, dom, st } from '../state/app';
import { OVER } from './constants';
import { filesUnder } from './model';
import type { DirNode } from './types';

type Rect = { x: number; y: number; w: number; h: number };
const hits = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const depth = (d: DirNode) => (d.path ? d.path.split('/').length : 0);
/** The inset of an overview label inside its block, on screen (05-canvas.css). */
const INSET = 4;

/**
 * What the labels were last fitted to: the scale, and each folder's and section's class, place, label and spot, as
 * fitted.
 */
let fitted = '';
const labelsNow = (els: Iterable<HTMLElement>) =>
  [st.v.s, ...[...els].map(el => el.className + el.style.cssText + el.dataset.at + el.textContent)].join('\n');

export function fitLabels() {
  if (!dom.world || !S.ROOT) return;
  const s = st.v.s,
    over = s < OVER;
  const els = new Map<string, HTMLElement>();
  for (const el of dom.world.querySelectorAll<HTMLElement>('.frame[data-dir]')) els.set(el.dataset.dir!, el);
  // Sessions' folder sections: their labels are placed after the folders', clear of them (a file's sits in its tile).
  const zones = [...document.querySelectorAll<HTMLElement>('#sels .zone:not(.f)')].filter(z => z.querySelector('b'));
  // Measuring forces layout twice: skipped when nothing a label depends on changed since they were fitted.
  if (labelsNow([...els.values(), ...zones]) === fitted) return;
  const dirs = [...S.DIRMAP.values()].filter(d => els.has(d.path));
  const weight = new Map(dirs.map(d => [d, filesUnder(d).length]));
  dirs.sort((a, b) => depth(a) - depth(b) || weight.get(b)! - weight.get(a)!);
  // Frames that draw a box; folders without files show only their label.
  const frames = dirs
    .filter(d => d.files.length)
    .map(d => ({ d, r: { x: d.x * s, y: d.y * s, w: d.w * s, h: d.h * s } }));
  // Each label is measured with its name only, then in full. Sizes are in world units, so scale them.
  const label = (d: DirNode) => els.get(d.path)!.querySelector<HTMLElement>('.flabel')!;
  const measure = () => new Map(dirs.map(d => [d, { w: label(d).offsetWidth * s, h: label(d).offsetHeight * s }]));
  for (const el of els.values()) {
    el.classList.remove('lh');
    el.classList.add('nn');
  }
  const short = measure();
  for (const el of els.values()) el.classList.remove('nn');
  const full = measure();

  const inside = (d: DirNode) => over && d.files.length > 0;
  const at = (d: DirNode, w: number, h: number): Rect =>
    inside(d) ? { x: d.x * s + INSET, y: d.y * s + INSET, w, h } : { x: d.x * s, y: d.y * s - h, w, h };
  const placed: Rect[] = [];
  const clear = (d: DirNode, r: Rect) =>
    !placed.some(p => hits(r, p)) &&
    (inside(d)
      ? r.w <= d.w * s - 2 * INSET && r.h <= d.h * s - 2 * INSET
      : !frames.some(f => f.d !== d && hits(r, f.r)));
  for (const d of dirs) {
    const el = els.get(d.path)!;
    const tries = [
      { size: full.get(d)!, cls: '' },
      { size: short.get(d)!, cls: 'nn' },
    ];
    const fit = tries.find(t => clear(d, at(d, t.size.w, t.size.h)));
    if (!fit) {
      el.classList.add('lh');
      continue;
    }
    placed.push(at(d, fit.size.w, fit.size.h));
    if (fit.cls) el.classList.add(fit.cls);
  }
  placeZoneLabels(zones, placed, s);
  fitted = labelsNow([...els.values(), ...zones]);
}

/** Space between a section's box and its label, on screen (05-canvas.css .zone b). */
const GAP = 12;
/**
 * Each section's label at the first spot clear of the labels placed so far: above its box's top right corner, below
 * its bottom right corner, else inside that corner.
 */
function placeZoneLabels(zones: HTMLElement[], placed: Rect[], s: number) {
  for (const z of zones) {
    const b = z.querySelector<HTMLElement>('b')!;
    const box = {
      x: parseFloat(z.style.left) * s,
      y: parseFloat(z.style.top) * s,
      w: parseFloat(z.style.width) * s,
      h: parseFloat(z.style.height) * s,
    };
    const w = b.offsetWidth * s,
      h = b.offsetHeight * s,
      right = box.x + box.w - w;
    const spots: [string, Rect][] = [
      ['top', { x: right, y: box.y - GAP - h, w, h }],
      ['bottom', { x: right, y: box.y + box.h + GAP, w, h }],
      ['inside', { x: right - INSET, y: box.y + box.h - h - INSET, w, h }],
    ];
    const [at, r] = spots.find(([, r]) => !placed.some(p => hits(r, p))) ?? spots[2]!;
    z.dataset.at = at;
    placed.push(r);
  }
}
