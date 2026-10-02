// A file's texture when zoomed out: its real line lengths, like an editor's minimap. Drawn once
// per shape as a small SVG used as a CSS mask, so the theme colours it and a theme switch redraws nothing.
import type { Row } from './types';

/** Rows the texture has room for in a tile, at ROW world pixels each. */
export const ROWS = 60,
  ROW = 4;
/** Texture width in world pixels, and the line length that fills it. */
const W = 360,
  COLS = 90;

export interface Texture {
  /** One [indent, end] pair per texture row, in characters. */
  bars: [number, number][];
  /** Lines per texture row: a file longer than ROWS lines folds several lines into each row. */
  per: number;
}

/** The texture's rows for a file's lines: each row spans from the least indent to the longest end in it. */
export function textureOf(rows: Row[]): Texture {
  const per = Math.max(1, Math.ceil(rows.length / ROWS));
  const bars: [number, number][] = [];
  for (let i = 0; i < rows.length; i += per) {
    let ind = Infinity,
      end = 0;
    for (const r of rows.slice(i, i + per)) {
      const t = (r.t || '').replace(/\t/g, '  ');
      const trimmed = t.trimStart();
      if (!trimmed) continue;
      ind = Math.min(ind, t.length - trimmed.length);
      end = Math.max(end, t.trimEnd().length);
    }
    bars.push(ind === Infinity ? [0, 0] : [Math.min(ind, COLS), Math.min(end, COLS)]);
  }
  return { bars, per };
}

/** The SVG for a texture: one stroke per row, as a single path. */
export function textureSvg({ bars }: Texture): string {
  const k = W / COLS;
  let d = '';
  bars.forEach(([a, b], i) => {
    if (b > a) d += `M${(a * k).toFixed(1)} ${i * ROW + ROW / 2}h${((b - a) * k).toFixed(1)}`;
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Math.max(1, bars.length) * ROW}">` +
    `<path d="${d}" stroke="#000" stroke-width="${ROW * 0.6}" stroke-linecap="round"/></svg>`
  );
}

// Files with the same shape share one image. Object URLs are short, so a thousand tiles don't carry a
// thousand inline images through style recalculation.
const urls = new Map<string, string>();
const MAX = 3000;

export function textureUrl(t: Texture): string {
  const key = t.bars.join(';');
  let url = urls.get(key);
  if (!url) {
    url = URL.createObjectURL(new Blob([textureSvg(t)], { type: 'image/svg+xml' }));
    urls.set(key, url);
    if (urls.size > MAX) {
      const [oldest, old] = urls.entries().next().value!;
      urls.delete(oldest);
      URL.revokeObjectURL(old);
    }
  }
  return url;
}
