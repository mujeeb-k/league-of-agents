// How many files a folder holds, in it and under it (lib/model.ts countUnder): every folder in one pass.
import { describe, expect, it } from 'vitest';
import { countUnder } from '../../src/lib/model';
import { S } from '../../src/state/app';
import type { DirNode, FileNode } from '../../src/lib/types';

const dir = (path: string) => ({ path }) as DirNode;
const files = (...paths: string[]) => new Map(paths.map(p => [p, { path: p } as FileNode]));

describe('files under a folder', () => {
  it('counts each folder with everything under it, and again once the files change', () => {
    S.FILES = files('a/x.ts', 'a/b/y.ts', 'a/b/c/z.ts', 'ab/w.ts', 'top.ts');
    expect([countUnder(dir('')), countUnder(dir('a')), countUnder(dir('a/b')), countUnder(dir('ab'))]).toEqual([
      5, 3, 2, 1,
    ]);
    expect(countUnder(dir('none'))).toBe(0);
    S.FILES = files('a/x.ts');
    expect(countUnder(dir('a'))).toBe(1);
  });
});
