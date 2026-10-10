// Every sentence the bridge writes into a run comes with a code, and the app has words for each code: none is shown
// in English only because the app never heard of it.
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { SAID_CODES, editedTitle, said } from '../../src/lib/said';

const LIB = path.join(__dirname, '../../../bridge/lib');
/** Codes worded where they are shown, with their own fields (components/Inspector.tsx, Sidebar.tsx). */
const ELSEWHERE = ['command-blocked', 'command-blocked-repo', 'path-blocked'];

it('has words for every code the bridge sends', () => {
  const bridge = (fs.readdirSync(LIB, { recursive: true }) as string[])
    .filter(f => f.endsWith('.mjs'))
    .map(f => fs.readFileSync(path.join(LIB, f), 'utf8'))
    .join('\n');
  const sent = [
    ...[...bridge.matchAll(/\bline\(\s*'[a-z]+',\s*'([a-z-]+)'/g)].map(m => m[1]!),
    ...[...bridge.matchAll(/\bsay: '([a-z-]+)'/g)].map(m => m[1]!),
  ];
  expect(sent.length).toBeGreaterThan(15);
  expect([...new Set(sent)].filter(c => !SAID_CODES.includes(c) && !ELSEWHERE.includes(c))).toEqual([]);
});

it('words a line by its code, and falls back to what the bridge wrote', () => {
  expect(said({ text: 'x', say: 'outside-scope', args: { files: 'a.ts, b.ts' } })).toBe(
    'Changed outside scope: a.ts, b.ts',
  );
  expect(said({ text: 'From a newer bridge.', say: 'not-known-yet', args: {} })).toBe('From a newer bridge.');
  expect(said({ summary: '3 passed' })).toBe('3 passed');
  expect(editedTitle({ file: 'main.py', more: 0 })).toBe('Edited main.py');
  expect(editedTitle({ file: 'main.py', more: 2 })).toBe('Edited main.py and 2 more');
});
