import { describe, expect, it } from 'vitest';
import { renamesOf } from '../../src/lib/renames';

const lines = (n: number, tag = '') => Array.from({ length: n }, (_, i) => `line ${i}${tag}`);
const gone = (path: string, pre: string[]) => ({ path, created: false, deleted: true, pre, hunks: [] });
const made = (path: string, text: string[]) => ({
  path,
  created: true,
  deleted: false,
  pre: [],
  hunks: [{ add: text }],
});

describe('renamesOf', () => {
  it('pairs a file deleted and created with the same text', () => {
    expect(renamesOf([gone('src/auth.ts', lines(10)), made('src/session.ts', lines(10))])).toEqual(
      new Map([['src/session.ts', 'src/auth.ts']]),
    );
  });
  it('pairs one edited on the way when it keeps at least half its lines, and not below', () => {
    const edited = [...lines(6), ...lines(4, ' changed')];
    expect(renamesOf([gone('a.ts', lines(10)), made('b.ts', edited)]).get('b.ts')).toBe('a.ts');
    const mostly = [...lines(4), ...lines(6, ' changed')];
    expect(renamesOf([gone('a.ts', lines(10)), made('b.ts', mostly)]).size).toBe(0);
  });
  it('pairs one to one, closest first, and leaves a tie unpaired', () => {
    const near = [...lines(9), 'other'];
    const r = renamesOf([gone('a.ts', lines(10)), made('b.ts', lines(10)), made('c.ts', near)]);
    expect(r).toEqual(new Map([['b.ts', 'a.ts']]));
    const tie = renamesOf([gone('a.ts', lines(10)), made('b.ts', lines(10)), made('c.ts', lines(10))]);
    expect(tie.size).toBe(0);
  });
  it('finds a folder renamed as a whole, file by file', () => {
    const r = renamesOf([
      gone('lib/old/x.ts', lines(5, 'x')),
      gone('lib/old/y.ts', lines(5, 'y')),
      made('lib/new/x.ts', lines(5, 'x')),
      made('lib/new/y.ts', lines(5, 'y')),
    ]);
    expect(r).toEqual(
      new Map([
        ['lib/new/x.ts', 'lib/old/x.ts'],
        ['lib/new/y.ts', 'lib/old/y.ts'],
      ]),
    );
  });
  it('never pairs empty files', () => {
    expect(renamesOf([gone('a.ts', []), made('b.ts', [])]).size).toBe(0);
  });
});
