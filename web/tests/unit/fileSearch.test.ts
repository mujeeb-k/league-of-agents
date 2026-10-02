import { describe, expect, it } from 'vitest';
import { searchFiles } from '../../src/lib/fileSearch';

const f = (path: string) => ({ path, name: path.split('/').pop()! });
const files = [
  'server/delivery/retry/backoff.ts',
  'server/delivery/retry/schedule-retry.ts',
  'server/delivery/endpoint-registry.ts',
  'server/api/routes/endpoints.ts',
  'docs/retry.md',
].map(f);

describe('searchFiles', () => {
  it('ranks name matches above folder matches, shorter paths first', () =>
    expect(searchFiles(files, 'retry').map(x => x.path)).toEqual([
      'docs/retry.md',
      'server/delivery/retry/schedule-retry.ts',
      'server/delivery/retry/backoff.ts',
    ]));
  it('needs every word, in order', () => {
    expect(searchFiles(files, 'delivery back').map(x => x.path)).toEqual(['server/delivery/retry/backoff.ts']);
    expect(searchFiles(files, 'back delivery')).toEqual([]);
  });
  it('limits the results and lists by path with no query', () => {
    expect(searchFiles(files, '', 2).map(x => x.path)).toEqual(['docs/retry.md', 'server/api/routes/endpoints.ts']);
  });
});
