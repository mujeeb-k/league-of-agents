// Import lines never cross a card or a folder label, on the current layout.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { layoutTree } from '../../src/lib/layout';
import { buildModel, parseSample, specFromPaths } from '../../src/lib/model';
import { obstacles, route, type Rect } from '../../src/lib/route';
import { CW } from '../../src/lib/constants';
import type { FileNode } from '../../src/lib/types';
import { S } from '../../src/state/app';
import { SAMPLE_RUNS, SAMPLE_TREE } from '../../src/demo/sample';
import { SAMPLE_TEXT } from '../../src/demo/sampleText';

/** Does the axis-aligned segment pass through the inside of the rectangle? */
function crosses([ax, ay]: number[], [bx, by]: number[], r: Rect) {
  const [x0, x1] = [Math.min(ax!, bx!), Math.max(ax!, bx!)],
    [y0, y1] = [Math.min(ay!, by!), Math.max(ay!, by!)];
  return x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h;
}

function check(pairs: [FileNode, FileNode][]) {
  const obs = obstacles();
  const problems: string[] = [];
  let found = 0;
  for (const [a, b] of pairs) {
    const pts = route(a, b, obs);
    if (!pts) continue;
    found++;
    for (let i = 1; i < pts.length; i++) {
      const [p, q] = [pts[i - 1]!, pts[i]!];
      if (p[0] !== q[0] && p[1] !== q[1]) problems.push(`${a.path} → ${b.path} has a diagonal segment`);
      for (const r of obs) if (crosses(p, q, r)) problems.push(`${a.path} → ${b.path} crosses ${JSON.stringify(r)}`);
    }
  }
  return { found, problems };
}

const canvas = { w: 876, h: 756 };

describe('route', () => {
  it('keeps every line between every pair of demo files clear of cards and labels', () => {
    buildModel(SAMPLE_TREE, parseSample(SAMPLE_TEXT), SAMPLE_RUNS);
    layoutTree(S.ROOT!, null, canvas);
    const files = [...S.FILES.values()];
    const pairs = files.flatMap(a => files.filter(b => b !== a).map(b => [a, b] as [FileNode, FileNode]));
    const { found, problems } = check(pairs);
    expect(pairs.length).toBeGreaterThan(400);
    expect(found).toBe(pairs.length);
    expect(problems.slice(0, 5)).toEqual([]);
  });

  it('does the same on averroes-public and a generated 300-file repo (sampled pairs)', () => {
    const averroes = fs
      .readFileSync(path.join(__dirname, '../../../tests/fixtures/averroes-paths.txt'), 'utf8')
      .trim()
      .split('\n');
    const generated = Array.from({ length: 300 }, (_, i) => `src/a${i % 5}/b${(i >> 2) % 6}/c${i % 3}/f${i}.ts`);
    for (const paths of [averroes, generated]) {
      buildModel(specFromPaths('repo', paths), {}, []);
      layoutTree(S.ROOT!, null, canvas);
      const files = [...S.FILES.values()];
      const pairs: [FileNode, FileNode][] = [];
      for (let i = 0; i < 150; i++) {
        const a = files[(i * 7) % files.length]!,
          b = files[(i * 13 + 5) % files.length]!;
        if (a !== b) pairs.push([a, b]);
      }
      const { found, problems } = check(pairs);
      expect(found).toBe(pairs.length);
      expect(problems.slice(0, 5)).toEqual([]);
    }
  });

  it('starts and ends on the cards’ side edges, level with the header', () => {
    buildModel(SAMPLE_TREE, parseSample(SAMPLE_TEXT), SAMPLE_RUNS);
    layoutTree(S.ROOT!, null, canvas);
    const files = [...S.FILES.values()];
    const [a, b] = [files[0]!, files[files.length - 1]!];
    const pts = route(a, b, obstacles())!;
    expect([a.x, a.x + CW]).toContain(pts[0]![0]);
    expect(pts[0]![1]).toBe(a.y + 18);
    expect([b.x, b.x + CW]).toContain(pts[pts.length - 1]![0]);
    expect(pts[pts.length - 1]![1]).toBe(b.y + 18);
  });
});
