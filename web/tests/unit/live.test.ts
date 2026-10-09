// What a session at work has changed so far, drawn as each edit lands (lib/live.ts): the latest edit of a file wins,
// only while its session works, and not over another run the person opened.
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetEnded, liveChange, setLive } from '../../src/lib/live';
import { S, st } from '../../src/state/app';
import type { Run } from '../../src/lib/types';

describe('edits drawn as they land', () => {
  beforeEach(() => {
    S.WORKING = [7];
    st.run = null;
    forgetEnded();
    S.WORKING = [7];
  });

  it('draws the latest edit of a file against the file as the run found it', () => {
    expect(setLive(7, 2, 'a.ts', ['x', 'y'], ['x', 'y', 'z'])).toBe(true);
    expect(liveChange('a.ts')?.hunks).toEqual([{ at: 2, del: 0, add: ['z'] }]);
    // An earlier edit whose file came back late doesn't replace it.
    expect(setLive(7, 1, 'a.ts', ['x', 'y'], ['x'])).toBe(false);
    expect(liveChange('a.ts')?.hunks).toEqual([{ at: 2, del: 0, add: ['z'] }]);
    // Edited back as it was: nothing to draw.
    setLive(7, 3, 'a.ts', ['x', 'y'], ['x', 'y']);
    expect(liveChange('a.ts')).toBeUndefined();
  });

  it('only while the session works, and not over another run the person opened', () => {
    setLive(7, 0, 'a.ts', [], ['x']);
    st.run = { id: 3 } as Run;
    expect(liveChange('a.ts')).toBeUndefined();
    st.run = { id: 7 } as Run;
    expect(liveChange('a.ts')).toBeDefined();
    S.WORKING = [];
    expect(liveChange('a.ts')).toBeUndefined();
    forgetEnded();
    S.WORKING = [7];
    expect(liveChange('a.ts')).toBeUndefined();
  });
});
