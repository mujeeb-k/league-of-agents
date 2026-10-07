// A selection change updates only what it touches: the tiles and frames whose selection changed get new
// objects, everything else keeps its object (so memoized components skip it), and the result is the scene a
// full computation would give.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildModel, parseSample } from '../../src/lib/model';
import { computeScene, reselect } from '../../src/lib/scene';
import { S, st } from '../../src/state/app';
import { SAMPLE_RUNS, SAMPLE_TREE } from '../../src/demo/sample';
import { SAMPLE_TEXT } from '../../src/demo/sampleText';

// state/editing registers a page listener when it loads; the scene doesn't need a page.
vi.hoisted(() => Object.assign(globalThis, { addEventListener: () => {} }));

const FILE = 'server/delivery/rate-limit.ts',
  DIR = 'server/delivery/pipeline';

beforeEach(() => {
  buildModel(SAMPLE_TREE, parseSample(SAMPLE_TEXT), SAMPLE_RUNS);
  st.run = S.RUNS[S.RUNS.length - 1]!;
  st.sel.clear();
});

describe('reselect', () => {
  it('replaces only the selected tile, and gives the scene a full computation would', () => {
    const before = computeScene();
    st.sel.add(FILE);
    const after = reselect();
    const changed = after.tiles.filter((t, i) => t !== before.tiles[i]).map(t => t.path);
    expect(changed).toEqual([FILE]);
    expect(after.frames.every((f, i) => f === before.frames[i])).toBe(true);
    expect(after.cards).toBe(before.cards);
    expect(after.wires).toBe(before.wires);
    expect(after.sels).toHaveLength(1);
    expect(after).toEqual(computeScene());
  });

  it('replaces only the selected folder, and puts things back when the selection clears', () => {
    const before = computeScene();
    st.sel.add('d:' + DIR);
    const after = reselect();
    expect(after.frames.filter((f, i) => f !== before.frames[i]).map(f => f.path)).toEqual([DIR]);
    expect(after.tiles.every((t, i) => t === before.tiles[i])).toBe(true);
    expect(after.sels.map(s => s.label)).toEqual(['5 files']);
    st.sel.clear();
    expect(reselect()).toEqual(before);
  });
});
