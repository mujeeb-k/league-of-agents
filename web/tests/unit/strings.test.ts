// Every word the app shows goes through the catalogue (i18n): no JSX text, and no text attribute (aria-label,
// title, placeholder, label, alt, heading), written straight into a component. What stays as it is in every language is
// listed: product names, keys, commands, and the tagline and privacy pair, which are always exactly these words.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = path.join(__dirname, '../../src');
const AS_IS = new Set([
  'League of Agents',
  'See every change your agents make.',
  'League of Agents never uploads your code anywhere. Your code goes only to the agent you authorized.',
  'J',
  'K',
  'R',
  'sudo sysctl fs.inotify.max_user_watches=524288',
]);
const ATTRS = new Set(['aria-label', 'title', 'placeholder', 'label', 'alt', 'heading', 'removeLabel']);

function components(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'ui' || e.name === 'demo' ? [] : components(p);
    return p.endsWith('.tsx') ? [p] : [];
  });
}

/** The strings an expression evaluates to directly: itself, either side of ?: or ||, and inside parentheses. */
function choices(e: ts.Expression): (ts.StringLiteral | ts.NoSubstitutionTemplateLiteral)[] {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e];
  if (ts.isParenthesizedExpression(e)) return choices(e.expression);
  if (ts.isConditionalExpression(e)) return [...choices(e.whenTrue), ...choices(e.whenFalse)];
  if (
    ts.isBinaryExpression(e) &&
    [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(e.operatorToken.kind)
  )
    return [...choices(e.left), ...choices(e.right)];
  return [];
}

describe('the catalogue', () => {
  it('holds every word the components show', () => {
    const outside: string[] = [];
    for (const file of components(SRC)) {
      const sf = ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const at = (n: ts.Node) =>
        `${path.relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
      const visit = (n: ts.Node) => {
        if (ts.isJsxText(n)) {
          const text = n.text.replace(/\s+/g, ' ').trim();
          if (/[A-Za-z]/.test(text) && !AS_IS.has(text)) outside.push(`${at(n)} ${text}`);
        } else if (
          ts.isJsxExpression(n) &&
          n.expression &&
          (!ts.isJsxAttribute(n.parent) || ATTRS.has(n.parent.name.getText()))
        ) {
          // A string chosen in the expression itself: {busy ? 'Connecting' : 'Connect'}.
          for (const lit of choices(n.expression))
            if (/[A-Za-z]/.test(lit.text) && !AS_IS.has(lit.text)) outside.push(`${at(lit)} ${lit.text}`);
        } else if (
          ts.isJsxAttribute(n) &&
          ATTRS.has(n.name.getText()) &&
          n.initializer &&
          ts.isStringLiteral(n.initializer) &&
          /[A-Za-z]/.test(n.initializer.text) &&
          !AS_IS.has(n.initializer.text)
        )
          outside.push(`${at(n)} ${n.initializer.text}`);
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(outside).toEqual([]);
  });
});
