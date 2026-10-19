#!/usr/bin/env node
// Generates "split the bill": a small app two agents build at once, one part each, that runs once both are done.
// Usage: node split-the-bill.mjs <folder>   (the folder must not exist, or be empty)
//
//   bill/      the arithmetic: who owes what for a dinner, with tax and tip, in cents (one agent's part)
//   receipt/   the receipt printed for the table, from what bill/ works out (the other agent's part)
//   dinner.json   tonight's dinner: who had what
//   main.mjs   `npm start`: reads the dinner, splits it, prints the receipt
//   package.json  `npm test` runs both parts' tests; `npm run test:bill` and `npm run test:receipt` one part's
//
// Each part's function throws until its agent writes it: the tests fail, and `npm start` says what is missing. The
// two parts meet only at the shape bill/ returns, written down in both. Node only: nothing is installed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node split-the-bill.mjs <folder>');
  process.exit(1);
}
if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
  console.error(`${dir} isn't empty.`);
  process.exit(1);
}

/** What bill/ hands receipt/: said the same in both parts. */
const SHAPE = [
  ' * @typedef {{ name: string; items: number; tax: number; tip: number; total: number }} Share  in cents',
  ' * @typedef {{ shares: Share[]; total: number }} Split  `total` is the sum of the shares, to the cent',
];

const FILES = {
  'package.json':
    JSON.stringify(
      {
        name: 'split-the-bill',
        private: true,
        type: 'module',
        scripts: {
          start: 'node main.mjs',
          test: 'node --test',
          'test:bill': 'node --test bill/',
          'test:receipt': 'node --test receipt/',
        },
      },
      null,
      2,
    ) + '\n',
  'README.md': [
    '# Split the bill',
    '',
    'Who owes what for a dinner, with tax and tip, and the receipt for the table.',
    '',
    '- `bill/`: the arithmetic, in cents. `splitBill(dinner)` in `bill/split.mjs`.',
    '- `receipt/`: the receipt, from what `bill/` works out. `printReceipt(split)` in `receipt/print.mjs`.',
    '',
    "`npm test` runs both parts' tests. `npm start` prints the receipt for `dinner.json`.",
    '',
  ].join('\n'),
  'dinner.json':
    JSON.stringify(
      {
        restaurant: 'Lantern House',
        taxPercent: 8.875,
        tipPercent: 18,
        items: [
          { name: 'Dumplings', cents: 1250, shared: ['Ana', 'Ben', 'Chi'] },
          { name: 'Noodles', cents: 1675, people: ['Ana'] },
          { name: 'Fried rice', cents: 1425, people: ['Ben'] },
          { name: 'Mapo tofu', cents: 1550, people: ['Chi'] },
          { name: 'Tea for the table', cents: 900, shared: ['Ana', 'Ben', 'Chi'] },
        ],
      },
      null,
      2,
    ) + '\n',
  'main.mjs': [
    "import fs from 'node:fs';",
    "import { splitBill } from './bill/split.mjs';",
    "import { printReceipt } from './receipt/print.mjs';",
    '',
    "const dinner = JSON.parse(fs.readFileSync(new URL('./dinner.json', import.meta.url), 'utf8'));",
    'try {',
    '  console.log(printReceipt(splitBill(dinner), dinner));',
    '} catch (e) {',
    '  console.error(`Not ready: ${e.message}`);',
    '  process.exitCode = 1;',
    '}',
    '',
  ].join('\n'),
  'bill/split.mjs': [
    '/**',
    " * Splits a dinner's bill: each item between the people who had it (an item `shared` between those named, evenly),",
    ' * then tax and tip on each share of the items, as the dinner gives them in percent. In whole cents: a cent left',
    ' * over goes to the first people in the order they are first named, so the shares add up to the total exactly.',
    ...SHAPE,
    ' * @returns {Split}',
    ' */',
    'export function splitBill(dinner) {',
    "  throw new Error('splitBill in bill/split.mjs is not written yet');",
    '}',
    '',
  ].join('\n'),
  'bill/split.test.mjs': [
    "import assert from 'node:assert/strict';",
    "import { test } from 'node:test';",
    "import { splitBill } from './split.mjs';",
    '',
    "const one = (name, cents) => ({ name: 'x', cents, people: [name] });",
    '',
    "test('one person pays for what they had, with tax and tip', () => {",
    "  const { shares, total } = splitBill({ taxPercent: 10, tipPercent: 20, items: [one('Ana', 1000)] });",
    "  assert.deepEqual(shares, [{ name: 'Ana', items: 1000, tax: 100, tip: 200, total: 1300 }]);",
    '  assert.equal(total, 1300);',
    '});',
    '',
    "test('a shared item is split evenly, and the cent left over goes to the first named', () => {",
    '  const { shares, total } = splitBill({',
    '    taxPercent: 0,',
    '    tipPercent: 0,',
    "    items: [{ name: 'Tea', cents: 1000, shared: ['Ana', 'Ben', 'Chi'] }],",
    '  });',
    '  assert.deepEqual(',
    '    shares.map(s => [s.name, s.items]),',
    "    [['Ana', 334], ['Ben', 333], ['Chi', 333]],",
    '  );',
    '  assert.equal(total, 1000);',
    '});',
    '',
    "test('the shares add up to the total, to the cent', () => {",
    '  const { shares, total } = splitBill({',
    '    taxPercent: 8.875,',
    '    tipPercent: 18,',
    "    items: [one('Ana', 1675), one('Ben', 1425), { name: 'Rice', cents: 1001, shared: ['Ana', 'Ben', 'Chi'] }],",
    '  });',
    '  assert.equal(',
    '    shares.reduce((sum, s) => sum + s.total, 0),',
    '    total,',
    '  );',
    '  for (const s of shares) assert.equal(s.items + s.tax + s.tip, s.total);',
    '});',
    '',
  ].join('\n'),
  'receipt/print.mjs': [
    '/**',
    " * The receipt for the table: the restaurant's name, then a line for each person with what they owe in dollars",
    ' * (their items, tax and tip, and their total), then the total. Money as $12.34; the columns line up.',
    ...SHAPE,
    ' * @param {Split} split',
    ' * @param {{ restaurant: string }} dinner',
    ' * @returns {string}',
    ' */',
    'export function printReceipt(split, dinner) {',
    "  throw new Error('printReceipt in receipt/print.mjs is not written yet');",
    '}',
    '',
  ].join('\n'),
  'receipt/print.test.mjs': [
    "import assert from 'node:assert/strict';",
    "import { test } from 'node:test';",
    "import { printReceipt } from './print.mjs';",
    '',
    'const split = {',
    '  shares: [',
    "    { name: 'Ana', items: 1000, tax: 100, tip: 200, total: 1300 },",
    "    { name: 'Benedict', items: 50, tax: 5, tip: 10, total: 65 },",
    '  ],',
    '  total: 1365,',
    '};',
    '',
    "test('names the restaurant, each person with their total, and the total', () => {",
    "  const text = printReceipt(split, { restaurant: 'Lantern House' });",
    '  assert.match(text, /Lantern House/);',
    '  assert.match(text, /Ana.*\\$13\\.00/);',
    '  assert.match(text, /Benedict.*\\$0\\.65/);',
    '  assert.match(text, /\\$13\\.65/);',
    '});',
    '',
    "test('the amounts line up, right-aligned in their columns', () => {",
    "  const rows = printReceipt(split, { restaurant: 'Lantern House' })",
    "    .split('\\n')",
    '    .filter(l => /^(Ana|Benedict)\\b/.test(l));',
    '  assert.equal(rows.length, 2);',
    '  assert.equal(rows[0].length, rows[1].length);',
    '});',
    '',
  ].join('\n'),
};

for (const [p, text] of Object.entries(FILES)) {
  fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
  fs.writeFileSync(path.join(dir, p), text);
}
const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
git('init', '-q', '-b', 'main');
git('add', '-A');
git(
  '-c',
  'user.name=split-the-bill',
  '-c',
  'user.email=split-the-bill@example.test',
  'commit',
  '-qm',
  'Split the bill',
);
console.log(`Split the bill is in ${dir}.`);
