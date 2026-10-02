import { describe, expect, it } from 'vitest';
import { relocate, toLines } from '../../src/lib/anchor';

const file = ['type P = {};', '', 'function load() {', '  return 1;', '}', '', 'function check() {', '}'];
const selected = file.slice(2, 5); // lines 3–5

describe('relocate', () => {
  it('keeps the selection where it is while its lines are still there', () => {
    expect(relocate(file, selected, 3)).toBe(3);
  });
  it('follows the lines when code above them is added or removed', () => {
    expect(relocate(['// one', '// two', ...file], selected, 3)).toBe(5);
    expect(relocate(file.slice(2), selected, 3)).toBe(1);
  });
  it('is stale when the selected lines changed, partly or fully', () => {
    expect(
      relocate(
        file.map(l => l.replace('return 1', 'return 2')),
        selected,
        3,
      ),
    ).toBeNull();
    expect(relocate([...file.slice(0, 2), ...file.slice(5)], selected, 3)).toBeNull();
  });
  it('is stale when the lines appear more than once and are no longer where they were', () => {
    expect(relocate(['x', ...file], ['}'], 5)).toBeNull();
    expect(relocate(file, ['}'], 5)).toBe(5);
  });
  it('matches across Windows line endings', () => {
    expect(relocate(toLines(file.join('\r\n') + '\r\n'), selected, 3)).toBe(3);
    expect(
      relocate(
        file,
        selected.map(l => l + '\r'),
        3,
      ),
    ).toBe(3);
  });
});

describe('toLines', () => {
  it('drops the empty line after a final newline', () => {
    expect(toLines('a\nb\n')).toEqual(['a', 'b']);
    expect(toLines('a\r\nb')).toEqual(['a', 'b']);
  });
});
