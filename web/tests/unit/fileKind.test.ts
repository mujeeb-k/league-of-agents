import { describe, expect, it } from 'vitest';
import { BY_EXT, fileKind } from '../../src/lib/fileKind';
// @ts-expect-error: the bridge is plain JavaScript, type-checked on its own (bridge/jsconfig.json).
import { CODE_EXT } from '../../../bridge/lib/files.mjs';

describe('fileKind', () => {
  it.each([
    ['backoff.ts', 'code'],
    ['main.py', 'code'],
    ['deploy.sh', 'shell'],
    ['tsconfig.json', 'json'],
    ['package-lock.json', 'lock'],
    ['docker-compose.yml', 'config'],
    ['.gitignore', 'config'],
    ['.env.example', 'config'],
    ['Dockerfile', 'config'],
    ['README.md', 'text'],
    ['logo.svg', 'image'],
    ['rates.csv', 'table'],
    ['LICENSE', 'text'],
    ['notes', 'file'],
  ])('%s is %s', (name, kind) => expect(fileKind(name)).toBe(kind));
});

// The map shows a file by the bridge's list; the app has a kind for many more. Every text kind is on the map, but
// .env files (they hold secrets) and property lists (often binary).
it('the map shows every file the app knows as text', () => {
  const text = Object.entries(BY_EXT)
    .filter(
      ([ext, kind]) => ['code', 'shell', 'json', 'config', 'text'].includes(kind) && !['env', 'plist'].includes(ext),
    )
    .map(([ext]) => ext);
  expect(text.filter(ext => !(CODE_EXT as RegExp).test(`name.${ext}`))).toEqual([]);
});
