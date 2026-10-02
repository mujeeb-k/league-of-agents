// Word-level diff between a removed line and the added line that replaced it, and the
// wrapped height of a line in a code card.

/** Character ranges [start, end) within a line. */
export type Ranges = [number, number][];

const TOKEN = /\w+|\s+|[^\w\s]/g;
/** Above this many token pairs, skip the word diff and treat the whole line as changed. */
const MAX_CELLS = 40_000;
/** If more than this share of either line changed, the lines are unrelated: no word marks. */
const MAX_CHANGED = 0.7;

function tokens(s: string) {
  return [...s.matchAll(TOKEN)].map(m => ({ t: m[0], at: m.index }));
}

/** Changed ranges in each line, or null when the lines are too different for word marks to help. */
export function wordDiff(a: string, b: string): { a: Ranges; b: Ranges } | null {
  const ta = tokens(a),
    tb = tokens(b);
  if (!ta.length || !tb.length || ta.length * tb.length > MAX_CELLS) return null;
  // Longest common subsequence of tokens.
  const w = tb.length + 1;
  const lcs = new Uint16Array((ta.length + 1) * w);
  for (let i = ta.length - 1; i >= 0; i--)
    for (let j = tb.length - 1; j >= 0; j--)
      lcs[i * w + j] =
        ta[i]!.t === tb[j]!.t ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
  const keepA = new Set<number>(),
    keepB = new Set<number>();
  for (let i = 0, j = 0; i < ta.length && j < tb.length;) {
    if (ta[i]!.t === tb[j]!.t) {
      keepA.add(i++);
      keepB.add(j++);
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) i++;
    else j++;
  }
  const ra = ranges(ta, keepA),
    rb = ranges(tb, keepB);
  if (!ra.length && !rb.length) return null;
  if (covered(ra) > MAX_CHANGED * a.length || covered(rb) > MAX_CHANGED * b.length) return null;
  return { a: ra, b: rb };
}

/** Ranges of the tokens not kept, merged across whitespace-only gaps; leading and trailing space trimmed. */
function ranges(toks: { t: string; at: number }[], keep: Set<number>): Ranges {
  const out: Ranges = [];
  for (let i = 0; i < toks.length; i++) {
    if (keep.has(i)) continue;
    const { t, at } = toks[i]!;
    if (!t.trim()) continue;
    const last = out[out.length - 1];
    const gap = last ? toks.filter(x => x.at >= last[1] && x.at < at) : [];
    if (last && gap.every(x => !x.t.trim())) last[1] = at + t.length;
    else out.push([at, at + t.length]);
  }
  return out;
}

const covered = (r: Ranges) => r.reduce((n, [s, e]) => n + e - s, 0);

/** Number of visual lines `text` takes when wrapped at `cols` characters, breaking at spaces where possible. */
export function wrapCount(text: string, cols: number): number {
  const s = text.replace(/\t/g, ' '.repeat(8));
  if (s.length <= cols) return 1;
  let lines = 1,
    col = 0;
  for (const word of s.split(/(?<= )/)) {
    let len = word.length;
    const visible = word.trimEnd().length;
    if (col > 0 && col + visible > cols) {
      lines++;
      col = 0;
    }
    while (col + len > cols && col === 0 && visible > cols) {
      lines++;
      len -= cols;
    }
    col += len;
  }
  return lines;
}
