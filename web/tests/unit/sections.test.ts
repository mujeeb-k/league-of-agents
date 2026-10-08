import { describe, expect, it } from 'vitest';
// @ts-expect-error: the bridge is plain JavaScript, type-checked on its own (bridge/jsconfig.json).
import { inScope } from '../../../bridge/lib/scope.mjs';
import { clashOf, covers, overlaps } from '../../src/lib/sections';

describe('sections', () => {
  it('overlap as the bridge refuses them: the same path, a folder and what is in it, or the whole repository', () => {
    expect(overlaps('shared/', 'shared/log.ts')).toBe(true);
    expect(overlaps('shared/log.ts', 'shared/')).toBe(true);
    expect(overlaps('shared/log.ts', 'shared/log.ts:2-4')).toBe(true);
    expect(overlaps('/', 'apps/')).toBe(true);
    expect(overlaps('shared/', 'apps/')).toBe(false);
    expect(overlaps('shared/log.ts', 'shared/allowlist.ts')).toBe(false);
    // A file whose name starts like a folder is not in it.
    expect(overlaps('shared/', 'shared.ts')).toBe(false);
  });

  it('a file is covered by a scope exactly when the bridge says it is in it', () => {
    const scopes = [['shared/'], ['shared/log.ts'], ['shared/log.ts:1-3'], ['apps/', 'notes.md'], ['/']];
    const files = ['shared/log.ts', 'shared/allowlist.ts', 'apps/console/main.ts', 'notes.md', 'shared.ts'];
    for (const s of scopes) for (const f of files) expect(covers(s, f), `${s} ${f}`).toBe(inScope(s, f));
    // The whole repository, as a run with no scope.
    expect(covers([], 'notes.md')).toBe(true);
  });

  it('names what a new section clashes with: another section picked with it, or a session at work', () => {
    const working = [{ id: 4, scope: ['apps/'] }];
    expect(clashOf(['shared/', 'notes.md'], working)).toBeNull();
    expect(clashOf(['shared/', 'shared/log.ts'], working)).toEqual({ path: 'shared/log.ts', inside: 'shared/' });
    expect(clashOf(['shared/log.ts', 'shared/'], working)).toEqual({ path: 'shared/log.ts', inside: 'shared/' });
    expect(clashOf(['apps/console/main.ts'], working)).toEqual({
      path: 'apps/console/main.ts',
      run: 4,
      inside: 'apps/',
    });
    // The whole repository runs alone.
    expect(clashOf([], working)).toEqual({ path: '/', run: 4, inside: 'apps/' });
    expect(clashOf(['notes.md'], [{ id: 5, scope: [] }])).toEqual({ path: 'notes.md', run: 5, inside: '/' });
  });
});
