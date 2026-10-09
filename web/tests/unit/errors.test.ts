import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeError } from '../../src/api/client';
import type { ErrorBody } from '../../src/api/types';
import { BY_CODE, UNREACHABLE, explain } from '../../src/api/errors';
import { setLang } from '../../src/i18n';

const err = (status: number, message: string, body: ErrorBody = {}) =>
  new BridgeError(message, status, { error: message, ...body });

describe('explain', () => {
  // setLang marks the page's language; these tests have no page.
  beforeEach(() => vi.stubGlobal('document', { documentElement: {} }));
  afterEach(async () => {
    await setLang('en');
    vi.unstubAllGlobals();
  });

  it('never shows a raw error', () => {
    expect(explain(new TypeError('Failed to fetch'))).toBe(UNREACHABLE);
    expect(explain(err(401, 'Bad or missing token'))).toBe(
      'The bridge rejected that link. Copy the latest one it printed.',
    );
    expect(explain(err(404, 'No such run'))).toBe('That run no longer exists on the bridge.');
    expect(explain(err(500, 'ENOENT: no such file, open /x'))).toBe(
      "The bridge couldn't do that. Try again, or restart the bridge if it keeps happening.",
    );
  });

  it("words a bridge's error by its code, in the person's language", async () => {
    const active = err(409, 'Run 3 is still active', { code: 'run-active', args: { id: 3 } });
    const missing = err(400, 'codex is not installed on this machine', {
      code: 'not-installed',
      args: { agent: 'codex' },
    });
    expect(explain(active)).toBe('Run 3 is still active');
    expect(explain(missing)).toBe("Codex isn't installed on this computer.");
    await setLang('fr');
    expect(explain(active)).toBe('L’exécution 3 est toujours en cours');
    expect(explain(missing)).toBe('Codex n’est pas installé sur cet ordinateur.');
  });

  it("shows an older bridge's English when it sends no code", async () => {
    await setLang('fr');
    expect(explain(err(409, 'Run 3 is still active'))).toBe('Run 3 is still active');
    expect(explain(err(400, 'claude is not installed on this machine'))).toBe(
      'Claude Code n’est pas installé sur cet ordinateur.',
    );
  });

  it('has words for every code the bridge sends', () => {
    const dir = path.join(__dirname, '../../../bridge');
    const bridge = [
      path.join(dir, 'loa.mjs'),
      ...(fs.readdirSync(path.join(dir, 'lib'), { recursive: true }) as string[])
        .filter(f => f.endsWith('.mjs'))
        .map(f => path.join(dir, 'lib', f)),
    ]
      .map(f => fs.readFileSync(f, 'utf8'))
      .join('\n');
    // As `reason: 'code'`, or through lib/util.mjs's `refused('code', ...)`.
    const sent = [...bridge.matchAll(/\b(?:(?:code|reason): |refused\(\s*)'([a-z-]+)'/g)].map(m => m[1]);
    expect(new Set(sent)).toEqual(new Set(Object.keys(BY_CODE)));
  });
});
