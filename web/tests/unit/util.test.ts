// Times and durations read in the person's language, through Intl.
import { describe, expect, it } from 'vitest';
import { fmtDur, relTime } from '../../src/lib/util';

describe('times', () => {
  it('says how long ago, in words', () => {
    const now = Date.now();
    expect(relTime(now - 10_000)).toBe('Just now');
    expect(relTime(now - 5 * 60_000)).toBe('5 minutes ago');
    expect(relTime(now - 2 * 3_600_000)).toBe('2 hours ago');
  });
  it('says how long a run took', () => {
    expect(fmtDur(1, 1 + 42_000)).toBe('42s');
    expect(fmtDur(1, 1 + 72_000)).toBe('1m 12s');
  });
});
