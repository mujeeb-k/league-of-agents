// Every text colour meets 4.5:1 (WCAG AA) on every surface it is drawn on, in both themes.
// Colours are read from src/theme.css; translucent backgrounds are composited over the surface below them.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(path.join(__dirname, '../../src/theme.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector + ' {');
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim()]));
}
const light = block(':root');
const themes = { light, dark: { ...light, ...block(":root[data-theme='dark']") } };

type RGBA = [number, number, number, number];
function parse(v: string): RGBA {
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1]!.slice(i, i + 2), 16)).concat(1) as RGBA;
  const rgba = /^rgba\(([^)]+)\)$/.exec(v);
  if (rgba) return rgba[1]!.split(',').map(Number) as RGBA;
  throw new Error('Unsupported colour ' + v);
}
const over = ([r, g, b, a]: RGBA, [R, G, B]: RGBA): RGBA => [
  r * a + R * (1 - a),
  g * a + G * (1 - a),
  b * a + B * (1 - a),
  1,
];
const lum = ([r, g, b]: RGBA) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: RGBA, b: RGBA) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

/** Text tokens and the surfaces each is drawn on. A tint is composited over the surface named after the colon. */
const PAIRS: [string[], string[]][] = [
  [
    ['--foreground', '--muted-foreground', '--ink', '--ink2', '--ink3'],
    [
      '--background',
      '--card',
      '--popover',
      '--muted',
      '--accent',
      '--canvas',
      '--panel',
      '--surface',
      '--sel-soft:--surface',
    ],
  ],
  [['--primary-foreground'], ['--primary']],
  [['--sel'], ['--surface', '--canvas', '--panel', '--frame:--canvas', '--sel-soft:--surface']],
  [['--on-sel'], ['--sel']],
  [
    ['--add', '--del', '--mod'],
    ['--surface', '--canvas', '--panel', '--muted', '--frame:--canvas', '--add-bg:--surface', '--del-bg:--surface'],
  ],
  [
    ['--kw', '--str', '--com', '--num', '--ink3'],
    ['--surface', '--add-bg:--surface', '--del-bg:--surface'],
  ],
  [
    ['--a-claude', '--a-codex', '--a-cursor', '--a-detected', '--a-hermes'],
    ['--canvas', '--frame:--canvas', '--panel', '--surface'],
  ],
];

describe('contrast', () => {
  for (const [name, vars] of Object.entries(themes))
    it(`every text pairing is at least 4.5:1 in the ${name} theme`, () => {
      const colour = (v: string) => parse(vars[v] ?? '');
      const failures: string[] = [];
      for (const [texts, surfaces] of PAIRS)
        for (const s of surfaces) {
          const [tint, under] = s.split(':') as [string, string | undefined];
          const bg = under ? over(colour(tint), colour(under)) : colour(tint);
          for (const t of texts) {
            const r = ratio(colour(t), bg);
            if (r < 4.5) failures.push(`${t} on ${s}: ${r.toFixed(2)}`);
          }
        }
      expect(failures).toEqual([]);
    });
});
