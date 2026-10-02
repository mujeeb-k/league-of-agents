import { describe, expect, it } from 'vitest';
import { scrub } from '../../src/lib/analytics';

describe('scrub (analytics never carry the connect token)', () => {
  it('keeps the origin and path only', () => {
    expect(scrub({ type: 'pageview', url: 'https://leagueofagents.dev/#bridge=43210&t=secret' })).toEqual({
      type: 'pageview',
      url: 'https://leagueofagents.dev/',
    });
    expect(scrub({ type: 'event', url: 'https://leagueofagents.dev/app/?t=secret#t=secret' }).url).toBe(
      'https://leagueofagents.dev/app/',
    );
  });
});
