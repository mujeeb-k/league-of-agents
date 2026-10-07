// Each label, line by line, for a chain of runs: the rows of spec 017's table. A label is never "human" for a line
// no one is known to have typed.
import { describe, expect, it } from 'vitest';
import { authorsOf, shareOf, type Owner } from '../../src/lib/attribution';
import type { Change, Hunk, Run } from '../../src/lib/types';

const change = (pre: string[], hunks: Hunk[], more: Partial<Change> = {}): Change => ({
  created: false,
  deleted: false,
  pre,
  hunks,
  lines: [],
  ...more,
});
let id = 0;
const run = (agent: string, changes: Record<string, Change>, more: Partial<Run> = {}): Run => ({
  id: ++id,
  agent,
  title: '',
  when: '',
  dur: '',
  prompt: '',
  summary: '',
  status: 'done',
  changes: new Map(Object.entries(changes)),
  reviewed: new Set(),
  ...more,
});
const labels = (owners: Owner[] | undefined) => owners!.map(o => (o.run ? `${o.author}:${o.run}` : o.author));
const BASE = ['import x', 'const a = 1;', 'const b = 2;', 'export {}'];

describe('authorsOf', () => {
  it("labels Claude Code's edit-tool lines agent, its other lines and other agents' unknown, a save human", () => {
    id = 0;
    const claude = run(
      'claude',
      { 'a.ts': change(BASE, [{ at: 1, del: 1, add: ['const a = fetchA();', 'const aa = sh();'] }]) },
      // Only the first added line came through its Edit tool; the second, say, from a shell command.
      { agentLines: { 'a.ts': [[1, 1]] } },
    );
    const afterClaude = ['import x', 'const a = fetchA();', 'const aa = sh();', 'const b = 2;', 'export {}'];
    const you = run('you', { 'a.ts': change(afterClaude, [{ at: 3, del: 1, add: ['const b = 3;'] }]) });
    const afterYou = ['import x', 'const a = fetchA();', 'const aa = sh();', 'const b = 3;', 'export {}'];
    const codex = run('codex', { 'a.ts': change(afterYou, [{ at: 5, del: 0, add: ['// codex'] }]) });
    const now = [...afterYou, '// codex'];
    const owners = authorsOf([claude, you, codex], new Map([['a.ts', now]])).get('a.ts');
    expect(labels(owners)).toEqual(['unknown', 'agent:1', 'unknown:1', 'human:2', 'unknown', 'unknown:3']);
  });

  it('labels an agent line someone else partly rewrote mixed', () => {
    id = 0;
    const claude = run(
      'claude',
      { 'a.ts': change(BASE, [{ at: 1, del: 1, add: ['const a = fetchA(url);'] }]) },
      {
        agentLines: { 'a.ts': [[1, 1]] },
      },
    );
    const after = ['import x', 'const a = fetchA(url);', 'const b = 2;', 'export {}'];
    const watch = run('detected', {
      'a.ts': change(after, [{ at: 1, del: 1, add: ['const a = fetchA(url, opts);'] }]),
    });
    const now = ['import x', 'const a = fetchA(url, opts);', 'const b = 2;', 'export {}'];
    expect(labels(authorsOf([claude, watch], new Map([['a.ts', now]])).get('a.ts'))).toEqual([
      'unknown',
      'mixed:2',
      'unknown',
      'unknown',
    ]);
  });

  it('keeps labels across a commit that changed nothing, and loses only the lines changed outside any run', () => {
    id = 0;
    const claude = run(
      'claude',
      { 'a.ts': change(BASE, [{ at: 4, del: 0, add: ['export const c = 3;'] }]) },
      {
        agentLines: { 'a.ts': [[4, 4]] },
      },
    );
    // Later the file on disk differs in its first line (a pull), and the next run starts from that.
    const pulled = ['import y', ...BASE.slice(1), 'export const c = 3;'];
    const you = run('you', { 'a.ts': change(pulled, [{ at: 0, del: 0, add: ['// note'] }]) });
    const now = ['// note', ...pulled];
    expect(labels(authorsOf([claude, you], new Map([['a.ts', now]])).get('a.ts'))).toEqual([
      'human:2',
      'unknown',
      'unknown',
      'unknown',
      'unknown',
      'agent:1',
    ]);
  });

  it('skips a reverted run, carries a rename, and says unknown for a pruned run', () => {
    id = 0;
    const claude = run(
      'claude',
      { 'a.ts': change(BASE, [{ at: 4, del: 0, add: ['export const c = 3;'] }]) },
      {
        agentLines: { 'a.ts': [[4, 4]] },
      },
    );
    const after = [...BASE, 'export const c = 3;'];
    const reverted = run(
      'claude',
      { 'a.ts': change(after, [{ at: 0, del: 1, add: ['gone'] }]) },
      {
        reverted: true,
        agentLines: { 'a.ts': [[0, 0]] },
      },
    );
    const renamed = run('detected', { 'b.ts': change(after, [], { renamedFrom: 'a.ts' }) });
    const now = new Map([['b.ts', after]]);
    expect(labels(authorsOf([claude, reverted, renamed], now).get('b.ts'))).toEqual([
      'unknown',
      'unknown',
      'unknown',
      'unknown',
      'agent:1',
    ]);
    // Run 1 pruned: the line it wrote is unknown, since no kept run says who wrote it.
    expect(labels(authorsOf([reverted, renamed], now).get('b.ts'))).toEqual(after.map(() => 'unknown'));
  });

  it('counts a file by author for its share bar', () => {
    const o = (author: Owner['author']): Owner => ({ author, run: 1 });
    expect(shareOf([o('agent'), o('agent'), o('human'), o('unknown')])).toEqual({
      agent: 2,
      human: 1,
      mixed: 0,
      unknown: 1,
    });
  });
});
