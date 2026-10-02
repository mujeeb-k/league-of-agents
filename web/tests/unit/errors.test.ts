import { describe, expect, it } from 'vitest';
import { BridgeError } from '../../src/api/client';
import { UNREACHABLE, explain } from '../../src/api/errors';

const err = (status: number, message: string) => new BridgeError(message, status, { error: message });

describe('explain', () => {
  it('never shows a raw error', () => {
    expect(explain(new TypeError('Failed to fetch'))).toBe(UNREACHABLE);
    expect(explain(err(401, 'Bad or missing token'))).toBe(
      'The bridge rejected that link. Copy the latest one it printed.',
    );
    expect(explain(err(400, 'claude is not installed on this machine'))).toBe(
      "Claude Code isn't installed on this computer.",
    );
    expect(explain(err(404, 'No such run'))).toBe('That run no longer exists on the bridge.');
    expect(explain(err(409, 'Run 3 is still active'))).toBe('Run 3 is still active');
    expect(explain(err(500, 'ENOENT: no such file, open /x'))).toBe(
      "The bridge couldn't do that. Try again, or restart the bridge if it keeps happening.",
    );
  });
});
