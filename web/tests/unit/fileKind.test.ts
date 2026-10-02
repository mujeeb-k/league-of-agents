import { describe, expect, it } from 'vitest';
import { fileKind } from '../../src/lib/fileKind';

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
