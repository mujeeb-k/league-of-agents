// The map fills the canvas, adding files and folders moves nothing, and
// subfolders sit next to their parent.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CH, COLGAP, CW, GAP, PAD } from '../../src/lib/constants';
import { LABEL, bounds, layoutTree, pickCols } from '../../src/lib/layout';
import { buildModel, specFromPaths } from '../../src/lib/model';
import type { DirNode } from '../../src/lib/types';
import { S } from '../../src/state/app';
import { SAMPLE_RUNS, SAMPLE_TREE } from '../../src/demo/sample';
import { SAMPLE_TEXT } from '../../src/demo/sampleText';
import { parseSample } from '../../src/lib/model';

/** A repo of n files spread over nested folders, like a real project. */
function generated(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `src/area${i % 7}/part${(i >> 3) % 9}/mod${i % 4}/file${i}.ts`);
}
const averroes = fs
  .readFileSync(path.join(__dirname, '../../../tests/fixtures/averroes-paths.txt'), 'utf8')
  .trim()
  .split('\n');

const build = (paths: string[]) => {
  buildModel(specFromPaths('repo', paths), {}, []);
  return S.ROOT!;
};
const all = (d: DirNode): DirNode[] => [d, ...d.dirs.flatMap(all)];
const positions = () => new Map([...S.FILES.values()].map(f => [f.path, `${f.x},${f.y}`]));

/** The app's fit: the scale that fits the map in the canvas, at most 1 (camera.ts fitView). */
function fill(root: DirNode, canvas: { w: number; h: number }) {
  const b = bounds(root);
  const s = Math.min(1, (canvas.w - 60) / b.w, (canvas.h - 60) / b.h);
  return { w: (b.w * s) / canvas.w, h: (b.h * s) / canvas.h };
}

describe('pickCols', () => {
  it('always leaves a free slot', () => {
    for (let n = 1; n <= 60; n++)
      for (const t of [1, 2, 3, 4, 6]) {
        const { cols, rows } = pickCols(n, t);
        expect(cols * rows).toBeGreaterThan(n);
      }
  });
});

describe('layout', () => {
  // Requirement 1: the visible canvas at 1440×900, 1280×800 and 1920×1080 with the sidebar showing.
  const canvases = [
    { w: 876, h: 756 },
    { w: 716, h: 656 },
    { w: 1356, h: 936 },
  ];
  it.each([10, 100, 1000])('fills at least 80%% of the canvas in one dimension at fit-all: %i files', n => {
    for (const c of canvases) {
      const root = build(generated(n));
      layoutTree(root, null, c);
      const f = fill(root, c);
      expect(Math.max(f.w, f.h), JSON.stringify({ n, c, f })).toBeGreaterThanOrEqual(0.8);
      // And the map's shape is close to the canvas's, so it is not a sliver that fills one dimension only.
      expect(Math.min(f.w, f.h) / Math.max(f.w, f.h), JSON.stringify({ n, c, f })).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('fills the canvas for the demo and averroes-public too', () => {
    for (const paths of [averroes]) {
      const root = build(paths);
      layoutTree(root, null, canvases[0]!);
      const f = fill(root, canvases[0]!);
      expect(Math.max(f.w, f.h)).toBeGreaterThanOrEqual(0.8);
    }
    buildModel(SAMPLE_TREE, parseSample(SAMPLE_TEXT), SAMPLE_RUNS);
    layoutTree(S.ROOT!, null, canvases[0]!);
    const f = fill(S.ROOT!, canvases[0]!);
    expect(Math.max(f.w, f.h)).toBeGreaterThanOrEqual(0.8);
  });

  it('never overlaps two frames or a frame and a label', () => {
    for (const paths of [generated(1000), averroes]) {
      const root = build(paths);
      layoutTree(root, null, canvases[0]!);
      const rects = all(root).map(d => ({ p: d.path, x: d.x, y: d.y - LABEL, w: d.w, h: d.h + LABEL }));
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++) {
          const [a, b] = [rects[i]!, rects[j]!];
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${a.p} and ${b.p}`).toBe(false);
        }
    }
  });

  // Requirement 2.
  it('adding files moves no existing file, while a folder has a free slot and once it is full', () => {
    const paths = generated(200);
    let root = build(paths);
    let saved = layoutTree(root, null, canvases[0]!).saved;
    const before = positions();
    const folder = 'src/area0/part0/mod0';
    const added = Array.from({ length: 6 }, (_, i) => `${folder}/added${i}.ts`);
    for (let k = 1; k <= added.length; k++) {
      root = build([...paths, ...added.slice(0, k)]);
      saved = layoutTree(root, saved, canvases[0]!).saved;
      const now = positions();
      for (const [p, xy] of before) expect(now.get(p), `${p} after adding ${k}`).toBe(xy);
    }
  });

  it('a new folder goes at a free place and moves nothing', () => {
    const paths = generated(120);
    let root = build(paths);
    const { saved } = layoutTree(root, null, canvases[0]!);
    const before = positions();
    root = build([...paths, 'src/area1/brand-new/deeper/x.ts', 'docs/new-guide.md']);
    const r = layoutTree(root, saved, canvases[0]!);
    const now = positions();
    for (const [p, xy] of before) expect(now.get(p)).toBe(xy);
    expect(r.crowded).toBe(false);
    for (const p of ['src/area1/brand-new/deeper/x.ts', 'docs/new-guide.md']) expect(now.get(p)).toBeDefined();
  });

  it('a removed file leaves a gap; the others stay', () => {
    const paths = generated(80);
    let root = build(paths);
    const { saved } = layoutTree(root, null, canvases[0]!);
    const before = positions();
    root = build(paths.filter(p => p !== paths[3]));
    layoutTree(root, saved, canvases[0]!);
    const now = positions();
    for (const [p, xy] of before) if (p !== paths[3]) expect(now.get(p)).toBe(xy);
  });

  // Requirement 5.
  it('puts every subfolder next to its parent, in averroes-public and in a deep Next.js tree', () => {
    const nextShape = [
      'frontend/app/layout.tsx',
      'frontend/app/page.tsx',
      'frontend/app/c/page.tsx',
      'frontend/app/c/[id]/page.tsx',
      'frontend/app/c/[id]/edit/page.tsx',
      'frontend/app/api/health/route.ts',
      'frontend/app/api/chat/[id]/route.ts',
      ...generated(300).map(p => 'frontend/' + p),
    ];
    for (const paths of [averroes, nextShape]) {
      const root = build(paths);
      layoutTree(root, null, canvases[0]!);
      // Subfolders sit in columns to the right of their folder, packed tight: the first column starts one gap
      // after the folder's frame, and each next column one gap after the widest subtree of the column before.
      const right = (d: DirNode): number => Math.max(d.x + d.w, ...d.dirs.map(right));
      for (const d of all(root)) {
        const xs = [...new Set(d.dirs.map(c => c.x))].sort((a, b) => a - b);
        let expected = d.x + d.w + COLGAP;
        for (const x of xs) {
          expect(x, `a column of ${d.path || 'the root'}'s subfolders`).toBe(expected);
          const column = d.dirs.filter(c => c.x === x);
          for (const c of column) expect(c.y).toBeGreaterThanOrEqual(d.y);
          expected = Math.max(...column.map(right)) + COLGAP;
        }
      }
    }
  });

  it('places files on their folder grid', () => {
    const root = build(generated(30));
    layoutTree(root, null, canvases[0]!);
    for (const d of all(root))
      for (const f of d.files) {
        expect((f.x - d.x - PAD) % (CW + GAP)).toBe(0);
        expect((f.y - d.y - PAD) % (CH + GAP)).toBe(0);
      }
  });
});
