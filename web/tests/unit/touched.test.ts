// What a run touched, in one line above its timeline (lib/live.ts, shown by components/Timeline.tsx): files only read, files edited,
// commands run, each part worded for where it falls in the line.
import { describe, expect, it } from 'vitest';
import { touched } from '../../src/lib/live';
import type { StepDTO } from '../../src/api/types';

const at = (act: StepDTO['act'], file?: string, refused = false): StepDTO => ({
  i: 0,
  at: 0,
  act,
  tool: act,
  ...(file ? { file } : {}),
  ...(refused ? { refused } : {}),
});

describe('what a run touched', () => {
  it('counts a file read and then edited as edited only, and a refused edit not at all', () => {
    expect(touched([at('read', 'a.ts'), at('read', 'b.ts'), at('edit', 'a.ts'), at('edit', 'c.ts', true)])).toBe(
      'Read 1 file · edited 1 file',
    );
  });
  it('starts with a capital whichever part comes first', () => {
    expect(touched([at('edit', 'a.ts'), at('edit', 'b.ts'), at('run')])).toBe('Edited 2 files · ran 1 command');
    expect(touched([at('run'), at('run')])).toBe('Ran 2 commands');
    expect(touched([at('other')])).toBe('');
  });
});
