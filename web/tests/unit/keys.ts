// Every catalogue key the app uses: the English of each t('…') and the plural of each tn(n, '…', '…'), read from
// the source, and the keys passed in variables (VARIABLE_KEYS), which no literal call shows.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ABOUT, PRIVACY, TAGLINE } from '../../src/lib/intro';
import { SAMPLE_RUNS, SAMPLE_TREE } from '../../src/demo/sample';
import type { TreeSpec } from '../../src/lib/types';
import { BY_CODE, UNREACHABLE } from '../../src/api/errors';

const SRC = path.join(__dirname, '../../src');

/** Keys t() is called with through a variable: the English it names, kept here so every catalogue has them. */
export const VARIABLE_KEYS = [
  UNREACHABLE,
  ...Object.values(BY_CODE),
  'The bridge is offline. Reconnect first.',
  ABOUT,
  'Before',
  'After',
  'Diff',
  'Show before',
  'Show after',
  'Show diff',
  'Watch mode',
  'You',
  'Claude Code (terminal)',
  'Codex (terminal)',
  'Cursor (editor)',
  // Shown in English everywhere, with their translation beneath (Translation).
  TAGLINE,
  PRIVACY,
];

/** The demo's words: its runs' titles, prompts, replies and times, and its folders' notes (lib/model.ts buildModel). */
export function demoKeys(): string[] {
  const notes = (s: TreeSpec): string[] => [
    ...(s.note ? [s.note] : []),
    ...s.c.flatMap(c => (typeof c === 'string' ? [] : notes(c))),
  ];
  return [...notes(SAMPLE_TREE), ...SAMPLE_RUNS.flatMap(r => [r.title, r.when, r.prompt, r.summary])];
}

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'i18n' ? [] : sources(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Each key, and whether it's a plural (a tn() call). */
export function usedKeys(): Map<string, { plural: boolean }> {
  const keys = new Map<string, { plural: boolean }>([...VARIABLE_KEYS, ...demoKeys()].map(k => [k, { plural: false }]));
  for (const file of sources(SRC)) {
    const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind);
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const lit = (a: ts.Expression | undefined) =>
          a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : null;
        if (n.expression.text === 't') {
          const k = lit(n.arguments[0]);
          if (k) keys.set(k, { plural: false });
        } else if (n.expression.text === 'tn') {
          const k = lit(n.arguments[2]);
          if (k) keys.set(k, { plural: true });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return keys;
}
