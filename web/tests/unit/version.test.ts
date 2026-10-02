import { describe, expect, it } from 'vitest';
import { MIN_BRIDGE, olderThan } from '../../src/lib/constants';
import pkg from '../../../package.json';

describe('olderThan (the update banner)', () => {
  it('compares each part as a number', () => {
    expect(olderThan('0.0.9', '0.1.0')).toBe(true);
    expect(olderThan('0.9.0', '0.10.0')).toBe(true);
    expect(olderThan('0.10.0', '0.9.0')).toBe(false);
    expect(olderThan('1.0.0', '0.1.0')).toBe(false);
    expect(olderThan('0.1.0', '0.1.0')).toBe(false);
  });
  it('treats a bridge that sends no version as old', () => {
    expect(olderThan(null, '0.1.0')).toBe(true);
  });
  it('accepts the bridge this repo builds', () => {
    expect(olderThan(pkg.version, MIN_BRIDGE)).toBe(false);
  });
});
