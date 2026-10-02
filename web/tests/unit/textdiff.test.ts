import { describe, expect, it } from 'vitest';
import { changedBlock } from '../../src/lib/textdiff';
import { applyHunks } from '../../src/lib/model';

describe('changedBlock', () => {
  const cases: [string[], string[]][] = [
    [
      ['a', 'b', 'c'],
      ['a', 'x', 'c'],
    ],
    [
      ['a', 'b', 'c'],
      ['a', 'b', 'c', 'd'],
    ],
    [
      ['a', 'b', 'c'],
      ['b', 'c'],
    ],
    [[], ['a']],
    [
      ['a', 'a', 'a'],
      ['a', 'a'],
    ],
    [
      ['x', 'a', 'b'],
      ['a', 'b', 'y'],
    ],
  ];
  it.each(cases)('rebuilds the new version from %j to %j', (a, b) => {
    const h = changedBlock(a, b)!;
    expect(applyHunks(a, [h])).toEqual(b);
  });
  it('finds nothing when the versions match', () => {
    expect(changedBlock(['a'], ['a'])).toBeNull();
  });
  it('keeps the shared lines out of the hunk', () => {
    expect(changedBlock(['a', 'b', 'c', 'd'], ['a', 'B', 'c', 'd'])).toEqual({ at: 1, del: 1, add: ['B'] });
  });
});
