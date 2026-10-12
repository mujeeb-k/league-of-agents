// The line diff the app draws edits with (lib/textdiff.ts), against git's own diff of the same two texts: a session's
// edits as they land must read as the finished run does, whose changes come from git (bridge computeChanges).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { lineDiff } from '../../src/lib/textdiff';
import { applyHunks } from '../../src/lib/model';
import type { Hunk } from '../../src/lib/types';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loa-textdiff-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** git's hunks for two versions of a file, as the bridge reads them: `git diff -U0`, each `@@` a hunk. */
function gitDiff(a: string[], b: string[]): Hunk[] {
  const [fa, fb] = [path.join(tmp, 'a'), path.join(tmp, 'b')];
  fs.writeFileSync(fa, a.map(l => l + '\n').join(''));
  fs.writeFileSync(fb, b.map(l => l + '\n').join(''));
  // Exit 1 says the files differ.
  const out = spawnSync('git', ['diff', '--no-index', '--no-color', '-U0', fa, fb], { encoding: 'utf8' }).stdout;
  const hunks: Hunk[] = [];
  for (const line of out.split('\n')) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
    // "-N,0" names the line an addition comes after; "-N,k" the first line removed.
    if (m) hunks.push({ at: m[2] === '0' ? +m[1]! : +m[1]! - 1, del: +(m[2] ?? 1), add: [] });
    else if (line.startsWith('+') && !line.startsWith('+++')) hunks.at(-1)?.add.push(line.slice(1));
  }
  return hunks;
}
const count = (hunks: Hunk[]) => ({
  add: hunks.reduce((n, h) => n + h.add.length, 0),
  del: hunks.reduce((n, h) => n + h.del, 0),
});

/** A seeded random number, so a failure names a case that fails again. */
function seeded(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 2 ** 32);
}
/** A file of n lines and the same file after a few edits: lines changed, removed and added, in separate places. */
function edited(seed: number, n: number, line: (i: number) => string) {
  const rnd = seeded(seed);
  const a = Array.from({ length: n }, (_, i) => line(i));
  const b = a.slice();
  for (let e = 0, edits = 1 + Math.floor(rnd() * 6); e < edits; e++) {
    const at = Math.floor(rnd() * b.length),
      kind = rnd();
    if (kind < 0.4) b.splice(at, 1, `changed ${seed}.${e}`);
    else if (kind < 0.7) b.splice(at, Math.floor(rnd() * 3) + 1);
    else b.splice(at, 0, ...Array.from({ length: Math.floor(rnd() * 3) + 1 }, (_, k) => `added ${seed}.${e}.${k}`));
  }
  return { a, b };
}

describe('lineDiff', () => {
  it('git is here to compare with', () => {
    expect(execFileSync('git', ['--version'], { encoding: 'utf8' })).toMatch(/^git version/);
  });

  it('three lines added in three places are three hunks: +3, not the whole stretch between them', () => {
    // What a recorded Cursor run did to a 285-line file. The one-block diff this replaces gave +89 −86.
    const a = Array.from({ length: 285 }, (_, i) => `line ${i}`);
    const b = a.slice();
    for (const at of [229, 199, 142]) b.splice(at, 0, `aria-label ${at}`);
    const hunks = lineDiff(a, b);
    expect(hunks).toEqual([
      { at: 142, del: 0, add: ['aria-label 142'] },
      { at: 199, del: 0, add: ['aria-label 199'] },
      { at: 229, del: 0, add: ['aria-label 229'] },
    ]);
    expect(hunks).toEqual(gitDiff(a, b));
  });

  it("equals git's hunks, one for one, on files whose lines are all different", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { a, b } = edited(seed, 40 + (seed % 7) * 30, i => `line ${i}`);
      expect(lineDiff(a, b), `seed ${seed}`).toEqual(gitDiff(a, b));
    }
  });

  it('where lines repeat, changes as many lines as git and rebuilds the new version', () => {
    // Among identical lines, which of them changed has more than one right answer: git slides a hunk by its own
    // rules. The lines added and removed are counted the same, and the result is the same file.
    for (let seed = 1; seed <= 60; seed++) {
      const { a, b } = edited(seed, 60, i => ['', '}', '  return x;', `fn${i % 9}() {`][i % 4]!);
      const hunks = lineDiff(a, b);
      expect(applyHunks(a, hunks), `seed ${seed}`).toEqual(b);
      expect(count(hunks), `seed ${seed}`).toEqual(count(gitDiff(a, b)));
    }
  });

  it('finds nothing when the versions match', () => {
    expect(lineDiff(['a'], ['a'])).toEqual([]);
    expect(lineDiff([], [])).toEqual([]);
  });

  it('a new file, an emptied one, a line added at the end', () => {
    expect(lineDiff([], ['a', 'b'])).toEqual([{ at: 0, del: 0, add: ['a', 'b'] }]);
    expect(lineDiff(['a', 'b'], [])).toEqual([{ at: 0, del: 2, add: [] }]);
    expect(lineDiff(['a', 'b', 'c'], ['a', 'b', 'c', 'd'])).toEqual([{ at: 3, del: 0, add: ['d'] }]);
  });

  it('a file rewritten whole is one block, found at once', () => {
    const a = Array.from({ length: 6000 }, (_, i) => `old ${i}`),
      b = ['same', ...Array.from({ length: 6000 }, (_, i) => `new ${i}`), 'same'];
    const t0 = performance.now();
    const hunks = lineDiff(['same', ...a, 'same'], b);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(hunks).toEqual([{ at: 1, del: 6000, add: b.slice(1, -1) }]);
  });
});
