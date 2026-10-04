import { describe, expect, it } from 'vitest';
import { anchorAt, grown, relocate, toLines } from '../../src/lib/anchor';

const file = [
  'type P = {};',
  '',
  'function load() {',
  '  return 1;',
  '}',
  '',
  'function check() {',
  '  if (x) throw e;',
  '}',
];
const selected = file.slice(2, 5); // lines 3–5
const twin = ['', '// kept for the old console', ...selected];

/**
 * Selects lines from..to of `start`, then applies each change as the app does: the selection follows its anchor,
 * which is taken again after every keep or move. Where the lines start after the last change, or null.
 */
function follow(start: string[], [from, to]: [number, number], ...changes: string[][]): number | null {
  let a = anchorAt(start, from, to),
    at: number | null = from;
  for (const now of changes) {
    at = relocate(now, a, at);
    if (at === null) return null;
    a = anchorAt(now, at, at + a.text.length - 1);
  }
  return at;
}

describe('relocate', () => {
  it('keeps the selection where it is while its lines are still there', () => {
    expect(follow(file, [3, 5], file)).toBe(3);
  });
  it('follows the lines when code above them is added or removed', () => {
    expect(follow(file, [3, 5], ['// one', '// two', ...file])).toBe(5);
    expect(follow(file, [3, 5], file.slice(2))).toBe(1);
  });
  it('is stale when the selected lines changed, partly or fully', () => {
    expect(
      follow(
        file,
        [3, 5],
        file.map(l => l.replace('return 1', 'return 2')),
      ),
    ).toBeNull();
    expect(follow(file, [3, 5], [...file.slice(0, 2), ...file.slice(5)])).toBeNull();
  });
  it('matches across Windows line endings', () => {
    expect(follow(file, [3, 5], toLines(file.join('\r\n') + '\r\n'))).toBe(3);
  });
  it('follows code with a copy elsewhere through a rebase, and when the other copy goes', () => {
    expect(follow([...file, ...twin], [3, 5], ['// h1', '// h2', '', ...file, ...twin])).toBe(6);
    expect(follow([...twin.slice(1), '', ...file], [8, 10], file)).toBe(3);
  });
  it('follows when a rebase adds a new copy elsewhere and shifts the code', () => {
    expect(follow(file, [3, 5], ['// h', ...twin, '', ...file])).toBe(10);
  });
  it('never moves to another copy: deleted with a twin, even one with the same lines above', () => {
    expect(follow([...file, ...twin], [3, 5], [...file.slice(0, 2), ...file.slice(5), ...twin])).toBeNull();
    const b = ['}', '', '// x', ...selected, '// y', '}', '', '// x', ...selected, '// z'];
    expect(follow(b, [4, 6], [...b.slice(0, 3), ...b.slice(6)])).toBeNull();
  });
  it('follows the copy that was picked when two copies swap places', () => {
    const one = ['// a', ...selected, '// b', ...selected, '// c'];
    expect(follow(one, [2, 4], ['// b', ...selected, '// a', ...selected, '// c'])).toBe(6);
  });
  it('is stale for twins with identical neighbours once they move', () => {
    const same = ['// a', ...selected, '// a', ...selected, '// a'];
    expect(follow(same, [2, 4], ['// new', ...same])).toBeNull();
  });
  it('follows unique code wherever its one copy is, as a move', () => {
    const edged = ['// new', 'type P = { a: 1 };', '', ...selected, '// note', ...file.slice(6)];
    expect(follow(file, [3, 5], edged)).toBe(4);
    expect(follow(file, [3, 5], [...file.slice(0, 2), ...file.slice(6), '', '// moved here', ...selected])).toBe(8);
    expect(follow(file, [4, 4], [...file.slice(0, 2), ...file.slice(6), '', ...selected])).toBe(8);
  });
  it('takes the anchor again after each change, so edits on each side in turn are followed', () => {
    const above = ['type P = { a: 1 };', ...file.slice(1)];
    const below = [...above.slice(0, 5), '// note', ...above.slice(6)];
    expect(follow(file, [3, 5], above, below, ['// h', ...below])).toBe(4);
  });
  it('is stale when a twin appeared after the selection and then the picked copy went', () => {
    expect(follow(file, [3, 5], [...file, ...twin], [...file.slice(0, 2), ...file.slice(5), ...twin])).toBeNull();
  });
});

describe('toLines', () => {
  it('drops the empty line after a final newline', () => {
    expect(toLines('a\nb\n')).toEqual(['a', 'b']);
    expect(toLines('a\r\nb')).toEqual(['a', 'b']);
  });
});

describe('grown', () => {
  const inside = (at: number, add: string[], remove = 0) => [...file.slice(0, at), ...add, ...file.slice(at + remove)];
  it('takes in lines added inside the selection', () => {
    expect(grown(file, inside(3, ['  const x = 1;', '  log(x);']), [3, 5])).toEqual([3, 7]);
  });
  it('lets go of lines removed inside it, and holds a rewrite of every line', () => {
    expect(grown(file, inside(3, [], 1), [3, 5])).toEqual([3, 4]);
    expect(grown(file, inside(2, ['load = () => 1;'], 3), [3, 5])).toEqual([3, 3]);
  });
  it('is the same range when nothing changed', () => {
    expect(grown(file, file, [3, 5])).toEqual([3, 5]);
  });
  it('is removed when the edit took out every selected line, even with a copy of them elsewhere', () => {
    expect(grown(file, inside(2, [], 3), [3, 5])).toBe('removed');
    const copied = [...file, ...selected];
    expect(grown(copied, [...copied.slice(0, 2), ...copied.slice(5)], [3, 5])).toBe('removed');
  });
  it('is null when a line outside the selection changed', () => {
    expect(grown(file, ['// header', ...file], [3, 5])).toBeNull();
    expect(grown(file, [...file.slice(0, -1), '} // check'], [3, 5])).toBeNull();
  });
});
