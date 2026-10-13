import { describe, expect, it } from 'vitest';
import { allFiles, applyHunks, diffRows, outsideOf, ownFiles, parseSample, sharedOf } from '../../src/lib/model';
import { parseConn } from '../../src/api/conn';
import { SAMPLE_RUNS, SAMPLE_TREE } from '../../src/demo/sample';
import { SAMPLE_TEXT } from '../../src/demo/sampleText';
import type { Run, TreeSpec } from '../../src/lib/types';

describe('diffRows', () => {
  it('interleaves context, deletions and additions with both line numbers', () => {
    const rows = diffRows(['a', 'b', 'c'], [{ at: 1, del: 1, add: ['B', 'B2'] }]);
    expect(rows).toEqual([
      { t: 'a', k: '', nb: 1, na: 1 },
      { t: 'b', k: 'del', nb: 2 },
      { t: 'B', k: 'add', na: 2 },
      { t: 'B2', k: 'add', na: 3 },
      { t: 'c', k: '', nb: 3, na: 4 },
    ]);
  });
  it('handles a pure insertion at the end and a pure deletion', () => {
    expect(
      applyHunks(
        ['a', 'b'],
        [
          { at: 2, del: 0, add: ['c'] },
          { at: 0, del: 1, add: [] },
        ],
      ),
    ).toEqual(['b', 'c']);
  });
});

describe('parseConn', () => {
  const here = 'https://loa.example.test/';
  it('reads a bridge-served link', () =>
    expect(parseConn('http://127.0.0.1:43210/#t=abc', here)).toEqual({
      base: 'http://127.0.0.1:43210',
      token: 'abc',
      fromLink: true,
    }));
  it('reads a hosted link', () =>
    expect(parseConn('https://loa.example.test/#bridge=43211&t=xyz', here)).toEqual({
      base: 'http://127.0.0.1:43211',
      token: 'xyz',
      fromLink: true,
    }));
  it('rejects links without a token or on other hosts', () => {
    expect(parseConn('http://127.0.0.1:43210/', here)).toBeNull();
    expect(parseConn('https://evil.example.test/#t=abc', here)).toBeNull();
    expect(parseConn('not a link', here)).toBeNull();
  });
});

describe('demo sample', () => {
  const code = parseSample(SAMPLE_TEXT);
  const files: string[] = [];
  const walk = (s: TreeSpec, p: string) =>
    s.c.forEach(c => (typeof c === 'string' ? files.push(p + c) : walk(c, p + c.n + '/')));
  walk(SAMPLE_TREE, '');
  it('has code for every file in the tree and nothing else', () =>
    expect(Object.keys(code).sort()).toEqual([...files].sort()));
  it('has the shape of the demo sample: 23 files, 3 runs, then 3 sessions at work', () => {
    expect(files).toHaveLength(23);
    expect(SAMPLE_RUNS.filter(r => !r.working)).toHaveLength(3);
    expect(SAMPLE_RUNS.filter(r => r.working).map(r => r.agent)).toEqual(['claude', 'codex', 'hermes']);
  });
  it('only deletes lines that exist', () => {
    for (const r of SAMPLE_RUNS)
      for (const [p, ch] of Object.entries(r.ch)) {
        if (ch === 'CREATE') continue;
        const lines = code[p]!.split('\n');
        for (const [at, del] of ch) expect(at + del, `${p} @${at}`).toBeLessThanOrEqual(lines.length);
      }
  });
});

describe("a run's files, as Keep, Revert and Commit count them", () => {
  const run = {
    changes: new Map([
      ['a/tax.mjs', {}],
      ['b/cart.mjs', {}],
    ]),
    unseen: [{ path: 'b/logo.png' }, { path: 'a/data.bin' }],
    shared: [
      { path: 'a/tax.mjs', with: [1] },
      { path: 'a/data.bin', with: [1, 4] },
    ],
    outOfScope: ['a/tax.mjs', 'shared/allowlist.ts outside lines 3–5'],
  } as unknown as Run;

  it("counts the files the map doesn't show: a revert puts them back too", () => {
    expect(allFiles(run)).toEqual(['a/tax.mjs', 'b/cart.mjs', 'b/logo.png', 'a/data.bin']);
  });
  it('leaves the shared ones out of its own, shown or not', () => {
    expect(ownFiles(run)).toEqual(['b/cart.mjs', 'b/logo.png']);
    expect([...sharedOf(run)]).toEqual([
      ['a/tax.mjs', [1]],
      ['a/data.bin', [1, 4]],
    ]);
  });
  it('reads what the bridge flagged: a whole file, or the lines the run was held to', () => {
    expect([...outsideOf(run)]).toEqual([
      ['a/tax.mjs', null],
      ['shared/allowlist.ts', '3–5'],
    ]);
  });
  it('is nothing for a run from a bridge that sends none of it', () => {
    const old = { changes: new Map([['x.ts', {}]]) } as unknown as Run;
    expect([allFiles(old), ownFiles(old), [...sharedOf(old)], [...outsideOf(old)]]).toEqual([
      ['x.ts'],
      ['x.ts'],
      [],
      [],
    ]);
  });
});
