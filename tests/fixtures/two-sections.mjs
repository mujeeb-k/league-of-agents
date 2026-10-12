#!/usr/bin/env node
// Generates a small repo for two sessions at once, in one checkout: nothing in it is kept in this repo.
// Usage: node two-sections.mjs <folder>   (the folder must not exist, or be empty)
//
//   a/         a pricing library: four modules, each with its test
//   b/         an orders app that imports a/: four modules, each with its test
//   package.json   shared by both: `npm test` runs every test, `npm run test:a` and `test:b` one section's
//   .git/hooks/pre-commit   rewrites the staged files (trailing spaces off) and stages them again, then brings
//              b/MODULES.md, a list of every module, up to date: so a commit of a/ touches a file in b/
//
// The tests need Node only: no package is installed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node two-sections.mjs <folder>');
  process.exit(1);
}
if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
  console.error(`${dir} isn't empty.`);
  process.exit(1);
}

/** A module's test: each case is a call and what it should give. */
const test = (name, from, cases) =>
  [
    "import assert from 'node:assert/strict';",
    `import { ${name} } from './${from}.mjs';`,
    '',
    ...cases.map(([call, want]) => `assert.deepEqual(${call}, ${want});`),
    `console.log('${from}: ${cases.length} passed');`,
    '',
  ].join('\n');

const FILES = {
  'package.json':
    JSON.stringify(
      {
        name: 'two-sections',
        private: true,
        type: 'module',
        scripts: {
          test: 'npm run test:a && npm run test:b',
          'test:a': 'for t in a/*.test.mjs; do node "$t" || exit 1; done',
          'test:b': 'for t in b/*.test.mjs; do node "$t" || exit 1; done',
        },
      },
      null,
      2,
    ) + '\n',
  'README.md': '# two-sections\n\nA pricing library in `a/` and an orders app in `b/` that uses it.\n',
  'a/price.mjs':
    '/** The price of a line: what one costs, in cents, times how many. */\nexport function price(cents, quantity) {\n  return cents * quantity;\n}\n',
  'a/price.test.mjs': test('price', 'price', [
    ['price(250, 2)', '500'],
    ['price(99, 0)', '0'],
  ]),
  'a/tax.mjs':
    '/** Tax on an amount in cents, at a rate in percent, rounded to the cent. */\nexport function tax(cents, percent) {\n  return Math.round((cents * percent) / 100);\n}\n',
  'a/tax.test.mjs': test('tax', 'tax', [
    ['tax(1000, 20)', '200'],
    ['tax(999, 7.5)', '75'],
  ]),
  'a/discount.mjs':
    '/** An amount in cents after a discount in percent, never below zero. */\nexport function discount(cents, percent) {\n  return Math.max(0, Math.round(cents - (cents * percent) / 100));\n}\n',
  'a/discount.test.mjs': test('discount', 'discount', [
    ['discount(1000, 10)', '900'],
    ['discount(1000, 150)', '0'],
  ]),
  'a/currency.mjs':
    '/** Cents as text: 1999 is "19.99". */\nexport function currency(cents) {\n  return (cents / 100).toFixed(2);\n}\n',
  'a/currency.test.mjs': test('currency', 'currency', [
    ['currency(1999)', "'19.99'"],
    ['currency(5)', "'0.05'"],
  ]),
  'b/cart.mjs':
    "import { price } from '../a/price.mjs';\n\n/** What a cart's lines come to, in cents. */\nexport function cartTotal(lines) {\n  return lines.reduce((sum, l) => sum + price(l.cents, l.quantity), 0);\n}\n",
  'b/cart.test.mjs': test('cartTotal', 'cart', [
    ['cartTotal([{ cents: 250, quantity: 2 }, { cents: 100, quantity: 1 }])', '600'],
    ['cartTotal([])', '0'],
  ]),
  'b/invoice.mjs':
    "import { discount } from '../a/discount.mjs';\nimport { tax } from '../a/tax.mjs';\nimport { cartTotal } from './cart.mjs';\n\n/** An invoice for a cart: its total, the discount taken off, the tax added, and what is due. */\nexport function invoice(lines, { discountPercent = 0, taxPercent = 0 } = {}) {\n  const total = cartTotal(lines);\n  const net = discount(total, discountPercent);\n  const added = tax(net, taxPercent);\n  return { total, net, tax: added, due: net + added };\n}\n",
  'b/invoice.test.mjs': test('invoice', 'invoice', [
    [
      'invoice([{ cents: 1000, quantity: 1 }], { discountPercent: 10, taxPercent: 20 })',
      '{ total: 1000, net: 900, tax: 180, due: 1080 }',
    ],
  ]),
  'b/receipt.mjs':
    "import { currency } from '../a/currency.mjs';\nimport { invoice } from './invoice.mjs';\n\n/** A receipt's lines of text for a cart. */\nexport function receipt(lines, options) {\n  const i = invoice(lines, options);\n  return [`Total ${currency(i.total)}`, `Tax ${currency(i.tax)}`, `Due ${currency(i.due)}`];\n}\n",
  'b/receipt.test.mjs': test('receipt', 'receipt', [
    ['receipt([{ cents: 1999, quantity: 1 }], { taxPercent: 10 })', "['Total 19.99', 'Tax 2.00', 'Due 21.99']"],
  ]),
  'b/report.mjs':
    "import { cartTotal } from './cart.mjs';\n\n/** How many carts there are and what they come to together. */\nexport function report(carts) {\n  return { carts: carts.length, cents: carts.reduce((sum, c) => sum + cartTotal(c), 0) };\n}\n",
  'b/report.test.mjs': test('report', 'report', [
    ['report([[{ cents: 100, quantity: 2 }], [{ cents: 50, quantity: 1 }]])', '{ carts: 2, cents: 250 }'],
  ]),
  'b/MODULES.md': '',
};

/** The hook: a formatter of its own, with no package, and a list it keeps in b/. */
const HOOK = `#!/bin/sh
# Trailing spaces off every staged file, staged again; then b/MODULES.md lists every module, staged too.
for f in $(git diff --cached --name-only --diff-filter=ACM); do
  sed -i.bak -e 's/[[:space:]]*$//' "$f" && rm -f "$f.bak" && git add "$f"
done
ls a/*.mjs b/*.mjs | grep -v '\\.test\\.mjs$' > b/MODULES.md
git add b/MODULES.md
`;

for (const [p, text] of Object.entries(FILES)) {
  fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
  fs.writeFileSync(path.join(dir, p), text);
}
const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
fs.writeFileSync(
  path.join(dir, 'b/MODULES.md'),
  Object.keys(FILES)
    .filter(p => /^[ab]\/.*\.mjs$/.test(p) && !p.endsWith('.test.mjs'))
    .sort()
    .join('\n') + '\n',
);
git('init', '-q', '-b', 'main');
git('config', 'user.name', 'test');
git('config', 'user.email', 'test@example.test');
git('add', '-A');
git('commit', '-qm', 'A pricing library and an orders app');
fs.writeFileSync(path.join(dir, '.git/hooks/pre-commit'), HOOK, { mode: 0o755 });
console.log(`Made ${path.resolve(dir)}: a/ and b/, ${Object.keys(FILES).length} files, one commit, a pre-commit hook.`);
