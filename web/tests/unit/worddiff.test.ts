import { describe, expect, it } from 'vitest';
import { markWords } from '../../src/lib/highlight';
import { diffRows } from '../../src/lib/model';
import { wordDiff, wrapCount } from '../../src/lib/worddiff';

const slices = (s: string, r: [number, number][]) => r.map(([a, b]) => s.slice(a, b));

describe('wordDiff', () => {
  it('marks only the words that changed', () => {
    const a = '    return {"status": "ok", "service": "averroes"}';
    const b = '    return {"status": "ok", "service": "averroes", "version": app.version}';
    const d = wordDiff(a, b)!;
    expect(slices(a, d.a)).toEqual([]);
    expect(slices(b, d.b)).toEqual([', "version": app.version']);
  });
  it('marks a changed type on both sides', () => {
    const a = 'export async function healthCheck(): Promise<{ status: string }> {';
    const b = 'export async function healthCheck(): Promise<{ status: string; service: string; version: string }> {';
    const d = wordDiff(a, b)!;
    expect(slices(b, d.b)).toEqual(['; service: string; version: string']);
  });
  it('gives up on unrelated lines', () => {
    expect(wordDiff('const a = 1;', 'return fetchEverything(url, options);')).toBeNull();
  });
});

describe('wrapCount', () => {
  it('counts one line when it fits, and breaks at spaces otherwise', () => {
    expect(wrapCount('short line', 56)).toBe(1);
    expect(wrapCount('aaaa bbbb cccc', 9)).toBe(2);
    expect(wrapCount('x'.repeat(130), 56)).toBe(3);
  });
});

describe('diffRows with word marks', () => {
  it('pairs removed and added lines within a hunk', () => {
    const rows = diffRows(['keep', 'const x = 1;'], [{ at: 1, del: 1, add: ['const x = 2;'] }]);
    expect(rows.map(r => [r.k, r.wd])).toEqual([
      ['', undefined],
      ['del', [[10, 11]]],
      ['add', [[10, 11]]],
    ]);
  });
});

describe('markWords', () => {
  it('splits highlighted tokens at changed ranges', () => {
    const toks = [
      { c: 'k' as const, t: 'return' },
      { c: null, t: ' x + y' },
    ];
    expect(markWords(toks, [[5, 8]])).toEqual([
      { c: 'k', t: 'retur' },
      { c: 'k', t: 'n', w: true },
      { c: null, t: ' x', w: true },
      { c: null, t: ' + y' },
    ]);
  });
});
